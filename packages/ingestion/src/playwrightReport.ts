import {
  computeTestId,
  type ArtifactRef,
  type FailureEvidence,
  type ObjectStore,
  type TestResult,
  type TestStatus,
} from '@genfixs/domain';
import { z } from 'zod';

/**
 * Subset of the Playwright JSON reporter schema GenFixs consumes (R1). Unknown
 * fields pass through untouched; we validate only what we read.
 */
const PwAttachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  path: z.string().optional(),
  body: z.string().optional(), // base64 when inlined
});

const PwErrorSchema = z.object({
  message: z.string().optional(),
  stack: z.string().optional(),
});

const PwResultSchema = z.object({
  status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']),
  duration: z.number().default(0),
  error: PwErrorSchema.optional(),
  errors: z.array(PwErrorSchema).default([]),
  attachments: z.array(PwAttachmentSchema).default([]),
});

const PwTestSchema = z.object({
  status: z.enum(['expected', 'unexpected', 'flaky', 'skipped']).optional(),
  results: z.array(PwResultSchema).default([]),
});

const PwSpecSchema = z.object({
  title: z.string(),
  file: z.string(),
  tests: z.array(PwTestSchema).default([]),
});

type PwSuite = {
  title?: string;
  file?: string;
  suites?: PwSuite[];
  specs?: z.infer<typeof PwSpecSchema>[];
};

const PwSuiteSchema = z.lazy(() =>
  z.object({
    title: z.string().optional(),
    file: z.string().optional(),
    suites: z.array(PwSuiteSchema).optional(),
    specs: z.array(PwSpecSchema).optional(),
  }),
) as z.ZodType<PwSuite>;

export const PlaywrightReportSchema = z.object({
  suites: z.array(PwSuiteSchema).default([]),
});

export interface ParsedReport {
  results: TestResult[];
  artifacts: ArtifactRef[];
}

interface FlatSpec {
  file: string;
  fullTitle: string;
  test: z.infer<typeof PwTestSchema>;
}

function flattenSuites(suites: PwSuite[], titlePath: string[]): FlatSpec[] {
  const out: FlatSpec[] = [];
  for (const suite of suites) {
    // Root file-suites carry the filename as title; keep describe titles only.
    const isFileSuite = suite.title !== undefined && suite.title === suite.file;
    const nextPath = suite.title && !isFileSuite ? [...titlePath, suite.title] : titlePath;
    for (const spec of suite.specs ?? []) {
      const parsed = PwSpecSchema.parse(spec);
      for (const test of parsed.tests) {
        out.push({
          file: parsed.file,
          fullTitle: [...nextPath, parsed.title].join(' › '),
          test,
        });
      }
    }
    out.push(...flattenSuites(suite.suites ?? [], nextPath));
  }
  return out;
}

function mapStatus(test: z.infer<typeof PwTestSchema>): TestStatus {
  switch (test.status) {
    case 'expected':
    case 'flaky': // passed on retry; flake detection happens in diagnosis, not here
      return 'passed';
    case 'unexpected':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default: {
      const last = test.results.at(-1);
      if (!last) return 'skipped';
      return last.status === 'passed' ? 'passed' : last.status === 'skipped' ? 'skipped' : 'failed';
    }
  }
}

/**
 * Parses a Playwright JSON report into normalized TestResults, persisting
 * attachments (screenshots, traces, DOM snapshots) into the artifact store.
 */
export async function parsePlaywrightReport(
  raw: string,
  options: { runId: string; store: ObjectStore },
): Promise<ParsedReport> {
  const report = PlaywrightReportSchema.parse(JSON.parse(raw));
  const flat = flattenSuites(report.suites, []);
  const results: TestResult[] = [];
  const artifacts: ArtifactRef[] = [];

  for (const { file, fullTitle, test } of flat) {
    const status = mapStatus(test);
    const lastResult = test.results.at(-1);
    const durationMs = lastResult?.duration ?? 0;
    const testId = computeTestId(file, fullTitle);

    let failure: FailureEvidence | undefined;
    if (status === 'failed' && lastResult) {
      const error = lastResult.error ?? lastResult.errors[0];
      const screenshots: ArtifactRef[] = [];
      let trace: ArtifactRef | undefined;
      let domSnapshot: ArtifactRef | undefined;

      for (const [i, att] of lastResult.attachments.entries()) {
        if (att.body === undefined && att.path === undefined) continue;
        const kind =
          att.name === 'trace'
            ? 'trace'
            : att.contentType.startsWith('image/')
              ? 'screenshot'
              : att.name.includes('dom') || att.contentType === 'text/html'
                ? 'dom-snapshot'
                : 'other';
        if (kind === 'other') continue;
        const storageKey = `runs/${options.runId}/${testId}/${i}-${att.name}`;
        const body = att.body !== undefined ? Buffer.from(att.body, 'base64') : att.path!;
        await options.store.put(storageKey, body as Uint8Array | string, att.contentType);
        const ref: ArtifactRef = {
          id: `${options.runId}:${testId}:${i}`,
          kind,
          storageKey,
          contentType: att.contentType,
        };
        artifacts.push(ref);
        if (kind === 'screenshot') screenshots.push(ref);
        else if (kind === 'trace') trace = ref;
        else domSnapshot = ref;
      }

      failure = {
        errorMessage: error?.message ?? 'Unknown failure',
        stackTrace: error?.stack ?? '',
        screenshots,
        ...(trace ? { trace } : {}),
        ...(domSnapshot ? { domSnapshot } : {}),
      };
    }

    results.push({
      testId,
      file,
      title: fullTitle,
      status,
      durationMs,
      ...(failure ? { failure } : {}),
    });
  }

  return { results, artifacts };
}
