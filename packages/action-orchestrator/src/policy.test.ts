import {
  CLASSIFICATIONS,
  DEFAULT_MERGE_POLICY,
  makeEvidenceFixture,
  thresholdFor,
  type Classification,
  type Diagnosis,
  type MergePolicy,
} from '@genfixs/domain';
import { describe, expect, it } from 'vitest';
import { decideAction } from './policy.js';

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    id: 'diag_1',
    projectId: 'proj_1',
    testId: 'test_1',
    runId: 'run_1',
    classification: 'UNCLASSIFIED',
    confidence: 0.5,
    source: 'llm',
    rationale: 'test rationale',
    evidence: makeEvidenceFixture(),
    createdAt: new Date('2026-06-12T00:00:00Z'),
    ...overrides,
  };
}

const policyAutoMergeOn: MergePolicy = {
  ...structuredClone(DEFAULT_MERGE_POLICY),
  autoMergeBenignDrift: true,
};
const policyAutoMergeOff = structuredClone(DEFAULT_MERGE_POLICY);

/**
 * Exhaustive sweep: every classification × confidence band × auto-merge
 * setting. These tests encode the spec §8 decision table and the trust
 * guarantees; if one fails, the product's core promise is broken.
 */
describe('decision table: exhaustive invariants', () => {
  const confidences = [0, 0.1, 0.3, 0.5, 0.59, 0.6, 0.69, 0.7, 0.74, 0.75, 0.8, 0.89, 0.9, 0.95, 1];
  const policies = [policyAutoMergeOn, policyAutoMergeOff];

  it('holds the global invariants for every (classification, confidence, policy) combination', () => {
    for (const classification of CLASSIFICATIONS) {
      for (const confidence of confidences) {
        for (const policy of policies) {
          const decision = decideAction(makeDiagnosis({ classification, confidence }), policy);

          // 1. HEAL only ever for BENIGN_DRIFT at/above the heal threshold.
          if (decision.kind === 'HEAL') {
            expect(classification).toBe('BENIGN_DRIFT');
            expect(confidence).toBeGreaterThanOrEqual(policy.confidenceThresholds.heal);
          }

          // 2. Auto-merge eligibility requires explicit policy opt-in.
          if (decision.kind === 'HEAL' && decision.autoMergeEligible) {
            expect(policy.autoMergeBenignDrift).toBe(true);
          }

          // 3. A suspected regression NEVER produces a test-editing action.
          if (classification === 'REAL_REGRESSION_SUSPECTED') {
            expect(decision.kind).not.toBe('HEAL');
            expect(decision.kind).not.toBe('PROPOSE_REWRITE');
          }

          // 4. Rewrites always require human approval (type guarantees it; assert anyway).
          if (decision.kind === 'PROPOSE_REWRITE') {
            expect(decision.requiresHumanApproval).toBe(true);
          }

          // 5. There is no deletion action, full stop.
          expect(['HEAL', 'PROPOSE_REWRITE', 'REPORT_REGRESSION', 'QUARANTINE']).toContain(
            decision.kind,
          );

          // 6. Below threshold, everything degrades to quarantine (bias rule).
          if (
            classification !== 'UNCLASSIFIED' &&
            confidence < thresholdFor(classification, policy)
          ) {
            expect(decision.kind).toBe('QUARANTINE');
            if (decision.kind === 'QUARANTINE') {
              expect(decision.reason).toBe('below-confidence-threshold');
              expect(decision.escalate).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('decision table: per-row behavior (spec §8)', () => {
  it('BENIGN_DRIFT at high confidence → HEAL, auto-merge follows opt-in', () => {
    const diagnosis = makeDiagnosis({ classification: 'BENIGN_DRIFT', confidence: 0.97 });
    expect(decideAction(diagnosis, policyAutoMergeOff)).toEqual({
      kind: 'HEAL',
      autoMergeEligible: false,
    });
    expect(decideAction(diagnosis, policyAutoMergeOn)).toEqual({
      kind: 'HEAL',
      autoMergeEligible: true,
    });
  });

  it('BEHAVIOR_CHANGE → PROPOSE_REWRITE requiring human approval, regardless of confidence or policy', () => {
    const diagnosis = makeDiagnosis({ classification: 'BEHAVIOR_CHANGE', confidence: 1 });
    for (const policy of [policyAutoMergeOn, policyAutoMergeOff]) {
      const decision = decideAction(diagnosis, policy);
      expect(decision).toEqual({ kind: 'PROPOSE_REWRITE', requiresHumanApproval: true });
    }
  });

  it('REAL_REGRESSION_SUSPECTED → REPORT_REGRESSION with the test untouched, even at confidence 1.0 with auto-merge on', () => {
    const decision = decideAction(
      makeDiagnosis({ classification: 'REAL_REGRESSION_SUSPECTED', confidence: 1 }),
      policyAutoMergeOn,
    );
    expect(decision).toEqual({ kind: 'REPORT_REGRESSION', testMustRemainUntouched: true });
  });

  it('FEATURE_MISSING without removal evidence → quarantine as cannot-locate, no removal recommendation (the deletion trap)', () => {
    const diagnosis = makeDiagnosis({
      classification: 'FEATURE_MISSING',
      confidence: 0.85,
      evidence: makeEvidenceFixture({
        appDiff: {
          baseSha: 'a',
          headSha: 'b',
          files: [{ path: 'src/flags.ts', status: 'modified', patch: '+  gated: true' }],
        },
        relevantAppPaths: ['src/flags.ts'],
      }),
    });
    const decision = decideAction(diagnosis, policyAutoMergeOn);
    expect(decision.kind).toBe('QUARANTINE');
    if (decision.kind === 'QUARANTINE') {
      expect(decision.reason).toBe('cannot-locate');
      expect(decision.removalRecommendation).toBeUndefined();
    }
  });

  it('FEATURE_MISSING with a deleted relevant file → quarantine + removal RECOMMENDATION only', () => {
    const diagnosis = makeDiagnosis({
      classification: 'FEATURE_MISSING',
      confidence: 0.9,
      evidence: makeEvidenceFixture({
        appDiff: {
          baseSha: 'a',
          headSha: 'b',
          files: [{ path: 'src/components/Coupon.tsx', status: 'removed' }],
        },
        relevantAppPaths: ['src/components/Coupon.tsx'],
      }),
    });
    const decision = decideAction(diagnosis, policyAutoMergeOn);
    expect(decision.kind).toBe('QUARANTINE');
    if (decision.kind === 'QUARANTINE') {
      expect(decision.removalRecommendation?.rationale).toContain('human sign-off');
    }
  });

  it('FLAKY_NONDETERMINISTIC → quarantine with hypothesis, no escalation noise', () => {
    const decision = decideAction(
      makeDiagnosis({
        classification: 'FLAKY_NONDETERMINISTIC',
        confidence: 0.9,
        rationale: 'timing signature',
      }),
      policyAutoMergeOff,
    );
    expect(decision).toEqual({
      kind: 'QUARANTINE',
      reason: 'flaky-nondeterministic',
      hypothesis: 'timing signature',
      escalate: false,
    });
  });

  it('UNCLASSIFIED → quarantine + escalate at any confidence (doing nothing needs none)', () => {
    for (const confidence of [0, 0.5, 1]) {
      const decision = decideAction(
        makeDiagnosis({ classification: 'UNCLASSIFIED', confidence }),
        policyAutoMergeOff,
      );
      expect(decision.kind).toBe('QUARANTINE');
      if (decision.kind === 'QUARANTINE') expect(decision.escalate).toBe(true);
    }
  });
});

describe('refusal behavior: a false green is worse than a false red', () => {
  it('an over-claiming diagnosis (high classification, sub-threshold confidence) is quarantined, not acted on', () => {
    const decision = decideAction(
      makeDiagnosis({ classification: 'BENIGN_DRIFT', confidence: 0.89 }),
      policyAutoMergeOn,
    );
    expect(decision.kind).toBe('QUARANTINE');
  });

  it('no classification at any confidence can produce auto-merge when the customer has not opted in', () => {
    for (const classification of CLASSIFICATIONS) {
      const decision = decideAction(
        makeDiagnosis({ classification: classification as Classification, confidence: 1 }),
        policyAutoMergeOff,
      );
      const autoMerge = decision.kind === 'HEAL' && decision.autoMergeEligible;
      expect(autoMerge).toBe(false);
    }
  });
});
