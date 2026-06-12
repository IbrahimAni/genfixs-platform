import { z } from 'zod';
import { ArtifactRefSchema } from './refs.js';

export const TestStatusSchema = z.enum(['passed', 'failed', 'skipped', 'quarantined']);
export type TestStatus = z.infer<typeof TestStatusSchema>;

export const FailureEvidenceSchema = z.object({
  errorMessage: z.string(),
  stackTrace: z.string(),
  domSnapshot: ArtifactRefSchema.optional(),
  trace: ArtifactRefSchema.optional(),
  screenshots: z.array(ArtifactRefSchema),
});
export type FailureEvidence = z.infer<typeof FailureEvidenceSchema>;

export const TestResultSchema = z.object({
  /** Stable identity across runs: hash(file + title). See testIdentity.ts. */
  testId: z.string(),
  file: z.string(),
  title: z.string(),
  status: TestStatusSchema,
  durationMs: z.number().nonnegative(),
  failure: FailureEvidenceSchema.optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const TestRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  commitSha: z.string(),
  /** Last commit at which the suite was green, when known. Anchors the app diff. */
  lastGreenSha: z.string().optional(),
  reportArtifacts: z.array(ArtifactRefSchema),
  results: z.array(TestResultSchema),
  startedAt: z.coerce.date(),
});
export type TestRun = z.infer<typeof TestRunSchema>;
