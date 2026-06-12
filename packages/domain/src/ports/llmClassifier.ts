import type { Classification } from '../classification.js';
import type { EvidenceBundle } from '../evidence.js';

export interface LlmClassificationResult {
  classification: Classification;
  confidence: number;
  rationale: string;
  suggestedSelectorFix?: { oldSelector: string; newSelector: string };
}

/**
 * LLM classification over the evidence bundle, reserved for cases the deterministic
 * pre-filters could not settle (spec §10.4). The model CLASSIFIES; it never decides
 * actions — its output flows through the orchestrator's deterministic policy.
 */
export interface LlmClassifier {
  classify(evidence: EvidenceBundle): Promise<LlmClassificationResult>;
}
