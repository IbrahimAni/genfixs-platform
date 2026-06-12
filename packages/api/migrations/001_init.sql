-- GenFixs relational core (spec §11). Key fields are first-class columns for
-- querying; full entities live alongside as validated JSONB documents.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  doc JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  commit_sha TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_project_started ON test_runs(project_id, started_at);

-- Flattened results enable per-test history queries (flake statistics).
CREATE TABLE IF NOT EXISTS test_results (
  run_id TEXT NOT NULL REFERENCES test_runs(id),
  project_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, test_id)
);
CREATE INDEX IF NOT EXISTS idx_results_history ON test_results(project_id, test_id, started_at);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  run_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  doc JSONB NOT NULL,
  PRIMARY KEY (run_id, test_id)
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  classification TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnoses_project ON diagnoses(project_id, created_at);

CREATE TABLE IF NOT EXISTS action_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  diagnosis_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_project ON action_records(project_id, decided_at);

CREATE TABLE IF NOT EXISTS quarantine_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  status TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quarantine_project ON quarantine_records(project_id, status);

-- P2 graph substrate (spec §9 design note): persisted from day one.
CREATE TABLE IF NOT EXISTS flow_traces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flow_traces_test ON flow_traces(project_id, test_id);

-- Append-only: no UPDATE/DELETE issued by the application, ever.
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  doc JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_events(project_id, at);

CREATE TABLE IF NOT EXISTS intent_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  doc JSONB NOT NULL
);
