import type { AuthoredFix, BrowserRunner, BrowserRunResult, Project } from '@genfixs/domain';

/**
 * Verification sandbox (spec §10.7): runs the authored test against the
 * current app build, scoped to the single fixed test. No verification
 * environment configured ⇒ the fix cannot verify ⇒ it is never surfaced
 * (DECISIONS.md D3) — the orchestrator degrades it to quarantine.
 */
export class VerificationSandbox {
  constructor(private readonly runner: BrowserRunner) {}

  async verify(project: Project, fix: AuthoredFix): Promise<BrowserRunResult> {
    if (!project.verificationBaseUrl) {
      return {
        passed: false,
        errorMessage:
          'No verification environment configured for this project; refusing to surface an unverified fix',
        flowTrace: [],
      };
    }
    return this.runner.runTest({
      files: fix.files,
      testFile: fix.testFile,
      testTitle: fix.testTitle,
      baseUrl: project.verificationBaseUrl,
    });
  }
}

/** Derives a flow trace from Playwright test source — used by the scripted runner. */
export function extractFlowTrace(source: string) {
  const steps: BrowserRunResult['flowTrace'] = [];
  const patterns: Array<{ action: 'goto' | 'click' | 'fill' | 'press' | 'select' | 'expect'; regex: RegExp }> = [
    { action: 'goto', regex: /\.goto\(\s*['"`]([^'"`]+)['"`]/ },
    { action: 'click', regex: /(getByTestId\(['"`][^'"`]+['"`]\)|locator\(['"`][^'"`]+['"`]\)|getByRole\([^)]*\))\.click\(/ },
    { action: 'fill', regex: /(getByTestId\(['"`][^'"`]+['"`]\)|locator\(['"`][^'"`]+['"`]\))\.fill\(/ },
    { action: 'expect', regex: /expect\(([^)]*)\)/ },
  ];
  let index = 0;
  for (const line of source.split('\n')) {
    for (const { action, regex } of patterns) {
      const match = line.match(regex);
      if (!match) continue;
      const selectorMatch = line.match(/getByTestId\(\s*['"`]([^'"`]+)['"`]\)|locator\(\s*['"`]([^'"`]+)['"`]\)/);
      const selector = selectorMatch?.[1]
        ? `[data-testid=${selectorMatch[1]}]`
        : selectorMatch?.[2];
      steps.push({
        index: index++,
        action,
        ...(selector ? { selector } : {}),
        ...(action === 'goto' && match[1] ? { url: match[1] } : {}),
      });
      break;
    }
  }
  return steps;
}

/**
 * Scripted runner for tests and demo: passes when every selector the test uses
 * exists in the provided "live DOM" selector set. Mimics the only judgment the
 * real sandbox makes — does the test go green against the current app?
 */
export class ScriptedBrowserRunner implements BrowserRunner {
  constructor(private readonly liveSelectors: Set<string>) {}

  async runTest(input: {
    files: Record<string, string>;
    testFile: string;
  }): Promise<BrowserRunResult> {
    const source = input.files[input.testFile] ?? '';
    const flowTrace = extractFlowTrace(source);
    const testIds = [...source.matchAll(/getByTestId\(\s*['"`]([^'"`]+)['"`]\)/g)].map((m) => m[1]!);
    const dataTestIds = [...source.matchAll(/\[data-testid=["']?([^"'\]]+)["']?\]/g)].map(
      (m) => m[1]!,
    );
    const missing = [...new Set([...testIds, ...dataTestIds])].filter(
      (id) => !this.liveSelectors.has(id),
    );
    if (missing.length > 0) {
      return {
        passed: false,
        errorMessage: `locator('[data-testid=${missing[0]}]') not found`,
        flowTrace,
      };
    }
    return { passed: true, flowTrace };
  }
}
