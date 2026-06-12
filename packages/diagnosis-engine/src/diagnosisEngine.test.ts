import {
  makeEvidenceFixture,
  makeProjectFixture,
  type AppDiff,
  type EvidenceBundle,
  type LlmClassifier,
} from '@genfixs/domain';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosisEngine } from './diagnosisEngine.js';
import { FakeLlmClassifier } from './fakeLlmClassifier.js';
import { flakeFilter, selectorDriftFilter } from './prefilters.js';

const project = makeProjectFixture();

function engine(classifier: LlmClassifier = new FakeLlmClassifier()) {
  let n = 0;
  return new DiagnosisEngine({
    classifier,
    clock: { now: () => new Date('2026-06-12T12:00:00Z') },
    ids: { next: (p) => `${p}_${n++}` },
  });
}

const RENAME_DIFF: AppDiff = {
  baseSha: 'green',
  headSha: 'head',
  files: [
    {
      path: 'src/components/Checkout.tsx',
      status: 'modified',
      patch: `-      <button data-testid="apply-coupon">Apply</button>
+      <button data-testid="apply-discount-code">Apply</button>`,
    },
  ],
};

/** The false-green trap: logic broken, locators untouched (experiment plan case 4). */
const LOGIC_BREAK_DIFF: AppDiff = {
  baseSha: 'green',
  headSha: 'head',
  files: [
    {
      path: 'src/lib/pricing.ts',
      status: 'modified',
      patch: `-  return subtotal * (1 - discount);
+  return subtotal * (1 + discount);`,
    },
  ],
};

function locatorNotFoundEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return makeEvidenceFixture({
    failure: {
      errorMessage: "Error: locator('[data-testid=apply-coupon]') not found",
      stackTrace: 'at tests/checkout.spec.ts:6',
      screenshots: [],
    },
    ...overrides,
  });
}

describe('R2 critical acceptance: the false-green trap', () => {
  it('classifies a logic break with untouched locators as REAL_REGRESSION_SUSPECTED, never BENIGN_DRIFT', async () => {
    const evidence = makeEvidenceFixture({
      appDiff: LOGIC_BREAK_DIFF,
      relevantAppPaths: ['src/lib/pricing.ts'],
      failure: {
        errorMessage: "expect(locator).toHaveText: expected '$110.00' to equal '$90.00'",
        stackTrace: 'at tests/checkout.spec.ts:7',
        screenshots: [],
      },
    });
    const diagnosis = await engine().diagnose(project, evidence);
    expect(diagnosis.classification).toBe('REAL_REGRESSION_SUSPECTED');
    expect(diagnosis.suggestedSelectorFix).toBeUndefined();
  });
});

