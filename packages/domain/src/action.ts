import { z } from 'zod';
import { ClassificationSchema } from './classification.js';
import { IssueRefSchema, PullRequestRefSchema } from './refs.js';

/**
 * The deterministic output of the Action Orchestrator's policy function, decided
 * BEFORE any side effect runs. Model output never appears here directly — only a
 * Diagnosis filtered through policy can produce one of these (spec §10.5).
 *
 * Deliberately unrepresentable states:
 *  - There is no DELETE decision. The strongest removal-shaped output is a
 *    quarantine carrying a removal recommendation, which only a human can execute.
 *  - autoMergeEligible exists only on HEAL; rewrites and everything else cannot
 *    carry auto-merge eligibility at the type level.
 */
export const PolicyDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('HEAL'),
    /** Policy opt-in only; the PR service additionally requires verified-green. */
    autoMergeEligible: z.boolean(),
  }),
  z.object({
    kind: z.literal('PROPOSE_REWRITE'),
    /** Always true; present to make the invariant visible at call sites. */
    requiresHumanApproval: z.literal(true),
  }),
  z.object({
    kind: z.literal('REPORT_REGRESSION'),
    /** Always true: the test is never edited for a suspected regression. */
    testMustRemainUntouched: z.literal(true),
  }),
  z.object({
    kind: z.literal('QUARANTINE'),
    reason: z.enum([
      'flaky-nondeterministic',
      'unclassified',
      'cannot-locate',
      'verification-failed',
      'below-confidence-threshold',
    ]),
    hypothesis: z.string(),
    escalate: z.boolean(),
    /**
     * FEATURE_MISSING with strong removal evidence carries a recommendation.
     * Execution of any removal is human-only, behind explicit sign-off (spec §6.4).
     */
    removalRecommendation: z.object({ rationale: z.string() }).optional(),
  }),
]);
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const RegressionReportSchema = z.object({
  testId: z.string(),
  runId: z.string(),
  failingAssertion: z.string(),
  suspectAppChange: z.string(),
  reproductionSteps: z.array(z.string()),
  severityHint: z.enum(['low', 'medium', 'high', 'critical']),
  issue: IssueRefSchema.optional(),
});
export type RegressionReport = z.infer<typeof RegressionReportSchema>;

/** The executed action record (spec §9 AgentAction), written to the audit trail. */
export const AgentActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('HEAL'), pr: PullRequestRefSchema, autoMerged: z.boolean() }),
  z.object({ kind: z.literal('PROPOSE_REWRITE'), pr: PullRequestRefSchema }),
  z.object({ kind: z.literal('REPORT_REGRESSION'), report: RegressionReportSchema }),
  z.object({ kind: z.literal('QUARANTINE'), hypothesis: z.string() }),
  z.object({ kind: z.literal('RECOMMEND_REMOVAL'), rationale: z.string() }),
  z.object({ kind: z.literal('ESCALATE'), reason: z.string() }),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const ActionRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  diagnosisId: z.string(),
  testId: z.string(),
  runId: z.string(),
  classification: ClassificationSchema,
  action: AgentActionSchema,
  decidedAt: z.coerce.date(),
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;
