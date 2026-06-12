import { InMemoryGitHubClient, computeTestId } from '@genfixs/domain';
import { describe, expect, it } from 'vitest';
import { seedDemo } from './demo/seed.js';
import { buildServer } from './server.js';

/**
 * End-to-end on fakes: the demo seed pushes real Playwright-format reports
 * through ingestion → evidence → diagnosis → policy → authoring →
 * verification → PR service, then the API serves the outcome. This is the
 * experiment plan's blind mixed batch, graded automatically.
 */
describe('end-to-end pipeline (demo seed)', async () => {
  const ctx = await seedDemo();
  const github = ctx.github as InMemoryGitHubClient;
  const app = buildServer(ctx);
  const projectId = ctx.project.id;

  const get = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('produced exactly one diagnosis per planted failure, each correctly classified', async () => {
    const failures = await get(`/api/projects/${projectId}/failures`);
    const byTest = new Map(failures.map((f: { testId: string }) => [f.testId, f]));
    expect(failures).toHaveLength(7);

    const expectClassification = (file: string, title: string, classification: string) => {
      const f = byTest.get(computeTestId(file, title)) as { classification: string } | undefined;
      expect(f, `${title}`).toBeDefined();
      expect(f!.classification).toBe(classification);
    };

    expectClassification('tests/checkout.spec.ts', 'applies discount code', 'BENIGN_DRIFT');
    expectClassification('tests/onboarding.spec.ts', 'completes onboarding', 'BEHAVIOR_CHANGE');
    expectClassification('tests/pricing.spec.ts', 'calculates total with discount', 'REAL_REGRESSION_SUSPECTED');
    expectClassification('tests/export.spec.ts', 'exports report as CSV', 'FEATURE_MISSING');
    expectClassification('tests/beta-dashboard.spec.ts', 'shows beta dashboard widgets', 'FEATURE_MISSING');
    expectClassification('tests/search.spec.ts', 'search filters results', 'FLAKY_NONDETERMINISTIC');
    expectClassification('tests/profile.spec.ts', 'updates profile avatar', 'UNCLASSIFIED');
  });

  it('opened exactly two PRs: one verified heal, one rewrite requiring confirmation', () => {
    expect(github.pullRequests).toHaveLength(2);
    const heal = github.pullRequests.find((pr) => pr.input.branch.startsWith('genfixs/heal/'));
    const rewrite = github.pullRequests.find((pr) =>
      pr.input.branch.startsWith('genfixs/rewrite/'),
    );

    expect(heal).toBeDefined();
    expect(heal!.input.files['tests/checkout.spec.ts']).toContain('apply-discount-code');
    expect(heal!.input.files['tests/checkout.spec.ts']).not.toContain("'apply-coupon'");
    // Assertions untouched in the healed file:
    expect(heal!.input.files['tests/checkout.spec.ts']).toContain("toHaveText('$90.00')");
    // Auto-merge stays off because the demo project never opted in (R3 default):
    expect(heal!.autoMergeEnabled).toBe(false);

    expect(rewrite).toBeDefined();
    expect(rewrite!.input.body).toContain('Is this intended?');
    expect(rewrite!.input.files['tests/onboarding.spec.ts']).toContain('confirm-terms');
    expect(rewrite!.autoMergeEnabled).toBe(false);
  });

  it('refused the false-green trap: regression reported as an issue, test untouched', () => {
    const regressionIssue = github.issues.find((i) =>
      i.input.labels.includes('regression-suspected'),
    );
    expect(regressionIssue).toBeDefined();
    expect(regressionIssue!.input.body).toContain('$90.00');
    expect(regressionIssue!.input.repo.name).toBe('shop'); // filed against the app repo

    // No PR touches the pricing test, ever:
    for (const pr of github.pullRequests) {
      expect(Object.keys(pr.input.files)).not.toContain('tests/pricing.spec.ts');
    }
  });

  it('quarantined the rest with reasons, including the deletion trap (no removal recommendation for flag-gating)', async () => {
    const quarantine = await get(`/api/projects/${projectId}/quarantine`);
    expect(quarantine).toHaveLength(4);

    const byReason = (reason: string) =>
      quarantine.filter((q: { reason: string }) => q.reason === reason);
    expect(byReason('flaky-nondeterministic')).toHaveLength(1);
    expect(byReason('unclassified')).toHaveLength(1);
    expect(byReason('cannot-locate')).toHaveLength(2);

    const exportQ = quarantine.find(
      (q: { testId: string }) =>
        q.testId === computeTestId('tests/export.spec.ts', 'exports report as CSV'),
    );
    const betaQ = quarantine.find(
      (q: { testId: string }) =>
        q.testId === computeTestId('tests/beta-dashboard.spec.ts', 'shows beta dashboard widgets'),
    );
    // Truly removed → removal recommended (human sign-off); flag-hidden → NOT recommended.
    expect(exportQ.removalRecommendation).toBeDefined();
    expect(betaQ.removalRecommendation ?? null).toBeNull();

    // Quarantine ages are visible (R6).
    expect(typeof exportQ.ageDays).toBe('number');
  });

  it('serves the diagnosis detail with evidence, action, and flow traces for the healed test', async () => {
    const failures = await get(`/api/projects/${projectId}/failures`);
    const drift = failures.find(
      (f: { classification: string }) => f.classification === 'BENIGN_DRIFT',
    );
    const detail = await get(`/api/diagnoses/${drift.id}`);
    expect(detail.diagnosis.evidence.appDiff.files[0].path).toBe('src/components/Checkout.tsx');
    expect(detail.action.kind).toBe('HEAL');
    expect(detail.action.pr.url).toContain('/pull/');
    // P2 insurance: flow trace captured during verification.
    expect(detail.flowTraces.length).toBeGreaterThan(0);
    expect(detail.flowTraces[0].steps[0].action).toBe('goto');
  });

  it('reports suite health (R9): rates, backlog, breaks by classification, trend', async () => {
    const overview = await get(`/api/projects/${projectId}`);
    const { snapshot, trend } = overview;
    expect(snapshot.totalBreaks).toBe(7);
    expect(snapshot.falseGreenCount).toBe(0);
    expect(snapshot.regressionsCaught).toBe(1);
    expect(snapshot.quarantineBacklog).toBe(4);
    expect(snapshot.breaksByClassification.BENIGN_DRIFT).toBe(1);
    expect(snapshot.breaksByClassification.FEATURE_MISSING).toBe(2);
    expect(snapshot.autoHealRate).toBeCloseTo(1 / 7);
    expect(trend.length).toBeGreaterThanOrEqual(8);
    const last = trend.at(-1);
    expect(last.failed).toBe(0);
  });

  it('settings: auto-merge opt-in round-trips, but the deletion gate cannot be disabled', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/settings`,
      payload: {
        policies: {
          autoMergeBenignDrift: true,
          confidenceThresholds: {
            heal: 0.95,
            proposeRewrite: 0.8,
            reportRegression: 0.6,
            featureMissing: 0.7,
            flaky: 0.7,
          },
          deletionRequiresSignoff: true,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().policies.autoMergeBenignDrift).toBe(true);
    expect(res.json().policies.confidenceThresholds.heal).toBe(0.95);

    const evil = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/settings`,
      payload: { policies: { autoMergeBenignDrift: true, deletionRequiresSignoff: false } },
    });
    expect(evil.statusCode).toBe(400);
  });

  it('quarantine release is a human action recorded in the audit log', async () => {
    const quarantine = await get(`/api/projects/${projectId}/quarantine`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/quarantine/${quarantine[0].id}/release`,
    });
    expect(res.statusCode).toBe(200);
    const audit = await get(`/api/projects/${projectId}/audit`);
    const release = audit.find((e: { type: string }) => e.type === 'quarantine.released');
    expect(release.actor).toBe('human');
  });

  it('audit trail covers the full pipeline', async () => {
    const audit = await get(`/api/projects/${projectId}/audit`);
    const types = new Set(audit.map((e: { type: string }) => e.type));
    for (const expected of [
      'run.ingested',
      'evidence.built',
      'diagnosis.created',
      'action.decided',
      'verification.passed',
      'pr.opened',
      'issue.opened',
      'quarantine.added',
      'removal.recommended',
    ]) {
      expect(types.has(expected), expected).toBe(true);
    }
  });
});
