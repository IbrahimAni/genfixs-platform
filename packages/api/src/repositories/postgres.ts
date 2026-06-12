import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRecordSchema,
  AuditEventSchema,
  DiagnosisSchema,
  EvidenceBundleSchema,
  IntentArtifactSchema,
  ProjectSchema,
  QuarantineRecordSchema,
  TestFlowModelSchema,
  TestRunSchema,
  type TestStatus,
} from '@genfixs/domain';
import pg from 'pg';
import type { Repositories } from './interfaces.js';

/**
 * Postgres system of record (spec §11). Documents are validated through the
 * domain Zod schemas on the way out, so a corrupt row fails loudly instead of
 * leaking malformed state into the pipeline.
 */
export async function createPostgresRepositories(connectionString: string): Promise<
  Repositories & { close(): Promise<void> }
> {
  const pool = new pg.Pool({ connectionString });
  const migration = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '../../migrations/001_init.sql'),
    'utf8',
  );
  await pool.query(migration);

  const q = (text: string, values: unknown[]) => pool.query(text, values);

  return {
    projects: {
      async save(p) {
        await q(
          `INSERT INTO projects (id, name, doc, created_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET name=$2, doc=$3`,
          [p.id, p.name, JSON.stringify(p), p.createdAt],
        );
      },
      async get(id) {
        const r = await q(`SELECT doc FROM projects WHERE id=$1`, [id]);
        return r.rows[0] ? ProjectSchema.parse(r.rows[0].doc) : undefined;
      },
      async list() {
        const r = await q(`SELECT doc FROM projects ORDER BY created_at`, []);
        return r.rows.map((row) => ProjectSchema.parse(row.doc));
      },
    },
    runs: {
      async save(run) {
        await q(
          `INSERT INTO test_runs (id, project_id, commit_sha, started_at, doc)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET doc=$5`,
          [run.id, run.projectId, run.commitSha, run.startedAt, JSON.stringify(run)],
        );
        for (const result of run.results) {
          await q(
            `INSERT INTO test_results (run_id, project_id, test_id, status, started_at)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (run_id, test_id) DO UPDATE SET status=$4`,
            [run.id, run.projectId, result.testId, result.status, run.startedAt],
          );
        }
      },
      async get(id) {
        const r = await q(`SELECT doc FROM test_runs WHERE id=$1`, [id]);
        return r.rows[0] ? TestRunSchema.parse(r.rows[0].doc) : undefined;
      },
      async listByProject(projectId, limit = 50) {
        const r = await q(
          `SELECT doc FROM (
             SELECT doc, started_at FROM test_runs WHERE project_id=$1
             ORDER BY started_at DESC LIMIT $2
           ) sub ORDER BY started_at ASC`,
          [projectId, limit],
        );
        return r.rows.map((row) => TestRunSchema.parse(row.doc));
      },
      async historyStatuses(projectId, testId, limit = 10) {
        const r = await q(
          `SELECT status FROM (
             SELECT status, started_at FROM test_results
             WHERE project_id=$1 AND test_id=$2
             ORDER BY started_at DESC LIMIT $3
           ) sub ORDER BY started_at ASC`,
          [projectId, testId, limit],
        );
        return r.rows.map((row) => row.status as TestStatus);
      },
    },
    evidence: {
      async save(e) {
        await q(
          `INSERT INTO evidence_bundles (run_id, test_id, doc) VALUES ($1,$2,$3)
           ON CONFLICT (run_id, test_id) DO UPDATE SET doc=$3`,
          [e.runId, e.testId, JSON.stringify(e)],
        );
      },
      async get(runId, testId) {
        const r = await q(`SELECT doc FROM evidence_bundles WHERE run_id=$1 AND test_id=$2`, [
          runId,
          testId,
        ]);
        return r.rows[0] ? EvidenceBundleSchema.parse(r.rows[0].doc) : undefined;
      },
    },
    diagnoses: {
      async save(d) {
        await q(
          `INSERT INTO diagnoses (id, project_id, test_id, run_id, classification, confidence, created_at, doc)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET doc=$8, classification=$5, confidence=$6`,
          [d.id, d.projectId, d.testId, d.runId, d.classification, d.confidence, d.createdAt, JSON.stringify(d)],
        );
      },
      async get(id) {
        const r = await q(`SELECT doc FROM diagnoses WHERE id=$1`, [id]);
        return r.rows[0] ? DiagnosisSchema.parse(r.rows[0].doc) : undefined;
      },
      async listByProject(projectId, limit = 200) {
        const r = await q(
          `SELECT doc FROM (
             SELECT doc, created_at FROM diagnoses WHERE project_id=$1
             ORDER BY created_at DESC LIMIT $2
           ) sub ORDER BY created_at ASC`,
          [projectId, limit],
        );
        return r.rows.map((row) => DiagnosisSchema.parse(row.doc));
      },
    },
    actions: {
      async save(a) {
        await q(
          `INSERT INTO action_records (id, project_id, diagnosis_id, test_id, kind, decided_at, doc)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [a.id, a.projectId, a.diagnosisId, a.testId, a.action.kind, a.decidedAt, JSON.stringify(a)],
        );
      },
      async listByProject(projectId) {
        const r = await q(
          `SELECT doc FROM action_records WHERE project_id=$1 ORDER BY decided_at`,
          [projectId],
        );
        return r.rows.map((row) => ActionRecordSchema.parse(row.doc));
      },
      async getByDiagnosis(diagnosisId) {
        const r = await q(`SELECT doc FROM action_records WHERE diagnosis_id=$1 LIMIT 1`, [
          diagnosisId,
        ]);
        return r.rows[0] ? ActionRecordSchema.parse(r.rows[0].doc) : undefined;
      },
    },
    quarantine: {
      async save(record) {
        await q(
          `INSERT INTO quarantine_records (id, project_id, test_id, status, quarantined_at, doc)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET status=$4, doc=$6`,
          [record.id, record.projectId, record.testId, record.status, record.quarantinedAt, JSON.stringify(record)],
        );
      },
      async get(id) {
        const r = await q(`SELECT doc FROM quarantine_records WHERE id=$1`, [id]);
        return r.rows[0] ? QuarantineRecordSchema.parse(r.rows[0].doc) : undefined;
      },
      async listByProject(projectId, status) {
        const r = status
          ? await q(
              `SELECT doc FROM quarantine_records WHERE project_id=$1 AND status=$2 ORDER BY quarantined_at`,
              [projectId, status],
            )
          : await q(
              `SELECT doc FROM quarantine_records WHERE project_id=$1 ORDER BY quarantined_at`,
              [projectId],
            );
        return r.rows.map((row) => QuarantineRecordSchema.parse(row.doc));
      },
      async release(id, at) {
        const r = await q(`SELECT doc FROM quarantine_records WHERE id=$1`, [id]);
        if (!r.rows[0]) return;
        const record = QuarantineRecordSchema.parse(r.rows[0].doc);
        const released = { ...record, status: 'released' as const, releasedAt: at };
        await q(`UPDATE quarantine_records SET status='released', doc=$2 WHERE id=$1`, [
          id,
          JSON.stringify(released),
        ]);
      },
    },
    flowTraces: {
      async save(t) {
        await q(
          `INSERT INTO flow_traces (id, project_id, test_id, run_id, captured_at, doc)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [t.id, t.projectId, t.testId, t.runId, t.capturedAt, JSON.stringify(t)],
        );
      },
      async listByTest(projectId, testId) {
        const r = await q(
          `SELECT doc FROM flow_traces WHERE project_id=$1 AND test_id=$2 ORDER BY captured_at`,
          [projectId, testId],
        );
        return r.rows.map((row) => TestFlowModelSchema.parse(row.doc));
      },
    },
    audit: {
      async append(e) {
        await q(
          `INSERT INTO audit_events (id, project_id, at, type, doc) VALUES ($1,$2,$3,$4,$5)`,
          [e.id, e.projectId, e.at, e.type, JSON.stringify(e)],
        );
      },
      async listByProject(projectId, limit = 200) {
        const r = await q(
          `SELECT doc FROM (
             SELECT doc, at FROM audit_events WHERE project_id=$1 ORDER BY at DESC LIMIT $2
           ) sub ORDER BY at ASC`,
          [projectId, limit],
        );
        return r.rows.map((row) => AuditEventSchema.parse(row.doc));
      },
    },
    intent: {
      async listForTest(projectId, _testId) {
        const r = await q(`SELECT doc FROM intent_artifacts WHERE project_id=$1`, [projectId]);
        return r.rows.map((row) => IntentArtifactSchema.parse(row.doc));
      },
    },
    async close() {
      await pool.end();
    },
  };
}
