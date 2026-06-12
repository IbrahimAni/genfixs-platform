import { z } from 'zod';

/**
 * Quarantine is skip-with-annotation, never delete (R6). Records persist visibly
 * with age and reason; release is an explicit transition.
 */
export const QuarantineRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  testId: z.string(),
  diagnosisId: z.string(),
  reason: z.enum([
    'flaky-nondeterministic',
    'unclassified',
    'cannot-locate',
    'verification-failed',
    'below-confidence-threshold',
  ]),
  hypothesis: z.string(),
  removalRecommendation: z.object({ rationale: z.string() }).optional(),
  quarantinedAt: z.coerce.date(),
  status: z.enum(['active', 'released']),
  releasedAt: z.coerce.date().optional(),
});
export type QuarantineRecord = z.infer<typeof QuarantineRecordSchema>;

export function quarantineAgeDays(record: QuarantineRecord, now: Date): number {
  const end = record.status === 'released' && record.releasedAt ? record.releasedAt : now;
  return Math.floor((end.getTime() - record.quarantinedAt.getTime()) / 86_400_000);
}
