import { z } from 'zod';

export const OrgRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type OrgRef = z.infer<typeof OrgRefSchema>;

export const RepoRefSchema = z.object({
  provider: z.literal('github'),
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string().default('main'),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

export const ArtifactKindSchema = z.enum([
  'playwright-report',
  'junit-report',
  'trace',
  'screenshot',
  'dom-snapshot',
  'video',
  'other',
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

/** Pointer into the object store. Raw artifacts are lifecycle-expired; refs persist. */
export const ArtifactRefSchema = z.object({
  id: z.string(),
  kind: ArtifactKindSchema,
  storageKey: z.string(),
  contentType: z.string().optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const DateRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type DateRange = z.infer<typeof DateRangeSchema>;

export const PullRequestRefSchema = z.object({
  repo: RepoRefSchema,
  number: z.number().int(),
  url: z.string(),
  branch: z.string(),
});
export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;

export const IssueRefSchema = z.object({
  repo: RepoRefSchema,
  number: z.number().int(),
  url: z.string(),
});
export type IssueRef = z.infer<typeof IssueRefSchema>;
