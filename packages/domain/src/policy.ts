import { z } from 'zod';
import type { Classification } from './classification.js';

/**
 * Confidence thresholds gate which actions a diagnosis may trigger (spec §8 bias rule:
 * healing requires the highest confidence; doing nothing requires none).
 * Below the relevant threshold a diagnosis degrades to UNCLASSIFIED.
 */
export const ConfidenceThresholdsSchema = z.object({
  heal: z.number().min(0).max(1),
  proposeRewrite: z.number().min(0).max(1),
  reportRegression: z.number().min(0).max(1),
  featureMissing: z.number().min(0).max(1),
  flaky: z.number().min(0).max(1),
});
export type ConfidenceThresholds = z.infer<typeof ConfidenceThresholdsSchema>;

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  heal: 0.9,
  proposeRewrite: 0.75,
  reportRegression: 0.6,
  featureMissing: 0.7,
  flaky: 0.7,
};

/**
 * Per-project merge policy (spec §9).
 *
 * `deletionRequiresSignoff` is intentionally a literal `true`: deletion gating is a
 * principle (spec §6.4), not a setting. There is no representable policy under which
 * a deletion can bypass human sign-off.
 */
export const MergePolicySchema = z.object({
  /** Auto-merge for verified BENIGN_DRIFT heals. Opt-in, off by default (R3). */
  autoMergeBenignDrift: z.boolean().default(false),
  confidenceThresholds: ConfidenceThresholdsSchema.default(DEFAULT_CONFIDENCE_THRESHOLDS),
  deletionRequiresSignoff: z.literal(true).default(true),
});
export type MergePolicy = z.infer<typeof MergePolicySchema>;

export const DEFAULT_MERGE_POLICY: MergePolicy = MergePolicySchema.parse({});

/** The threshold that gates acting on a given classification. */
export function thresholdFor(classification: Classification, policy: MergePolicy): number {
  const t = policy.confidenceThresholds;
  switch (classification) {
    case 'BENIGN_DRIFT':
      return t.heal;
    case 'BEHAVIOR_CHANGE':
      return t.proposeRewrite;
    case 'REAL_REGRESSION_SUSPECTED':
      return t.reportRegression;
    case 'FEATURE_MISSING':
      return t.featureMissing;
    case 'FLAKY_NONDETERMINISTIC':
      return t.flaky;
    case 'UNCLASSIFIED':
      // Doing nothing requires no confidence (spec §8 bias rule).
      return 0;
  }
}
