import { z } from 'zod';
import { ClassificationSchema } from './classification.js';
import { EvidenceBundleSchema } from './evidence.js';
import { AgentActionSchema } from './action.js';

export const DiagnosisSourceSchema = z.enum(['prefilter-flake', 'prefilter-selector-drift', 'llm']);
export type DiagnosisSource = z.infer<typeof DiagnosisSourceSchema>;

export const DiagnosisSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  testId: z.string(),
  runId: z.string(),
  classification: ClassificationSchema,
  /** 0..1. Below the policy threshold for the classification, the engine degrades to UNCLASSIFIED. */
  confidence: z.number().min(0).max(1),
  /** Which stage produced this: deterministic pre-filters or the LLM (spec §10.4). */
  source: DiagnosisSourceSchema,
  rationale: z.string(),
  evidence: EvidenceBundleSchema,
  /** When the original classification was degraded to UNCLASSIFIED, what it was. */
  degradedFrom: ClassificationSchema.optional(),
  /** For BENIGN_DRIFT: the drifted selector and its detected replacement, when known. */
  suggestedSelectorFix: z.object({ oldSelector: z.string(), newSelector: z.string() }).optional(),
  /** Filled after execution; spec §9 `decidedAction`. */
  decidedAction: AgentActionSchema.optional(),
  createdAt: z.coerce.date(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
