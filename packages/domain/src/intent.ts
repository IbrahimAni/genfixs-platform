import { z } from 'zod';
import { ArtifactRefSchema } from './refs.js';

/** Ground truth for intent-aware healing (P1) and generation (P1); modeled now (spec §9). */
export const IntentArtifactSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  source: z.enum(['upload', 'jira', 'confluence']),
  kind: z.enum(['prd', 'acceptance-criteria', 'ticket']),
  content: ArtifactRefSchema,
  linkedFeatures: z.array(z.string()),
});
export type IntentArtifact = z.infer<typeof IntentArtifactSchema>;
