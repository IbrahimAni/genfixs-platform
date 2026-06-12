import {
  RUN_INGESTED,
  type ArtifactRef,
  type AuditEvent,
  type Clock,
  type IdGenerator,
  type ObjectStore,
  type Queue,
  type RunIngestedEvent,
  type TestRun,
} from '@genfixs/domain';
import { parseJUnitReport } from './junitReport.js';
import { parsePlaywrightReport } from './playwrightReport.js';

export interface IngestReportInput {
  projectId: string;
  commitSha: string;
  lastGreenSha?: string;
  format: 'playwright-json' | 'junit-xml';
  raw: string;
  startedAt?: Date;
}

export interface IngestionDeps {
  store: ObjectStore;
  queue: Queue;
  clock: Clock;
  ids: IdGenerator;
  saveRun(run: TestRun): Promise<void>;
  audit(event: Omit<AuditEvent, 'id' | 'at'>): Promise<void>;
}

/**
 * Stateless, queue-backed ingestion (spec §10.1). Normalizes CI reports into
 * TestRun/TestResult, persists raw report + artifacts, emits `run.ingested`.
 */
export class IngestionService {
  constructor(private readonly deps: IngestionDeps) {}

  async ingest(input: IngestReportInput): Promise<TestRun> {
    const { store, queue, clock, ids, saveRun, audit } = this.deps;
    const runId = ids.next('run');

    const rawKey = `runs/${runId}/raw-report`;
    await store.put(rawKey, input.raw, 'application/octet-stream');
    const reportArtifact: ArtifactRef = {
      id: `${runId}:report`,
      kind: input.format === 'playwright-json' ? 'playwright-report' : 'junit-report',
      storageKey: rawKey,
    };

    const parsed =
      input.format === 'playwright-json'
        ? await parsePlaywrightReport(input.raw, { runId, store })
        : { results: parseJUnitReport(input.raw), artifacts: [] };

    const run: TestRun = {
      id: runId,
      projectId: input.projectId,
      commitSha: input.commitSha,
      ...(input.lastGreenSha ? { lastGreenSha: input.lastGreenSha } : {}),
      reportArtifacts: [reportArtifact, ...parsed.artifacts],
      results: parsed.results,
      startedAt: input.startedAt ?? clock.now(),
    };

    await saveRun(run);
    await audit({
      projectId: input.projectId,
      actor: 'system',
      type: 'run.ingested',
      runId,
      detail: {
        commitSha: input.commitSha,
        total: run.results.length,
        failed: run.results.filter((r) => r.status === 'failed').length,
      },
    });

    const event: RunIngestedEvent = { projectId: input.projectId, runId };
    await queue.publish(RUN_INGESTED, event);
    return run;
  }
}