describe('R2 acceptance: benign drift', () => {
  it('classifies a pure testid rename as BENIGN_DRIFT with high confidence via the pre-filter (no LLM call)', async () => {
    const classifier: LlmClassifier = { classify: vi.fn() };
    const evidence = locatorNotFoundEvidence({
      appDiff: RENAME_DIFF,
      relevantAppPaths: ['src/components/Checkout.tsx'],
    });
    const diagnosis = await engine(classifier).diagnose(project, evidence);
    expect(diagnosis.classification).toBe('BENIGN_DRIFT');
    expect(diagnosis.confidence).toBeGreaterThanOrEqual(project.policies.confidenceThresholds.heal);
    expect(diagnosis.source).toBe('prefilter-selector-drift');
    expect(diagnosis.suggestedSelectorFix).toEqual({
      oldSelector: 'apply-coupon',
      newSelector: 'apply-discount-code',
    });
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});

describe('deterministic pre-filters', () => {
  it('flags flaky history + timeout signature without consulting the model', () => {
    const evidence = makeEvidenceFixture({
      history: {
        totalRuns: 10,
        failures: 4,
        flips: 5,
        recentStatuses: [
          'passed',
          'failed',
          'passed',
          'failed',
          'passed',
          'failed',
          'passed',
          'passed',
          'failed',
          'failed',
        ],
      },
      failure: {
        errorMessage: 'TimeoutError: page.waitForSelector: Timeout 30000ms exceeded',
        stackTrace: '',
        screenshots: [],
      },
    });
    const result = flakeFilter(evidence);
    expect(result?.classification).toBe('FLAKY_NONDETERMINISTIC');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('does NOT flag flaky when the app diff touches test-relevant files', () => {
    const evidence = makeEvidenceFixture({
      history: { totalRuns: 10, failures: 4, flips: 5, recentStatuses: [] },
      appDiff: LOGIC_BREAK_DIFF,
      relevantAppPaths: ['src/lib/pricing.ts'],
      failure: {
        errorMessage: 'TimeoutError: Timeout 30000ms exceeded',
        stackTrace: '',
        screenshots: [],
      },
    });
    expect(flakeFilter(evidence)).toBeNull();
  });

  it('selector-drift filter refuses mixed diffs (rename hiding among logic changes)', () => {
    const evidence = locatorNotFoundEvidence({
      appDiff: {
        baseSha: 'a',
        headSha: 'b',
        files: [...RENAME_DIFF.files, ...LOGIC_BREAK_DIFF.files],
      },
    });
    expect(selectorDriftFilter(evidence)).toBeNull();
  });

  it('selector-drift filter requires a locator-shaped failure', () => {
    const evidence = makeEvidenceFixture({
      appDiff: RENAME_DIFF,
      failure: {
        errorMessage: "expected '$110.00' to equal '$90.00'",
        stackTrace: '',
        screenshots: [],
      },
    });
    expect(selectorDriftFilter(evidence)).toBeNull();
  });
});

describe('confidence thresholds (R2)', () => {
  it('degrades below-threshold classifications to UNCLASSIFIED and drops fix suggestions', async () => {
    const lowConfidence: LlmClassifier = {
      classify: async () => ({
        classification: 'BENIGN_DRIFT',
        confidence: 0.6, // below heal threshold 0.9
        rationale: 'maybe drift',
        suggestedSelectorFix: { oldSelector: 'a', newSelector: 'b' },
      }),
    };
    const diagnosis = await engine(lowConfidence).diagnose(project, makeEvidenceFixture());
    expect(diagnosis.classification).toBe('UNCLASSIFIED');
    expect(diagnosis.degradedFrom).toBe('BENIGN_DRIFT');
    expect(diagnosis.suggestedSelectorFix).toBeUndefined();
  });

  it('rejects unknown model classifications outright', async () => {
    const rogue: LlmClassifier = {
      classify: async () => ({
        classification: 'PLEASE_MERGE_EVERYTHING' as never,
        confidence: 0.99,
        rationale: 'trust me',
      }),
    };
    const diagnosis = await engine(rogue).diagnose(project, makeEvidenceFixture());
    expect(diagnosis.classification).toBe('UNCLASSIFIED');
    expect(diagnosis.confidence).toBe(0);
  });

  it('clamps out-of-range model confidence', async () => {
    const overconfident: LlmClassifier = {
      classify: async () => ({
        classification: 'REAL_REGRESSION_SUSPECTED',
        confidence: 7,
        rationale: 'very sure',
      }),
    };
    const diagnosis = await engine(overconfident).diagnose(project, makeEvidenceFixture());
    expect(diagnosis.confidence).toBe(1);
  });

  it('keeps suggestedSelectorFix only for BENIGN_DRIFT classifications', async () => {
    const sneaky: LlmClassifier = {
      classify: async () => ({
        classification: 'REAL_REGRESSION_SUSPECTED',
        confidence: 0.9,
        rationale: 'regression... but here is a fix anyway',
        suggestedSelectorFix: { oldSelector: 'a', newSelector: 'b' },
      }),
    };
    const diagnosis = await engine(sneaky).diagnose(project, makeEvidenceFixture());
    expect(diagnosis.classification).toBe('REAL_REGRESSION_SUSPECTED');
    expect(diagnosis.suggestedSelectorFix).toBeUndefined();
  });
});

describe('FakeLlmClassifier rule coverage', () => {
  it('treats flag-gated unreachable targets as FEATURE_MISSING (cannot-locate, lower confidence)', async () => {
    const evidence = locatorNotFoundEvidence({
      appDiff: {
        baseSha: 'a',
        headSha: 'b',
        files: [
          {
            path: 'src/lib/flags.ts',
            status: 'modified',
            patch: `-  couponsEnabled: true,
+  couponsEnabled: flags.isEnabled('coupons-v2'),`,
          },
        ],
      },
      relevantAppPaths: ['src/lib/flags.ts'],
    });
    const result = await new FakeLlmClassifier().classify(evidence);
    expect(result.classification).toBe('FEATURE_MISSING');
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('treats removed relevant files as FEATURE_MISSING with stronger evidence', async () => {
    const evidence = locatorNotFoundEvidence({
      appDiff: {
        baseSha: 'a',
        headSha: 'b',
        files: [{ path: 'src/components/Coupon.tsx', status: 'removed' }],
      },
      relevantAppPaths: ['src/components/Coupon.tsx'],
    });
    const result = await new FakeLlmClassifier().classify(evidence);
    expect(result.classification).toBe('FEATURE_MISSING');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns UNCLASSIFIED when no diff is available', async () => {
    const result = await new FakeLlmClassifier().classify(makeEvidenceFixture());
    expect(result.classification).toBe('UNCLASSIFIED');
  });
});
