import {
  InMemoryObjectStore,
  InMemoryQueue,
  RUN_INGESTED,
  computeTestId,
  type AuditEvent,
  type TestRun,
} from '@genfixs/domain';
import { describe, expect, it } from 'vitest';
import { JUNIT_FIXTURE, makePlaywrightReport } from './fixtures.js';
import { IngestionService } from './ingestionService.js';
import { parseJUnitReport } from './junitReport.js';
import { parsePlaywrightReport } from './playwrightReport.js';

function makeService() {
  const store = new InMemoryObjectStore();
  const queue = new InMemoryQueue();
  const savedRuns: TestRun[] = [];
  const auditEvents: Omit<AuditEvent, 'id' | 'at'>[] = [];
  let n = 0;
  const service = new IngestionService({
    store,
    queue,
    clock: { now: () => new Date('2026-06-12T10:00:00Z') },
    ids: { next: (p) => `${p}_${n++}` },
    saveRun: async (run) => {
      savedRuns.push(run);
    },
    audit: async (e) => {
      auditEvents.push(e);
    },
  });
  return { service, store, queue, savedRuns, auditEvents };
}

describe('Playwright report parsing', () => {
  it('normalizes mixed pass/fail/skip with stable test identity', async () => {
    const raw = makePlaywrightReport([
      { file: 'tests/login.spec.ts', describe: 'auth', title: 'logs in', status: 'passed' },
      {
        file: 'tests/checkout.spec.ts',
        title: 'applies discount',
        status: 'failed',
        errorMessage: "Error: locator('[data-testid=apply-coupon]') not found",
        withScreenshot: true,
        withTrace: true,
      },
      { file: 'tests/admin.spec.ts', title: 'exports csv', status: 'skipped' },
    ]);
    const store = new InMemoryObjectStore();
    const { results, artifacts } = await parsePlaywrightReport(raw, { runId: 'run_1', store });

    expect(results).toHaveLength(3);
    const failed = results.find((r) => r.status === 'failed');
    expect(failed?.title).toBe('applies discount');
    expect(failed?.testId).toBe(computeTestId('tests/checkout.spec.ts', 'applies discount'));
    expect(failed?.failure?.errorMessage).toContain('apply-coupon');
    expect(failed?.failure?.screenshots).toHaveLength(1);
    expect(failed?.failure?.trace).toBeDefined();

    const passed = results.find((r) => r.status === 'passed');
    expect(passed?.title).toBe('auth › logs in');

    // attachments persisted into the artifact store
    expect(artifacts).toHaveLength(2);
    expect(store.size).toBe(2);
  });

  it('tolerates reports with no failures', async () => {
    const raw = makePlaywrightReport([
      { file: 'tests/a.spec.ts', title: 'works', status: 'passed' },
    ]);
    const store = new InMemoryObjectStore();
    const { results, artifacts } = await parsePlaywrightReport(raw, { runId: 'r', store });
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('passed');
    expect(results[0]!.failure).toBeUndefined();
    expect(artifacts).toHaveLength(0);
  });
});

describe('JUnit fallback parsing', () => {
  it('parses failures with message and stack', () => {
    const results = parseJUnitReport(JUNIT_FIXTURE);
    expect(results).toHaveLength(3);
    const failed = results.find((r) => r.status === 'failed');
    expect(failed?.failure?.errorMessage).toContain('expected 90 to equal 80');
    expect(failed?.failure?.stackTrace).toContain('checkout.spec.ts:22');
    expect(failed?.durationMs).toBe(2410);
    expect(results.filter((r) => r.status === 'passed')).toHaveLength(2);
  });
});

describe('IngestionService', () => {
  it('persists raw report + artifacts, saves the run, audits, and emits run.ingested', async () => {
    const { service, store, queue, savedRuns, auditEvents } = makeService();
    const events: unknown[] = [];
    queue.subscribe(RUN_INGESTED, async (p) => {
      events.push(p);
    });

    const run = await service.ingest({
      projectId: 'proj_1',
      commitSha: 'abc123',
      lastGreenSha: 'def456',
      format: 'playwright-json',
      raw: makePlaywrightReport([
        { file: 'tests/x.spec.ts', title: 'fails', status: 'failed', withScreenshot: true },
      ]),
    });
    await queue.drain();

    expect(savedRuns).toHaveLength(1);
    expect(run.lastGreenSha).toBe('def456');
    expect(run.reportArtifacts.length).toBe(2); // raw report + screenshot
    expect(await store.getText(run.reportArtifacts[0]!.storageKey)).toContain('suites');
    expect(events).toEqual([{ projectId: 'proj_1', runId: run.id }]);
    expect(auditEvents[0]).toMatchObject({ type: 'run.ingested', detail: { failed: 1 } });
    expect(queue.errors).toHaveLength(0);
  });

  it('ingests JUnit XML via the fallback path', async () => {
    const { service, savedRuns } = makeService();
    await service.ingest({
      projectId: 'proj_1',
      commitSha: 'abc123',
      format: 'junit-xml',
      raw: JUNIT_FIXTURE,
    });
    expect(savedRuns[0]!.results).toHaveLength(3);
    expect(savedRuns[0]!.reportArtifacts[0]!.kind).toBe('junit-report');
  });
});
