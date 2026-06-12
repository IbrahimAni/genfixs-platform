import {
  InMemoryGitHubClient,
  makeEvidenceFixture,
  makeProjectFixture,
  type AuditEvent,
  type AuthoredFix,
  type Diagnosis,
} from '@genfixs/domain';
import { describe, expect, it } from 'vitest';
import { PolicyViolationError, PrService } from './prService.js';

const project = makeProjectFixture();
const projectAutoMerge = makeProjectFixture({
  policies: { ...structuredClone(project.policies), autoMergeBenignDrift: true },
});

const HEAL_FIX: AuthoredFix = {
  kind: 'heal',
  testFile: 'tests/checkout.spec.ts',
  testTitle: 'applies discount',
  files: { 'tests/checkout.spec.ts': '// healed' },
  summary: 'Renamed apply-coupon → apply-discount-code',
};

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    id: 'diag_1',
    projectId: project.id,
    testId: 'test_1',
    runId: 'run_1',
    classification: 'BENIGN_DRIFT',
    confidence: 0.97,
    source: 'prefilter-selector-drift',
    rationale: 'pure rename',
    evidence: makeEvidenceFixture(),
    createdAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const github = new InMemoryGitHubClient();
  const audits: Omit<AuditEvent, 'id' | 'at'>[] = [];
  const service = new PrService({
    github,
    audit: async (e) => {
      audits.push(e);
    },
  });
  return { github, audits, service };
}

describe('heal PRs (R3)', () => {
  it('opens a PR with a structured body and no auto-merge by default', async () => {
    const { github, service } = setup();
    const { pr, autoMerged } = await service.openHealPr(project, makeDiagnosis(), HEAL_FIX, {
      autoMerge: false,
    });
    expect(autoMerged).toBe(false);
    expect(github.pullRequests).toHaveLength(1);
    const opened = github.pullRequests[0]!;
    expect(opened.autoMergeEnabled).toBe(false);
    expect(opened.input.body).toContain('BENIGN_DRIFT');
    expect(opened.input.body).toContain('What drifted');
    expect(opened.input.body).toContain('ran green against the current app build');
    expect(opened.input.branch).toBe('genfixs/heal/test_1');
    expect(pr.url).toContain('/pull/1');
  });

  it('enables auto-merge only when requested AND the project opted in', async () => {
    const { github, service } = setup();
    const { autoMerged } = await service.openHealPr(projectAutoMerge, makeDiagnosis(), HEAL_FIX, {
      autoMerge: true,
    });
    expect(autoMerged).toBe(true);
    expect(github.pullRequests[0]!.autoMergeEnabled).toBe(true);
  });

  it('defense in depth: refuses auto-merge if the caller asks but policy never opted in', async () => {
    const { github, audits, service } = setup();
    const { autoMerged } = await service.openHealPr(
      project, // auto-merge NOT opted in
      makeDiagnosis(),
      HEAL_FIX,
      { autoMerge: true }, // caller (wrongly) asks anyway
    );
    expect(autoMerged).toBe(false);
    expect(github.pullRequests[0]!.autoMergeEnabled).toBe(false);
    expect(audits.some((a) => a.type === 'pr.auto-merge-refused')).toBe(true);
  });

  it('throws PolicyViolationError for a heal PR on any non-drift classification', async () => {
    const { github, service } = setup();
    for (const classification of [
      'BEHAVIOR_CHANGE',
      'REAL_REGRESSION_SUSPECTED',
      'FEATURE_MISSING',
      'FLAKY_NONDETERMINISTIC',
      'UNCLASSIFIED',
    ] as const) {
      await expect(
        service.openHealPr(project, makeDiagnosis({ classification }), HEAL_FIX, {
          autoMerge: false,
        }),
      ).rejects.toThrow(PolicyViolationError);
    }
    expect(github.pullRequests).toHaveLength(0);
  });

  it('rejects a rewrite fix smuggled through the heal path', async () => {
    const { service } = setup();
    await expect(
      service.openHealPr(
        project,
        makeDiagnosis(),
        { ...HEAL_FIX, kind: 'rewrite' },
        {
          autoMerge: false,
        },
      ),
    ).rejects.toThrow(PolicyViolationError);
  });
});

describe('rewrite PRs (R4)', () => {
  it('opens a PR that asks "is this intended?" and never touches auto-merge', async () => {
    const { github, service } = setup();
    await service.openRewritePr(
      project,
      makeDiagnosis({ classification: 'BEHAVIOR_CHANGE', confidence: 0.85 }),
      { ...HEAL_FIX, kind: 'rewrite', evidenceSummary: 'Flow extended by two steps.' },
    );
    const opened = github.pullRequests[0]!;
    expect(opened.input.title).toContain('needs confirmation');
    expect(opened.input.body).toContain('Is this intended?');
    expect(opened.input.body).toContain('will not merge without human approval');
    expect(opened.autoMergeEnabled).toBe(false);
  });

  it('refuses rewrite PRs for non-BEHAVIOR_CHANGE classifications', async () => {
    const { service } = setup();
    await expect(
      service.openRewritePr(project, makeDiagnosis(), { ...HEAL_FIX, kind: 'rewrite' }),
    ).rejects.toThrow(PolicyViolationError);
  });
});

describe('regression issues (R5)', () => {
  it('files the report in the app repo with assertion, suspect change, and repro', async () => {
    const { github, service } = setup();
    const issue = await service.createRegressionIssue(project, {
      testId: 'test_1',
      runId: 'run_1',
      failingAssertion: "expected '$110.00' to equal '$90.00'",
      suspectAppChange: 'src/lib/pricing.ts between green1 and head1',
      reproductionSteps: ['Check out head1', 'Run the test', 'Observe wrong total'],
      severityHint: 'high',
    });
    expect(issue.url).toContain('acme/shop/issues');
    const created = github.issues[0]!;
    expect(created.input.repo.name).toBe('shop'); // app repo, not test repo
    expect(created.input.body).toContain('has not been modified');
    expect(created.input.body).toContain('$90.00');
    expect(created.input.labels).toContain('regression-suspected');
  });
});
