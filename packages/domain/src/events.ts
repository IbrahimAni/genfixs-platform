import { z } from 'zod';

/** Queue topics and payloads for the event-driven pipeline (spec §10). */

export const RUN_INGESTED = 'run.ingested' as const;
export const RunIngestedEventSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
});
export type RunIngestedEvent = z.infer<typeof RunIngestedEventSchema>;

export const EVIDENCE_READY = 'evidence.ready' as const;
export const EvidenceReadyEventSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  testId: z.string(),
});
export type EvidenceReadyEvent = z.infer<typeof EvidenceReadyEventSchema>;

export const DIAGNOSIS_READY = 'diagnosis.ready' as const;
export const DiagnosisReadyEventSchema = z.object({
  projectId: z.string(),
  diagnosisId: z.string(),
});
export type DiagnosisReadyEvent = z.infer<typeof DiagnosisReadyEventSchema>;

export const TOPICS = [RUN_INGESTED, EVIDENCE_READY, DIAGNOSIS_READY] as const;
export type Topic = (typeof TOPICS)[number];
