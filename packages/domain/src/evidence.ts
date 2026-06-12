import { z } from 'zod';
import { FailureEvidenceSchema } from './run.js';
import { IntentArtifactSchema } from './intent.js';

export const FileDiffSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  patch: z.string().optional(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

export const AppDiffSchema = z.object({
  baseSha: z.string(),
  headSha: z.string(),
  files: z.array(FileDiffSchema),
});
export type AppDiff = z.infer<typeof AppDiffSchema>;

/** Per-test run history statistics; the substrate for deterministic flake detection. */
export const RunHistoryStatsSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  /** pass→fail / fail→pass transitions across recent runs with unchanged test code. */
  flips: z.number().int().nonnegative(),
  /** Most-recent-last statuses for the window considered. */
  recentStatuses: z.array(z.enum(['passed', 'failed', 'skipped', 'quarantined'])),
});
export type RunHistoryStats = z.infer<typeof RunHistoryStatsSchema>;

/**
 * Everything diagnosis sees (spec §10.3). Graph-ready by construction: selectors,
 * app paths and intent links are structured, not prose (R15 architectural insurance).
 */
export const EvidenceBundleSchema = z.object({
  testId: z.string(),
  runId: z.string(),
  /** The failing test's source, as it exists in the customer's repo. */
  testSource: z.string(),
  failure: FailureEvidenceSchema,
  /** Present only when the app repo is connected. */
  appDiff: AppDiffSchema.optional(),
  history: RunHistoryStatsSchema,
  intentArtifacts: z.array(IntentArtifactSchema),
  /** Selectors referenced by the test — structured link substrate for the v2 graph. */
  selectorsInTest: z.array(z.string()),
  /** App code paths the diff touches that look relevant to this test. */
  relevantAppPaths: z.array(z.string()),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
