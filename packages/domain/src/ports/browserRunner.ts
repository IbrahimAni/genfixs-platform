import type { FlowStep } from '../flow.js';

export interface BrowserRunInput {
  /** path → content of the (edited) test file(s) to execute. */
  files: Record<string, string>;
  /** The single test to run; verification is scoped to the healed test, never the suite. */
  testFile: string;
  testTitle: string;
  baseUrl: string;
}

export interface BrowserRunResult {
  passed: boolean;
  errorMessage?: string;
  /** Flow trace captured during the run — persisted as TestFlowModel (spec §9 note). */
  flowTrace: FlowStep[];
}

/**
 * Sandboxed Playwright execution for verification (spec §10.7). A heal that does
 * not verify green here is never shown to the customer.
 */
export interface BrowserRunner {
  runTest(input: BrowserRunInput): Promise<BrowserRunResult>;
}
