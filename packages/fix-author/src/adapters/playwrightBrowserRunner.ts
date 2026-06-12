import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { BrowserRunInput, BrowserRunResult, BrowserRunner } from '@genfixs/domain';
import { extractFlowTrace } from '../verifier.js';

/**
 * Real Playwright adapter: materializes the authored test into a temp sandbox
 * and runs exactly that test against the project's verification URL.
 *
 * Swappable via the BrowserRunner port; the in-memory ScriptedBrowserRunner is
 * the default everywhere tests/demo run. Requires `@playwright/test` and
 * browsers installed on the worker image.
 */
export class PlaywrightBrowserRunner implements BrowserRunner {
  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async runTest(input: BrowserRunInput): Promise<BrowserRunResult> {
    const dir = await mkdtemp(join(tmpdir(), 'genfixs-verify-'));
    try {
      for (const [path, content] of Object.entries(input.files)) {
        const target = join(dir, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, 'utf8');
      }
      await writeFile(
        join(dir, 'playwright.config.ts'),
        `import { defineConfig } from '@playwright/test';
export default defineConfig({ use: { baseURL: ${JSON.stringify(input.baseUrl)} } });
`,
        'utf8',
      );

      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(
          'npx',
          ['playwright', 'test', input.testFile, '--grep', input.testTitle, '--reporter=json'],
          { cwd: dir, timeout: this.options.timeoutMs ?? 180_000 },
        );
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === null) reject(new Error(`Playwright run terminated: ${stderr}`));
          else resolve(code);
        });
      });

      const source = input.files[input.testFile] ?? '';
      return {
        passed: exitCode === 0,
        ...(exitCode !== 0 ? { errorMessage: `playwright exited with code ${exitCode}` } : {}),
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
