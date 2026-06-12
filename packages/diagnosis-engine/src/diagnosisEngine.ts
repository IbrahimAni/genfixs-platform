import {
  ClassificationSchema,
  thresholdFor,
  type Clock,
  type Diagnosis,
  type EvidenceBundle,
  type IdGenerator,
  type LlmClassifier,
  type Project,
} from '@genfixs/domain';
import { runPrefilters } from './prefilters.js';

export interface DiagnosisEngineDeps {
  classifier: LlmClassifier;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * R2: deterministic pre-filters first; the model only sees genuinely ambiguous
 * cases. Whatever the source, confidence below the project-policy threshold for
 * the claimed classification ALWAYS degrades to UNCLASSIFIED — the engine never
 * emits an actionable classification it cannot back.
 */
export class DiagnosisEngine {
  constructor(private readonly deps: DiagnosisEngineDeps) {}

  async diagnose(project: Project, evidence: EvidenceBundle): Promise<Diagnosis> {
    const base = {
      id: this.deps.ids.next('diag'),
      projectId: project.id,
      testId: evidence.testId,
      runId: evidence.runId,
      evidence,
      createdAt: this.deps.clock.now(),
    };

    const prefilter = runPrefilters(evidence);
    if (prefilter) {
      return this.applyThreshold(project, {
        ...base,
        classification: prefilter.classification,
        confidence: prefilter.confidence,
        source: prefilter.source,
        rationale: prefilter.rationale,
        ...(prefilter.suggestedSelectorFix
          ? { suggestedSelectorFix: prefilter.suggestedSelectorFix }
          : {}),
      });
    }

    const result = await this.deps.classifier.classify(evidence);
    // Model output is untrusted: validate the classification vocabulary and
    // clamp confidence before anything downstream sees it.
    const classification = ClassificationSchema.safeParse(result.classification);
    const confidence = Math.max(0, Math.min(1, result.confidence));
    if (!classification.success) {
      return {
        ...base,
        classification: 'UNCLASSIFIED',
        confidence: 0,
        source: 'llm',
        rationale: `Model returned an unknown classification (${String(result.classification)}); degraded to UNCLASSIFIED.`,
      };
    }

    return this.applyThreshold(project, {
      ...base,
      classification: classification.data,
      confidence,
      source: 'llm',
      rationale: result.rationale,
      // A selector-fix suggestion is only meaningful (and only safe) on drift.
      ...(result.suggestedSelectorFix && classification.data === 'BENIGN_DRIFT'
        ? { suggestedSelectorFix: result.suggestedSelectorFix }
        : {}),
    });
  }

  private applyThreshold(project: Project, diagnosis: Diagnosis): Diagnosis {
    const threshold = thresholdFor(diagnosis.classification, project.policies);
    if (diagnosis.confidence >= threshold || diagnosis.classification === 'UNCLASSIFIED') {
      return diagnosis;
    }
    const { suggestedSelectorFix: _dropped, ...rest } = diagnosis;
    return {
      ...rest,
      classification: 'UNCLASSIFIED',
      degradedFrom: diagnosis.classification,
      rationale: `${diagnosis.rationale} [Degraded: confidence ${diagnosis.confidence.toFixed(2)} below ${diagnosis.classification} threshold ${threshold}.]`,
    };
  }
}
