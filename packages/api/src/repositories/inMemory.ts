import type {
  ActionRecord,
  AuditEvent,
  Diagnosis,
  EvidenceBundle,
  IntentArtifact,
  Project,
  QuarantineRecord,
  TestFlowModel,
  TestRun,
  TestStatus,
} from '@genfixs/domain';
import type { Repositories } from './interfaces.js';

export function createInMemoryRepositories(): Repositories {
  const projects = new Map<string, Project>();
  const runs = new Map<string, TestRun>();
  const evidence = new Map<string, EvidenceBundle>();
  const diagnoses = new Map<string, Diagnosis>();
  const actions = new Map<string, ActionRecord>();
  const quarantines = new Map<string, QuarantineRecord>();
  const flowTraces: TestFlowModel[] = [];
  const auditEvents: AuditEvent[] = [];
  const intents = new Map<string, IntentArtifact[]>();

  return {
    projects: {
      async save(p) {
        projects.set(p.id, p);
      },
      async get(id) {
        return projects.get(id);
      },
      async list() {
        return [...projects.values()];
      },
    },
    runs: {
      async save(r) {
        runs.set(r.id, r);
      },
      async get(id) {
        return runs.get(id);
      },
      async listByProject(projectId, limit = 50) {
        return [...runs.values()]
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .slice(-limit);
      },
      async historyStatuses(projectId, testId, limit = 10) {
        const statuses: TestStatus[] = [];
        const ordered = [...runs.values()]
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
        for (const run of ordered) {
          const result = run.results.find((res) => res.testId === testId);
          if (result) statuses.push(result.status);
        }
        return statuses.slice(-limit);
      },
    },
    evidence: {
      async save(e) {
        evidence.set(`${e.runId}:${e.testId}`, e);
      },
      async get(runId, testId) {
        return evidence.get(`${runId}:${testId}`);
      },
    },
    diagnoses: {
      async save(d) {
        diagnoses.set(d.id, d);
      },
      async get(id) {
        return diagnoses.get(id);
      },
      async listByProject(projectId, limit = 200) {
        return [...diagnoses.values()]
          .filter((d) => d.projectId === projectId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(-limit);
      },
    },
    actions: {
      async save(a) {
        actions.set(a.id, a);
      },
      async listByProject(projectId) {
        return [...actions.values()]
          .filter((a) => a.projectId === projectId)
          .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
      },
      async getByDiagnosis(diagnosisId) {
        return [...actions.values()].find((a) => a.diagnosisId === diagnosisId);
      },
    },
    quarantine: {
      async save(q) {
        quarantines.set(q.id, q);
      },
      async get(id) {
        return quarantines.get(id);
      },
      async listByProject(projectId, status) {
        return [...quarantines.values()]
          .filter((q) => q.projectId === projectId && (status === undefined || q.status === status))
          .sort((a, b) => a.quarantinedAt.getTime() - b.quarantinedAt.getTime());
      },
      async release(id, at) {
        const record = quarantines.get(id);
        if (record) quarantines.set(id, { ...record, status: 'released', releasedAt: at });
      },
    },
    flowTraces: {
      async save(t) {
        flowTraces.push(t);
      },
      async listByTest(projectId, testId) {
        return flowTraces.filter((t) => t.projectId === projectId && t.testId === testId);
      },
    },
    audit: {
      async append(e) {
        auditEvents.push(e);
      },
      async listByProject(projectId, limit = 200) {
        return auditEvents.filter((e) => e.projectId === projectId).slice(-limit);
      },
    },
    intent: {
      async listForTest(projectId, testId) {
        return (intents.get(projectId) ?? []).filter(
          (i) => i.linkedFeatures.length === 0 || i.linkedFeatures.includes(testId),
        );
      },
    },
  };
}
