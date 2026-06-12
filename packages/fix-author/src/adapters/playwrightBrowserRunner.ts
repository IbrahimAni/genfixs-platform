import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { BrowserRunInput, BrowserRunResult, BrowserRunner } from '@genfixs/domain';
import { extractFlowTrace } from '../verifier.js';

export interface PlaywrightRunnerOptions {
  timeoutMs?: number;
  /**
   * Directory whose node_modules provides @playwright/test (sandboxes are
   * created inside it so module resolution works). Defaults to cwd.
   */
  runnerDir?: string;
}

/**
 * Real Playwright adapter (spec §10.7): materializes the authored test into a
 * temp sandbox and runs exactly that test against the project's verification
 * URL with a real browser. Requires @playwright/test plus browsers
 * (PLAYWRIGHT_BROWSERS_PATH or default cache) on the worker image.
 *
 * Swappable via the BrowserRunner port; ScriptedBrowserRunner is the default
 * where no browser infrastructure exists.
 */
export class PlaywrightBrowserRunner implements BrowserRunner {
  constructor(private readonly options: PlaywrightRunnerOptions = {}) {}

  async runTest(input: BrowserRunInput): Promise<BrowserRunResult> {
    const runnerDir = this.options.runnerDir ?? process.cwd();
    const sandboxParent = join(runnerDir, '.genfixs-verify');
    await mkdir(sandboxParent, { recursive: true });
    const dir = await mkdtemp(join(sandboxParent, 'run-'));
    try {
      for (const [path, content] of Object.entries(input.files)) {
        const target = join(dir, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
      }
      await writeFile(
        join(dir, 'playwright.config.ts'),
        `import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: { baseURL: ${JSON.stringify(input.baseUrl)} },
  reporter: [['json', { outputFile: 'pw-report.json' }]],
});
`,
        'utf8',
      );

      const localBin = join(runnerDir, 'node_modules', '.bin', 'playwright');
      const command = existsSync(localBin) ? localBin : 'npx';
      const args = [
        ...(command === 'npx' ? ['playwright'] : []),
        'test',
        input.testFile,
        '--grep',
        escapeRegex(input.testTitle),
      ];

      const { exitCode, stderr } = await new Promise<{ exitCode: number; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(command, args, {
            cwd: dir,
            timeout: this.options.timeoutMs ?? 180_000,
            env: { ...process.env, CI: '1' },
          });
          let stderr = '';
          child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
          child.stdout.on('data', () => {});
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === null) reject(new Error(`Playwright run terminated: ${stderr}`));
            else resolve({ exitCode: code, stderr });
          });
        },
      );

      const source = input.files[input.testFile] ?? '';
      return {
        passed: exitCode === 0,
        ...(exitCode !== 0
          ? { errorMessage: `playwright exited with code ${exitCode}: ${stderr.slice(0, 500)}` }
          : {}),
        flowTrace: extractFlowTrace(source),
      };
    } catch (err) {
      return {
        passed: false,
        errorMessage: `Verification run failed to execute: ${err instanceof Error ? err.message : String(err)}`,
        flowTrace: [],
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Kept for compatibility with environments that mount sandboxes on tmpfs. */
export const SANDBOX_TMPDIR = tmpdir();
