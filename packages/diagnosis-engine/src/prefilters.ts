import type { EvidenceBundle } from '@genfixs/domain';
import { detectSelectorRename, extractSelectors, isPureSelectorDiff } from '@genfixs/evidence-builder';

export interface PrefilterResult {
  classification: 'FLAKY_NONDETERMINISTIC' | 'BENIGN_DRIFT';
  confidence: number;
  source: 'prefilter-flake' | 'prefilter-selector-drift';
  rationale: string;
  suggestedSelectorFix?: { oldSelector: string; newSelector: string };
}

/** Error signatures that indicate timing/network nondeterminism (DECISIONS.md D4). */
const FLAKY_ERROR_SIGNATURES = [
  /timeout.*exceeded/i,
  /net::ERR_/,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT/,
  /socket hang up/i,
  /navigation.*interrupted/i,
];

const MIN_FLIPS_FOR_FLAKE = 2;
const FLAKE_WINDOW_MIN_RUNS = 4;

/**
 * Deterministic stage 1 (spec §10.4): settle the unambiguous cases without the
 * model. Both filters are conservative — any disqualifying signal returns null
 * and the case flows to the LLM stage.
 */
export function flakeFilter(evidence: EvidenceBundle): PrefilterResult | null {
  const { history, failure, appDiff } = evidence;

  const flipsIndicateFlake =
    history.totalRuns >= FLAKE_WINDOW_MIN_RUNS && history.flips >= MIN_FLIPS_FOR_FLAKE;
  const signatureMatch = FLAKY_ERROR_SIGNATURES.find(
    (sig) => sig.test(failure.errorMessage) || sig.test(failure.stackTrace),
  );

  // An app diff that touches files relevant to this test means the failure may
  // be change-driven, not nondeterminism: do not pre-classify as flaky.
  if (evidence.relevantAppPaths.length > 0) return null;

  if (flipsIndicateFlake && signatureMatch) {
    return {
      classification: 'FLAKY_NONDETERMINISTIC',
      confidence: 0.95,
      source: 'prefilter-flake',
      rationale: `Intermittent across history (${history.flips} pass/fail flips in ${history.totalRuns} runs) with nondeterministic error signature ${signatureMatch}.`,
    };
  }
  if (flipsIndicateFlake && (!appDiff || appDiff.files.length === 0)) {
    return {
      classification: 'FLAKY_NONDETERMINISTIC',
      confidence: 0.85,
      source: 'prefilter-flake',
      rationale: `Intermittent across history (${history.flips} flips in ${history.totalRuns} runs) with no app change to attribute the failure to.`,
    };
  }
  return null;
}

const LOCATOR_NOT_FOUND_SIGNATURES = [
  /locator.*not found/i,
  /waiting for.*locator/i,
  /element.*not.*(found|visible|attached)/i,
  /strict mode violation/i,
  /Timed out.*waiting for.*getBy/i,
];

export function selectorDriftFilter(evidence: EvidenceBundle): PrefilterResult | null {
  const { appDiff, failure, testSource } = evidence;
  if (!appDiff) return null;

  const locatorError = LOCATOR_NOT_FOUND_SIGNATURES.some(
    (sig) => sig.test(failure.errorMessage) || sig.test(failure.stackTrace),
  );
  if (!locatorError) return null;
  if (!isPureSelectorDiff(appDiff)) return null;

  const rename = detectSelectorRename(appDiff, extractSelectors(testSource));
  if (!rename) return null;

  return {
    classification: 'BENIGN_DRIFT',
    confidence: 0.97,
    source: 'prefilter-selector-drift',
    rationale: `App diff is exclusively selector-attribute changes; testid "${rename.oldSelector}" (used by this test) was renamed to "${rename.newSelector}"; failure is a locator-not-found. Test intent unaffected.`,
    suggestedSelectorFix: rename,
  };
}

export function runPrefilters(evidence: EvidenceBundle): PrefilterResult | null {
  return flakeFilter(evidence) ?? selectorDriftFilter(evidence);
}
