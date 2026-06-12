/**
 * Realistic Playwright JSON report fixtures, shared by tests and the demo seed.
 */

export interface FixtureSpec {
  file: string;
  describe?: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  errorMessage?: string;
  stack?: string;
  durationMs?: number;
  withScreenshot?: boolean;
  withTrace?: boolean;
}

export function makePlaywrightReport(specs: FixtureSpec[]): string {
  const byFile = new Map<string, FixtureSpec[]>();
  for (const spec of specs) {
    const list = byFile.get(spec.file) ?? [];
    list.push(spec);
    byFile.set(spec.file, list);
  }

  const suites = [...byFile.entries()].map(([file, fileSpecs]) => {
    const makeSpec = (s: FixtureSpec) => ({
      title: s.title,
      file,
      tests: [
        {
          status: s.status === 'passed' ? 'expected' : s.status === 'failed' ? 'unexpected' : 'skipped',
          results:
            s.status === 'skipped'
              ? []
              : [
                  {
                    status: s.status,
                    duration: s.durationMs ?? 1200,
                    ...(s.status === 'failed'
                      ? {
                          error: {
                            message: s.errorMessage ?? 'Error: locator not found',
                            stack: s.stack ?? `Error: ${s.errorMessage}\n    at ${file}:10:5`,
                          },
                          attachments: [
                            ...(s.withScreenshot
                              ? [
                                  {
                                    name: 'screenshot',
                                    contentType: 'image/png',
                                    body: Buffer.from('png-bytes').toString('base64'),
                                  },
                                ]
                              : []),
                            ...(s.withTrace
                              ? [
                                  {
                                    name: 'trace',
                                    contentType: 'application/zip',
                                    body: Buffer.from('trace-bytes').toString('base64'),
                                  },
                                ]
                              : []),
                          ],
                        }
                      : { attachments: [] }),
                  },
                ],
        },
      ],
    });

    const grouped = new Map<string | undefined, FixtureSpec[]>();
    for (const s of fileSpecs) {
      const list = grouped.get(s.describe) ?? [];
      list.push(s);
      grouped.set(s.describe, list);
    }

    const specsAtRoot = (grouped.get(undefined) ?? []).map(makeSpec);
    const childSuites = [...grouped.entries()]
      .filter(([describe]) => describe !== undefined)
      .map(([describe, children]) => ({
        title: describe,
        file,
        specs: children.map(makeSpec),
      }));

    return { title: file, file, specs: specsAtRoot, suites: childSuites };
  });

  return JSON.stringify({ suites });
}

export const JUNIT_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="checkout" file="tests/checkout.spec.ts" tests="2" failures="1">
    <testcase classname="checkout" name="applies discount code" file="tests/checkout.spec.ts" time="2.41">
      <failure message="AssertionError: expected 90 to equal 80">AssertionError: expected 90 to equal 80
    at tests/checkout.spec.ts:22:7</failure>
    </testcase>
    <testcase classname="checkout" name="shows cart total" file="tests/checkout.spec.ts" time="1.02"/>
  </testsuite>
  <testsuite name="login" file="tests/login.spec.ts" tests="1" failures="0">
    <testcase classname="login" name="logs in" file="tests/login.spec.ts" time="0.8"/>
  </testsuite>
</testsuites>`;
