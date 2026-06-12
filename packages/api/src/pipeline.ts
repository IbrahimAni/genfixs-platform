import { ActionOrchestrator } from '@genfixs/action-orchestrator';
import { DiagnosisEngine } from '@genfixs/diagnosis-engine';
import { EvidenceBuilder } from '@genfixs/evidence-builder';
import {
  DIAGNOSIS_READY,
  DiagnosisReadyEventSchema,
  EVIDENCE_READY,
  EvidenceReadyEventSchema,
  RUN_INGESTED,
  RunIngestedEventSchema,
  randomIdGenerator,
  systemClock,
  type AuditEvent,
  type Clock,
  type GitHubClient,
  type IdGenerator,
  type Queue,
} from '@genfixs/domain';
import { FixAuthor, VerificationSandbox, type RewriteModel } from '@genfixs/fix-author';
import type { BrowserRunner, LlmClassifier } from '@genfixs/domain';
import { PrService } from '@genfixs/pr-service';
import type { Repositories } from './repositories/interfaces.js';

export interface PipelineDeps {
  repos: Repositories;
  queue: Queue;
  github: GitHubClient;
  classifier: LlmClassifier;
  rewriteModel: RewriteModel;
  browserRunner: BrowserRunner;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Wires the event-driven core (spec §10):
 * run.ingested → evidence.ready → diagnosis.ready → orchestrated action.
 */
export function wirePipeline(deps: PipelineDeps): void {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? randomIdGenerator;
  const { repos, queue } = deps;

  const audit = async (event: Omit<AuditEvent, 'id' | 'at'>): Promise<void> => {
    await repos.audit.append({ ...event, id: ids.next('audit'), at: clock.now() });
  };

  const evidenceBuilder = new EvidenceBuilder({
    github: deps.github,
    getHistory: (projectId, testId) => repos.runs.historyStatuses(projectId, testId),
    getIntentArtifacts: (projectId, testId) => repos.intent.listForTest(projectId, testId),
  });

  const diagnosisEngine = new DiagnosisEngine({ classifier: deps.classifier, clock, ids });

  const orchestrator = new ActionOrchestrator({
    fixAuthor: new FixAuthor({ rewriteModel: deps.rewriteModel }),
    verifier: new VerificationSandbox(deps.browserRunner),
    prService: new PrService({ github: deps.github, audit }),
    saveQuarantine: async (record) => {
      const saved = { ...record, id: ids.next('quar') };
      await repos.quarantine.save(saved);
      return saved;
    },
    saveFlowTrace: async (trace) => {
      await repos.flowTraces.save({ ...trace, id: ids.next('flow') });
    },
    saveAction: (record) => repos.actions.save(record),
    audit,
    clock,
    ids,
  });

  queue.subscribe(RUN_INGESTED, async (payload) => {
    const event = RunIngestedEventSchema.parse(payload);
    const run = await repos.runs.get(event.runId);
    const project = await repos.projects.get(event.projectId);
    if (!run || !project) throw new Error(`Unknown run/project for ${JSON.stringify(event)}`);

    for (const result of run.results) {
      if (result.status !== 'failed') continue;
      const evidence = await evidenceBuilder.build(project, run, result);
      await repos.evidence.save(evidence);
      await audit({
        projectId: project.id,
        actor: 'system',
        type: 'evidence.built',
        testId: result.testId,
        runId: run.id,
        detail: { hasAppDiff: evidence.appDiff !== undefined },
      });
      await queue.publish(EVIDENCE_READY, {
        projectId: project.id,
        runId: run.id,
        testId: result.testId,
      });
    }
  });

  queue.subscribe(EVIDENCE_READY, async (payload) => {
    const event = EvidenceReadyEventSchema.parse(payload);
    const project = await repos.projects.get(event.projectId);
    const evidence = await repos.evidence.get(event.runId, event.testId);
    if (!project || !evidence) throw new Error(`Missing evidence for ${JSON.stringify(event)}`);

    const diagnosis = await diagnosisEngine.diagnose(project, evidence);
    await repos.diagnoses.save(diagnosis);
    await audit({
      projectId: project.id,
      actor: 'system',
      type: diagnosis.degradedFrom ? 'diagnosis.degraded' : 'diagnosis.created',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: {
        classification: diagnosis.classification,
        confidence: diagnosis.confidence,
        source: diagnosis.source,
      },
    });
    await queue.publish(DIAGNOSIS_READY, {
      projectId: project.id,
      diagnosisId: diagnosis.id,
    });
  });

  queue.subscribe(DIAGNOSIS_READY, async (payload) => {
    const event = DiagnosisReadyEventSchema.parse(payload);
    const project = await repos.projects.get(event.projectId);
    const diagnosis = await repos.diagnoses.get(event.diagnosisId);
    if (!project || !diagnosis) throw new Error(`Missing diagnosis ${event.diagnosisId}`);

    const record = await orchestrator.execute(project, diagnosis);
    await repos.diagnoses.save({ ...diagnosis, decidedAction: record.action });
  });
}
