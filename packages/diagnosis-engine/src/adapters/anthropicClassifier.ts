import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  CLASSIFICATIONS,
  type EvidenceBundle,
  type LlmClassificationResult,
  type LlmClassifier,
} from '@genfixs/domain';
import { z } from 'zod/v4';

const ClassifierOutputSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  confidence: z.number(),
  rationale: z.string(),
  suggestedSelectorFix: z.object({ oldSelector: z.string(), newSelector: z.string() }).nullable(),
});

export const CLASSIFIER_SYSTEM_PROMPT = `You are the failure-classification engine of GenFixs, an autonomous test-maintenance product. You classify why a single end-to-end test failed. You NEVER decide actions — a deterministic policy layer does that. Your only job is an honest classification with a calibrated confidence.

Classify into exactly one of:
- BENIGN_DRIFT: pure locator/selector drift (renamed testid, moved element); the app's behavior and the test's intent are unchanged. Requires the app diff to be cosmetic with respect to this test.
- BEHAVIOR_CHANGE: the app's flow or output changed in a way that looks intentional (new steps, changed copy backed by deliberate-looking code changes); the test asserts the old behavior.
- REAL_REGRESSION_SUSPECTED: the test's logic is sound and the app's output is wrong — the diff plausibly broke logic while locators are untouched. THIS IS THE MOST IMPORTANT CASE TO GET RIGHT: a discount that miscalculates, a total that comes out wrong. When evidence points here, never classify as drift or behavior change.
- FEATURE_MISSING: the test's target is unreachable; the diff suggests the feature was removed OR gated behind a flag (cannot-locate).
- FLAKY_NONDETERMINISTIC: timing/network/shared-state nondeterminism; intermittent history.
- UNCLASSIFIED: you cannot classify with confidence.

Bias rules (non-negotiable):
- A false green is worse than a false red. If signals conflict between BENIGN_DRIFT and anything behavioral, prefer the behavioral classification or UNCLASSIFIED.
- Claim BENIGN_DRIFT only when the diff is exclusively selector/attribute-level for the elements this test touches AND assertions would still protect the same intent. Set suggestedSelectorFix only in that case.
- Confidence is calibrated 0..1. Below-threshold confidence degrades to quarantine downstream — when unsure, say so via low confidence rather than guessing high.

Respond with the structured output only.`;

/** Compact, model-readable rendering of the evidence bundle. */
export function serializeEvidence(evidence: EvidenceBundle): string {
  const diff = evidence.appDiff
    ? evidence.appDiff.files
        .map((f) => `--- ${f.path} (${f.status}) ---\n${f.patch ?? '(no patch available)'}`)
        .join('\n')
    : '(app repository not connected — no diff available)';

  return `## Failing test source
\`\`\`ts
${evidence.testSource || '(unavailable)'}
\`\`\`

## Failure
Error: ${evidence.failure.errorMessage}
Stack: ${evidence.failure.stackTrace || '(none)'}

## App diff (last green -> failing commit)
${diff}

## Run history for this test (most recent last)
${evidence.history.recentStatuses.join(', ') || '(none)'} — ${evidence.history.flips} pass/fail flips in ${evidence.history.totalRuns} runs

## Selectors used by the test
${evidence.selectorsInTest.join(', ') || '(none extracted)'}

## App paths linked to this test
${evidence.relevantAppPaths.join(', ') || '(none)'}`;
}

export interface AnthropicClassifierOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Real LLM classifier over the Claude API. Output is structured (schema-
 * enforced) and still passes through the diagnosis engine's vocabulary
 * validation, confidence clamping, and policy thresholds — the model
 * classifies; it never decides.
 *
 * Credential: ANTHROPIC_API_KEY (see CREDENTIALS.md).
 */
export class AnthropicLlmClassifier implements LlmClassifier {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicClassifierOptions = {}) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? process.env['GENFIXS_CLASSIFIER_MODEL'] ?? 'claude-opus-4-8';
  }

  async classify(evidence: EvidenceBundle): Promise<LlmClassificationResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: CLASSIFIER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: serializeEvidence(evidence) }],
      output_config: { format: zodOutputFormat(ClassifierOutputSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      // Includes refusals and schema failures: never guess on the model's behalf.
      return {
        classification: 'UNCLASSIFIED',
        confidence: 0,
        rationale: `Classifier returned no parseable output (stop_reason: ${response.stop_reason}).`,
      };
    }

    return {
      classification: parsed.classification,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      ...(parsed.suggestedSelectorFix ? { suggestedSelectorFix: parsed.suggestedSelectorFix } : {}),
    };
  }
}
