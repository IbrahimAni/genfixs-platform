import { computeTestId, type TestResult } from '@genfixs/domain';
import { XMLParser } from 'fast-xml-parser';

/**
 * JUnit XML fallback parser (R1). Coarser than the Playwright report — no
 * traces or screenshots — but lets any CI emit failures GenFixs can diagnose.
 */
export function parseJUnitReport(xml: string): TestResult[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['testsuite', 'testcase'].includes(name),
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc['testsuites'] ?? doc) as Record<string, unknown>;
  const suites = (root['testsuite'] ?? []) as Record<string, unknown>[];

  const results: TestResult[] = [];
  for (const suite of suites) {
    const suiteFile = (suite['@_file'] as string | undefined) ?? '';
    for (const tc of (suite['testcase'] ?? []) as Record<string, unknown>[]) {
      const name = String(tc['@_name'] ?? '');
      const classname = String(tc['@_classname'] ?? '');
      const file = (tc['@_file'] as string | undefined) ?? suiteFile ?? classname;
      const timeSec = Number(tc['@_time'] ?? 0);
      const failureNode = tc['failure'] ?? tc['error'];
      const skipped = tc['skipped'] !== undefined;

      const fullTitle = classname && !file.includes(classname) ? `${classname} › ${name}` : name;
      const base = {
        testId: computeTestId(file, fullTitle),
        file,
        title: fullTitle,
        durationMs: Math.round(timeSec * 1000),
      };

      if (failureNode !== undefined && failureNode !== null) {
        const failureObj =
          typeof failureNode === 'object' ? (failureNode as Record<string, unknown>) : {};
        const message = String(
          failureObj['@_message'] ??
            (typeof failureNode === 'string'
              ? failureNode
              : (failureObj['#text'] ?? 'Test failed')),
        );
        const text = typeof failureObj['#text'] === 'string' ? failureObj['#text'] : '';
        results.push({
          ...base,
          status: 'failed',
          failure: { errorMessage: message, stackTrace: text, screenshots: [] },
        });
      } else {
        results.push({ ...base, status: skipped ? 'skipped' : 'passed' });
      }
    }
  }
  return results;
}
