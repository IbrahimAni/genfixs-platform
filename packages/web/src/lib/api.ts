/** Thin typed client over the GenFixs API. */

export type Classification =
  | 'BENIGN_DRIFT'
  | 'BEHAVIOR_CHANGE'
  | 'REAL_REGRESSION_SUSPECTED'
  | 'FEATURE_MISSING'
  | 'FLAKY_NONDETERMINISTIC'
  | 'UNCLASSIFIED';

export interface Snapshot {
  autoHealRate: number;
  falseGreenCount: number;
  regressionsCaught: number;
  quarantineBacklog: number;
  meanTimeToGreen: number;
  totalBreaks: number;
  breaksByClassification: Record<Classification, number>;
}

export interface TrendPoint {
  runId: string;
  commitSha: string;
  startedAt: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  org: { name: string };
  testRepo: { owner: string; name: string };
  framework: string;
  snapshot: Snapshot;
}

export interface ProjectDetail extends ProjectSummary {
  trend: TrendPoint[];
}

export interface AgentAction {
  kind: string;
  pr?: { url: string; number: number };
  autoMerged?: boolean;
  report?: { issue?: { url: string; number: number } };
  hypothesis?: string;
  rationale?: string;
  reason?: string;
}

export interface FailureRow {
  id: string;
  testId: string;
  runId: string;
  classification: Classification;
  confidence: number;
  source: string;
  rationale: string;
  degradedFrom: Classification | null;
  errorMessage: string;
  createdAt: string;
  action: AgentAction | null;
}

export interface DiagnosisDetail {
  diagnosis: {
    id: string;
    projectId: string;
    testId: string;
    runId: string;
    classification: Classification;
    confidence: number;
    source: string;
    rationale: string;
    degradedFrom?: Classification;
    suggestedSelectorFix?: { oldSelector: string; newSelector: string };
    createdAt: string;
    evidence: {
      testSource: string;
      failure: { errorMessage: string; stackTrace: string };
      appDiff?: {
        baseSha: string;
        headSha: string;
        files: { path: string; status: string; patch?: string }[];
      };
      history: { totalRuns: number; failures: number; flips: number };
      selectorsInTest: string[];
      relevantAppPaths: string[];
    };
  };
  action: AgentAction | null;
  flowTraces: { steps: { index: number; action: string; selector?: string; url?: string }[] }[];
}

export interface QuarantineRow {
  id: string;
  testId: string;
  diagnosisId: string;
  reason: string;
  hypothesis: string;
  removalRecommendation?: { rationale: string };
  quarantinedAt: string;
  status: 'active' | 'released';
  ageDays: number;
}

export interface Settings {
  testRepo: { owner: string; name: string };
  appRepo: { owner: string; name: string } | null;
  ciProvider: string;
  framework: string;
  verificationBaseUrl: string | null;
  policies: {
    autoMergeBenignDrift: boolean;
    deletionRequiresSignoff: true;
    confidenceThresholds: {
      heal: number;
      proposeRewrite: number;
      reportRegression: number;
      featureMissing: number;
      flaky: number;
    };
  };
}

export class UnauthorizedError extends Error {}

export function getToken(): string | null {
  return localStorage.getItem('genfixs_token');
}

export function setToken(token: string): void {
  localStorage.setItem('genfixs_token', token);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) throw new UnauthorizedError('API token required');
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  projects: () => get<ProjectSummary[]>('/api/projects'),
  project: (id: string) => get<ProjectDetail>(`/api/projects/${id}`),
  failures: (id: string) => get<FailureRow[]>(`/api/projects/${id}/failures`),
  diagnosis: (id: string) => get<DiagnosisDetail>(`/api/diagnoses/${id}`),
  quarantine: (id: string) => get<QuarantineRow[]>(`/api/projects/${id}/quarantine`),
  settings: (id: string) => get<Settings>(`/api/projects/${id}/settings`),
  releaseQuarantine: async (id: string) => {
    const res = await fetch(`/api/quarantine/${id}/release`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await res.text());
  },
  createProject: async (body: {
    name: string;
    org: { id: string; name: string };
    testRepo: { owner: string; name: string; defaultBranch: string };
    appRepo?: { owner: string; name: string; defaultBranch: string };
    verificationBaseUrl?: string;
  }) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new UnauthorizedError('API token required');
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ id: string }>;
  },
  saveSettings: async (id: string, body: Partial<Settings>) => {
    const res = await fetch(`/api/projects/${id}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json() as Promise<{ policies: Settings['policies'] }>;
  },
};
