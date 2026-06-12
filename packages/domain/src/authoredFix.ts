import { z } from 'zod';

/** Output of the fix author: an edited test, never yet a PR. */
export const AuthoredFixSchema = z.object({
  kind: z.enum(['heal', 'rewrite']),
  testFile: z.string(),
  testTitle: z.string(),
  /** path → full new content (heals touch exactly one file). */
  files: z.record(z.string(), z.string()),
  /** What changed and why — becomes the PR body's explanation. */
  summary: z.string(),
  /** For rewrites: the app-change evidence shown to the approving human (R4). */
  evidenceSummary: z.string().optional(),
});
export type AuthoredFix = z.infer<typeof AuthoredFixSchema>;
