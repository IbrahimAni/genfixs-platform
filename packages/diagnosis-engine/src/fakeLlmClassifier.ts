import type { EvidenceBundle, LlmClassificationResult, LlmClassifier } from '@genfixs/domain';
import { detectSelectorRename, extractSelectors, splitPatch } from '@genfixs/evidence-builder';

const ASSERTION_ERROR = /expect.*(received|to(Have|Be|Equal|Contain))|expected .* to (equal|be|contain)/i;
const LOCATOR_ERROR = /locator.*not found|waiting for.*locator|element.*not.*(found|visible)/i;
const FLAG_PATTERN = /feature.?flag|flags?\.|isEnabled|FEATURE_/i;
const LOGIC_PATTERN = /[-+*/]=|return .*[*+\-/]|if\s*\(|=>.*[*+\-/]|Math\./;

/**
 * Deterministic rule-based stand-in for the real model (DECISIONS.md D7). Mirrors
 * the signal patterns described in spec §8's evidence column so the orchestrator,
 * pipeline and demo behave realistically without network calls. Swap in a real
 * adapter (e.g. Claude) via the LlmClassifier port.
 */
export class FakeLlmClassifier implements LlmClassifier {
  async classify(evidence: EvidenceBundle): Promise<LlmClassificationResult> {
    const { appDiff, failure, testSource } = evidence;
    const assertionFailed = ASSERTION_ERROR.test(failure.errorMessage);
    const locatorFailed = LOCATOR_ERROR.test(failure.errorMessage);

    if (!appDiff || appDiff.files.length === 0) {
      return {
        classification: 'UNCLASSIFIED',
        confidence: 0.3,
        rationale: 'No app diff available and no deterministic signal; cannot attribute the failure.',
      };
    }

    // Scope signal analysis to files linked to this test; when no link is
    // known, fall back to every patched file (weaker evidence, lower stakes).
    const linkedFiles = appDiff.files.filter((f) => evidence.relevantAppPaths.includes(f.path));
    const relevantFiles =
      linkedFiles.length > 0 ? linkedFiles : appDiff.files.filter((f) => f.patch !== undefined);

    const removedFeatureFile = appDiff.files.find(
      (f) => f.status === 'removed' && evidence.relevantAppPaths.includes(f.path),
    );
    if (removedFeatureFile && locatorFailed) {
      return {
        classification: 'FEATURE_MISSING',
        confidence: 0.85,
        rationale: `App file ${removedFeatureFile.path} (linked to this test) was removed and the test can no longer locate its target.`,
      };
    }

    const flagGated = relevantFiles.some((f) => f.patch && FLAG_PATTERN.test(f.patch));
    if (flagGated && locatorFailed) {
      return {
        classification: 'FEATURE_MISSING',
        confidence: 0.72,
        rationale:
          'Target is unreachable but the diff shows feature-flag gating, not removal. Likely cannot-locate, not truly gone.',
      };
    }

    const logicChanged = relevantFiles.some((f) => {
      if (!f.patch) return false;
      const { removed, added } = splitPatch(f.patch);
      return [...removed, ...added].some((l) => LOGIC_PATTERN.test(l));
    });

    if (assertionFailed && logicChanged) {
      const addedUiSteps = relevantFiles.some((f) => {
        if (!f.patch) return false;
        const { added } = splitPatch(f.patch);
        return added.some((l) => /data-testid|<(button|input|select|form|step)/i.test(l));
      });
      if (addedUiSteps) {
        return {
          classification: 'BEHAVIOR_CHANGE',
          confidence: 0.82,
          rationale:
            'The app flow changed intentionally (new UI steps in the diff) and the test asserts the old flow.',
        };
      }
      return {
        classification: 'REAL_REGRESSION_SUSPECTED',
        confidence: 0.86,
        rationale:
          'Locators are untouched, the test assertion is sound, and the diff changes output-affecting logic. The app output is likely wrong.',
      };
    }

    if (locatorFailed && assertionFailed === false) {
      const rename = detectSelectorRename(appDiff, extractSelectors(testSource));
      if (rename) {
        return {
          classification: 'BENIGN_DRIFT',
          confidence: 0.8,
          rationale: `Selector rename detected (${rename.oldSelector} → ${rename.newSelector}) amid other changes; intent appears preserved but the diff is not purely cosmetic.`,
          suggestedSelectorFix: rename,
        };
      }
      const flowExtended = relevantFiles.some((f) => {
        if (!f.patch) return false;
        const { added, removed } = splitPatch(f.patch);
        return added.length > removed.length + 2;
      });
      if (flowExtended) {
        return {
          classification: 'BEHAVIOR_CHANGE',
          confidence: 0.78,
          rationale:
            'The diff substantially extends the relevant flow and the test no longer matches it.',
        };
      }
    }

    return {
      classification: 'UNCLASSIFIED',
      confidence: 0.4,
      rationale: 'Signals conflict or are too weak to classify safely.',
    };
  }
}
