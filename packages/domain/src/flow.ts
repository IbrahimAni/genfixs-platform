import { z } from 'zod';

/**
 * Compact per-test flow trace captured during verification runs. Persisted from day
 * one as the substrate for the v2 feature graph and blast-radius analysis
 * (spec §9 design note, §11). Cheap to capture, deliberately structured:
 * test ↔ step ↔ selector ↔ url links are graph edges in waiting.
 */
export const FlowStepSchema = z.object({
  index: z.number().int().nonnegative(),
  action: z.enum(['goto', 'click', 'fill', 'press', 'select', 'expect', 'other']),
  selector: z.string().optional(),
  url: z.string().optional(),
  detail: z.string().optional(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const TestFlowModelSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  testId: z.string(),
  runId: z.string(),
  capturedAt: z.coerce.date(),
  steps: z.array(FlowStepSchema),
});
export type TestFlowModel = z.infer<typeof TestFlowModelSchema>;
