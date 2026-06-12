import { z } from 'zod';

/**
 * Every failing test is classified into exactly one of these (spec §7 R2, §8).
 */
export const CLASSIFICATIONS = [
  'BENIGN_DRIFT',
  'BEHAVIOR_CHANGE',
  'REAL_REGRESSION_SUSPECTED',
  'FEATURE_MISSING',
  'FLAKY_NONDETERMINISTIC',
  'UNCLASSIFIED',
] as const;

export const ClassificationSchema = z.enum(CLASSIFICATIONS);
export type Classification = z.infer<typeof ClassificationSchema>;
