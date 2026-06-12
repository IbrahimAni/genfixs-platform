import {
  thresholdFor,
  type Diagnosis,
  type MergePolicy,
  type PolicyDecision,
} from '@genfixs/domain';

/**
 * The classification decision table (spec §8) as a pure, deterministic, total
 * function. This is the single place where classifications become actions.
 *
 * The LLM classifies; THIS decides. No model output reaches a side effect
 * except through this function, and no input can make it return a deletion,
 * an auto-merged rewrite, or any edit to a test that failed for real.
 *
 * | Classification            | Action            | Merge policy                  |
 * |---------------------------|-------------------|-------------------------------|
 * | BENIGN_DRIFT              | HEAL              | auto-merge eligible (opt-in)  |
 * | BEHAVIOR_CHANGE           | PROPOSE_REWRITE   | human approval required       |
 * | REAL_REGRESSION_SUSPECTED | REPORT_REGRESSION | n/a — test never touched      |
 * | FEATURE_MISSING           | QUARANTINE        | removal: human sign-off only  |
 * | FLAKY_NONDETERMINISTIC    | QUARANTINE        | n/a                           |
 * | UNCLASSIFIED              | QUARANTINE        | n/a                           |
 *
 * Bias rule: when in doubt, the less destructive action. Healing demands the
 * highest confidence; quarantining demands none.
 */
export function decideAction(diagnosis: Diagnosis, policy: MergePolicy): PolicyDecision {
  const { classification, confidence } = diagnosis;

  // Defense in depth: the diagnosis engine already degrades below-threshold
  // classifications, but the orchestrator re-checks. A diagnosis that arrives
  // here over-claiming is quarantined, not trusted.
  if (classification !== 'UNCLASSIFIED' && confidence < thresholdFor(classification, policy)) {
    return {
      kind: 'QUARANTINE',
      reason: 'below-confidence-threshold',
      hypothesis: `Claimed ${classification} at confidence ${confidence.toFixed(2)}, below the ${thresholdFor(classification, policy)} threshold. ${diagnosis.rationale}`,
      escalate: true,
    };
  }

  switch (classification) {
    case 'BENIGN_DRIFT':
      return {
        kind: 'HEAL',
        // Opt-in per repo, off by default (R3). Verified-green is additionally
        // required at the PR boundary; eligibility here is necessary, not sufficient.
        autoMergeEligible: policy.autoMergeBenignDrift,
      };

    case 'BEHAVIOR_CHANGE':
      return {
        kind: 'PROPOSE_REWRITE',
        requiresHumanApproval: true,
      };

    case 'REAL_REGRESSION_SUSPECTED':
      return {
        kind: 'REPORT_REGRESSION',
        testMustRemainUntouched: true,
      };

    case 'FEATURE_MISSING': {
      // Distinguish "truly removed" (strong evidence: a relevant file deleted)
      // from "cannot locate" (flag-gated, hidden, ambiguous). Even with strong
      // evidence the output is a recommendation a human must execute (R7).
      const removedRelevantFile = diagnosis.evidence.appDiff?.files.find(
        (f) => f.status === 'removed' && diagnosis.evidence.relevantAppPaths.includes(f.path),
      );
      return {
        kind: 'QUARANTINE',
        reason: 'cannot-locate',
        hypothesis: diagnosis.rationale,
        escalate: true,
        ...(removedRelevantFile
          ? {
              removalRecommendation: {
                rationale: `App file ${removedRelevantFile.path} linked to this test was deleted between ${diagnosis.evidence.appDiff?.baseSha} and ${diagnosis.evidence.appDiff?.headSha}. Recommend removing the test — requires explicit human sign-off.`,
              },
            }
          : {}),
      };
    }

    case 'FLAKY_NONDETERMINISTIC':
      return {
        kind: 'QUARANTINE',
        reason: 'flaky-nondeterministic',
        hypothesis: diagnosis.rationale,
        escalate: false,
      };

    case 'UNCLASSIFIED':
      return {
        kind: 'QUARANTINE',
        reason: 'unclassified',
        hypothesis: diagnosis.rationale,
        escalate: true,
      };
  }
}
