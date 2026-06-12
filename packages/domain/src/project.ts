import { z } from 'zod';
import { MergePolicySchema } from './policy.js';
import { OrgRefSchema, RepoRefSchema } from './refs.js';

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  org: OrgRefSchema,
  /** Where tests live; all PRs go here. The customer's repo is the source of truth. */
  testRepo: RepoRefSchema,
  /** Optional, but unlocks diff-based diagnosis (spec §10.3). */
  appRepo: RepoRefSchema.optional(),
  ciProvider: z.enum(['github-actions', 'gitlab-ci', 'other']),
  framework: z.enum(['playwright', 'cypress']),
  policies: MergePolicySchema,
  /** Staging/preview URL for verification runs; absent ⇒ heals cannot verify ⇒ no PR (DECISIONS.md D3). */
  verificationBaseUrl: z.string().optional(),
  createdAt: z.coerce.date(),
});
export type Project = z.infer<typeof ProjectSchema>;
