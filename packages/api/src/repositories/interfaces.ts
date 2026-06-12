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

/**
 * The relational core (spec §11): projects, runs, diagnoses, actions,
 * quarantine, flow traces, audit. In-memory implementation for tests/demo,
 * Postgres implementation for production — same interface.
 */

export interface ProjectRepo {
  save(project: Project): Promise<void>;
  get(id: string): Promise<Project | undefined>;
  list(): Promise<Project[]>;
}

export interface RunRepo {
  save(run: TestRun): Promise<void>;
  get(id: string): Promise<TestRun | undefined>;
  listByProject(projectId: string, limit?: number): Promise<TestRun[]>;
  /** Most-recent-last statuses for a test across prior runs (flake substrate). */
  historyStatuses(projectId: string, testId: string, limit?: number): Promise<TestStatus[]>;
}

export interface EvidenceRepo {
  save(evidence: EvidenceBundle): Promise<void>;
  get(runId: string, testId: string): Promise<EvidenceBundle | undefined>;
}

export interface DiagnosisRepo {
  save(diagnosis: Diagnosis): Promise<void>;
  get(id: string): Promise<Diagnosis | undefined>;
  listByProject(projectId: string, limit?: number): Promise<Diagnosis[]>;
}

export interface ActionRepo {
  save(record: ActionRecord): Promise<void>;
  listByProject(projectId: string): Promise<ActionRecord[]>;
  getByDiagnosis(diagnosisId: string): Promise<ActionRecord | undefined>;
}

export interface QuarantineRepo {
  save(record: QuarantineRecord): Promise<void>;
  get(id: string): Promise<QuarantineRecord | undefined>;
  listByProject(projectId: string, status?: 'active' | 'released'): Promise<QuarantineRecord[]>;
  release(id: string, at: Date): Promise<void>;
}

export interface FlowTraceRepo {
  save(trace: TestFlowModel): Promise<void>;
  listByTest(projectId: string, testId: string): Promise<TestFlowModel[]>;
}

export interface AuditRepo {
  append(event: AuditEvent): Promise<void>;
  listByProject(projectId: string, limit?: number): Promise<AuditEvent[]>;
}

export interface IntentRepo {
  listForTest(projectId: string, testId: string): Promise<IntentArtifact[]>;
}

export interface Repositories {
  projects: ProjectRepo;
  runs: RunRepo;
  evidence: EvidenceRepo;
  diagnoses: DiagnosisRepo;
  actions: ActionRepo;
  quarantine: QuarantineRepo;
  flowTraces: FlowTraceRepo;
  audit: AuditRepo;
  intent: IntentRepo;
}
