import { z } from 'zod';
import { ClassificationSchema } from './classification.js';
import { DateRangeSchema } from './refs.js';

export const SuiteHealthSnapshotSchema = z.object({
  projectId: z.string(),
  window: DateRangeSchema,
  /** Healed with zero human time / total breaks. */
  autoHealRate: z.number().min(0).max(1),
  /** Must remain 0. Tracked as an alarm, never a metric to optimize (spec §9, §15). */
  falseGreenCount: z.number().int().nonnegative(),
  regressionsCaught: z.number().int().nonnegative(),
  quarantineBacklog: z.number().int().nonnegative(),
  /** Hours. */
  meanTimeToGreen: z.number().nonnegative(),
  breaksByClassification: z.record(ClassificationSchema, z.number().int().nonnegative()),
  totalBreaks: z.number().int().nonnegative(),
});
export type SuiteHealthSnapshot = z.infer<typeof SuiteHealthSnapshotSchema>;
