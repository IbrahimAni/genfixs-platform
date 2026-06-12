import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS,
  DEFAULT_MERGE_POLICY,
  MergePolicySchema,
  PolicyDecisionSchema,
  computeTestId,
  quarantineAgeDays,
  thresholdFor,
} from './index.js';

describe('test identity (D1)', () => {
  it('is stable for the same file + title', () => {
    expect(computeTestId('checkout.spec.ts', 'applies discount')).toBe(
      computeTestId('checkout.spec.ts', 'applies discount'),
    );
  });

  it('differs across files and titles', () => {
    const a = computeTestId('checkout.spec.ts', 'applies discount');
    expect(computeTestId('cart.spec.ts', 'applies discount')).not.toBe(a);
    expect(computeTestId('checkout.spec.ts', 'applies coupon')).not.toBe(a);
  });
});

describe('merge policy (spec §8, §9)', () => {
  it('auto-merge is off by default (R3)', () => {
    expect(DEFAULT_MERGE_POLICY.autoMergeBenignDrift).toBe(false);
  });

  it('deletion sign-off is not policy-disableable (spec §6.4)', () => {
    const result = MergePolicySchema.safeParse({ deletionRequiresSignoff: false });
    expect(result.success).toBe(false);
  });

  it('healing requires the highest confidence of any action (§8 bias rule)', () => {
    const t = DEFAULT_MERGE_POLICY.confidenceThresholds;
    for (const other of [t.proposeRewrite, t.reportRegression, t.featureMissing, t.flaky]) {
      expect(t.heal).toBeGreaterThan(other);
    }
  });

  it('doing nothing (UNCLASSIFIED) requires no confidence', () => {
    expect(thresholdFor('UNCLASSIFIED', DEFAULT_MERGE_POLICY)).toBe(0);
  });

  it('covers every classification with a threshold', () => {
    for (const c of CLASSIFICATIONS) {
      expect(thresholdFor(c, DEFAULT_MERGE_POLICY)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('policy decision shape', () => {
  it('has no representable DELETE decision', () => {
    const result = PolicyDecisionSchema.safeParse({ kind: 'DELETE' });
    expect(result.success).toBe(false);
  });

  it('rewrite decisions cannot waive human approval', () => {
    const result = PolicyDecisionSchema.safeParse({
      kind: 'PROPOSE_REWRITE',
      requiresHumanApproval: false,
    });
    expect(result.success).toBe(false);
  });

  it('regression decisions cannot permit test edits', () => {
    const result = PolicyDecisionSchema.safeParse({
      kind: 'REPORT_REGRESSION',
      testMustRemainUntouched: false,
    });
    expect(result.success).toBe(false);
  });

  it('auto-merge eligibility exists only on HEAL', () => {
    const rewrite = PolicyDecisionSchema.parse({
      kind: 'PROPOSE_REWRITE',
      requiresHumanApproval: true,
    });
    expect('autoMergeEligible' in rewrite).toBe(false);
  });
});

describe('quarantine age', () => {
  it('computes whole days from quarantinedAt', () => {
    const record = {
      id: 'q1',
      projectId: 'p1',
      testId: 't1',
      diagnosisId: 'd1',
      reason: 'unclassified' as const,
      hypothesis: 'ambiguous diff',
      quarantinedAt: new Date('2026-06-01T00:00:00Z'),
      status: 'active' as const,
    };
    expect(quarantineAgeDays(record, new Date('2026-06-11T12:00:00Z'))).toBe(10);
  });
});
