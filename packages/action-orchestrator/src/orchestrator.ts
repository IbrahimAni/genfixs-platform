import type {
  ActionRecord,
  AgentAction,
  AuditEvent,
  AuthoredFix,
  BrowserRunResult,
  Clock,
  Diagnosis,
  IdGenerator,
  IssueRef,
  Project,
  PullRequestRef,
  QuarantineRecord,
  RegressionReport,
  TestFlowModel,
} from '@genfixs/domain';
import { decideAction } from './policy.js';

/** Implemented by @genfixs/fix-author (structurally; wired in the api layer). */
export interface FixAuthorPort {
  authorHeal(
    project: Project,
    diagnosis: Diagnosis,
  ): Promise<{ fix: AuthoredFix } | { rejected: string }>;
  authorRewrite(project: Project, diagnosis: Diagnosis): Promise<{ fix: AuthoredFix }>;
}

/** Implemented by the verification sandbox in @genfixs/fix-author. */
export interface VerifierPort {
  verify(project: Project, fix: AuthoredFix): Promise<BrowserRunResult>;
}

/** Implemented by @genfixs/pr-service. */
export interface PrPort {
  openHealPr(
    project: Project,
    diagnosis: Diagnosis,
    fix: AuthoredFix,
    options: { autoMerge: boolean },
  ): Promise<{ pr: PullRequestRef; autoMerged: boolean }>;
  openRewritePr(
    project: Project,
    diagnosis: Diagnosis,
    fix: AuthoredFix,
  ): Promise<{ pr: PullRequestRef }>;
  createRegressionIssue(project: Project, report: RegressionReport): Promise<IssueRef>;
}

export interface OrchestratorDeps {
  fixAuthor: FixAuthorPort;
  verifier: VerifierPort;
  prService: PrPort;
  saveQuarantine(record: Omit<QuarantineRecord, 'id'>): Promise<QuarantineRecord>;
  saveFlowTrace(trace: Omit<TestFlowModel, 'id'>): Promise<void>;
  saveAction(record: ActionRecord): Promise<void>;
  audit(event: Omit<AuditEvent, 'id' | 'at'>): Promise<void>;
  clock: Clock;
  ids: IdGenerator;
}

/**
 * Executes policy decisions (spec §10.5). The non-negotiables live here, in
 * code, not in the UI and not in model judgment:
 *
 *  - Only a HEAL decision can reach the heal path, and a heal that fails
 *    verification NEVER becomes a PR — it degrades to quarantine.
 *  - Auto-merge requires decision eligibility AND verified green.
 *  - Regressions produce a report; no code path from here edits the test.
 *  - Quarantine is the only removal-adjacent outcome; removal recommendations
 *    are recorded for a human and never executed.
 */
export class ActionOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async execute(project: Project, diagnosis: Diagnosis): Promise<ActionRecord> {
    const decision = decideAction(diagnosis, project.policies);

    switch (decision.kind) {
      case 'HEAL':
        return this.executeHeal(project, diagnosis, decision.autoMergeEligible);
      case 'PROPOSE_REWRITE':
        return this.executeRewrite(project, diagnosis);
      case 'REPORT_REGRESSION':
        return this.executeRegressionReport(project, diagnosis);
      case 'QUARANTINE':
        return this.executeQuarantine(project, diagnosis, decision);
    }
  }

  private async executeHeal(
    project: Project,
    diagnosis: Diagnosis,
    autoMergeEligible: boolean,
  ): Promise<ActionRecord> {
    const authored = await this.deps.fixAuthor.authorHeal(project, diagnosis);
    if ('rejected' in authored) {
      // The author's structural guard refused (would touch assertions/flow).
      await this.deps.audit({
        projectId: project.id,
        actor: 'system',
        type: 'heal.rejected-by-guard',
        testId: diagnosis.testId,
        runId: diagnosis.runId,
        detail: { reason: authored.rejected },
      });
      return this.quarantineFallback(project, diagnosis, 'verification-failed', authored.rejected);
    }

    const verification = await this.deps.verifier.verify(project, authored.fix);
    await this.recordVerification(project, diagnosis, verification);

    if (!verification.passed) {
      // Heal silently, fail loudly: an unverified heal is never surfaced (spec §10.7).
      return this.quarantineFallback(
        project,
        diagnosis,
        'verification-failed',
        `Authored heal did not verify green: ${verification.errorMessage ?? 'unknown failure'}`,
      );
    }

    const { pr, autoMerged } = await this.deps.prService.openHealPr(project, diagnosis, authored.fix, {
      autoMerge: autoMergeEligible,
    });
    return this.record(project, diagnosis, { kind: 'HEAL', pr, autoMerged });
  }

  private async executeRewrite(project: Project, diagnosis: Diagnosis): Promise<ActionRecord> {
    const { fix } = await this.deps.fixAuthor.authorRewrite(project, diagnosis);
    const verification = await this.deps.verifier.verify(project, fix);
    await this.recordVerification(project, diagnosis, verification);

    if (!verification.passed) {
      return this.quarantineFallback(
        project,
        diagnosis,
        'verification-failed',
        `Proposed rewrite did not verify green: ${verification.errorMessage ?? 'unknown failure'}`,
      );
    }

    // Author, do not notify — but never auto-merge a behavioral change (R4).
    const { pr } = await this.deps.prService.openRewritePr(project, diagnosis, fix);
    return this.record(project, diagnosis, { kind: 'PROPOSE_REWRITE', pr });
  }

  private async executeRegressionReport(
    project: Project,
    diagnosis: Diagnosis,
  ): Promise<ActionRecord> {
    const report = buildRegressionReport(diagnosis);
    const issue = await this.deps.prService.createRegressionIssue(project, report);
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: 'issue.opened',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: { issue: issue.url },
    });
    return this.record(project, diagnosis, {
      kind: 'REPORT_REGRESSION',
      report: { ...report, issue },
    });
  }

  private async executeQuarantine(
    project: Project,
    diagnosis: Diagnosis,
    decision: Extract<ReturnType<typeof decideAction>, { kind: 'QUARANTINE' }>,
  ): Promise<ActionRecord> {
    await this.deps.saveQuarantine({
      projectId: project.id,
      testId: diagnosis.testId,
      diagnosisId: diagnosis.id,
      reason: decision.reason,
      hypothesis: decision.hypothesis,
      ...(decision.removalRecommendation
        ? { removalRecommendation: decision.removalRecommendation }
        : {}),
      quarantinedAt: this.deps.clock.now(),
      status: 'active',
    });
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: 'quarantine.added',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: { reason: decision.reason, escalate: decision.escalate },
    });

    if (decision.removalRecommendation) {
      await this.deps.audit({
        projectId: project.id,
        actor: 'system',
        type: 'removal.recommended',
        testId: diagnosis.testId,
        runId: diagnosis.runId,
        detail: { rationale: decision.removalRecommendation.rationale },
      });
      return this.record(project, diagnosis, {
        kind: 'RECOMMEND_REMOVAL',
        rationale: decision.removalRecommendation.rationale,
      });
    }
    if (decision.escalate) {
      return this.record(project, diagnosis, {
        kind: 'ESCALATE',
        reason: decision.hypothesis,
      });
    }
    return this.record(project, diagnosis, {
      kind: 'QUARANTINE',
      hypothesis: decision.hypothesis,
    });
  }

  private async quarantineFallback(
    project: Project,
    diagnosis: Diagnosis,
    reason: 'verification-failed',
    hypothesis: string,
  ): Promise<ActionRecord> {
    return this.executeQuarantine(project, diagnosis, {
      kind: 'QUARANTINE',
      reason,
      hypothesis,
      escalate: true,
    });
  }

  private async recordVerification(
    project: Project,
    diagnosis: Diagnosis,
    verification: BrowserRunResult,
  ): Promise<void> {
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: verification.passed ? 'verification.passed' : 'verification.failed',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: { error: verification.errorMessage ?? null },
    });
    // P2 insurance: flow traces persist from day one (spec §9 design note).
    if (verification.flowTrace.length > 0) {
      await this.deps.saveFlowTrace({
        projectId: project.id,
        testId: diagnosis.testId,
        runId: diagnosis.runId,
        capturedAt: this.deps.clock.now(),
        steps: verification.flowTrace,
      });
    }
  }

  private async record(
    project: Project,
    diagnosis: Diagnosis,
    action: AgentAction,
  ): Promise<ActionRecord> {
    const record: ActionRecord = {
      id: this.deps.ids.next('act'),
      projectId: project.id,
      diagnosisId: diagnosis.id,
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      classification: diagnosis.classification,
      action,
      decidedAt: this.deps.clock.now(),
    };
    await this.deps.saveAction(record);
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: 'action.decided',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: { kind: action.kind, classification: diagnosis.classification },
    });
    return record;
  }
}

export function buildRegressionReport(diagnosis: Diagnosis): RegressionReport {
  const { evidence } = diagnosis;
  const suspectFiles =
    evidence.relevantAppPaths.length > 0
      ? evidence.relevantAppPaths.join(', ')
      : (evidence.appDiff?.files.map((f) => f.path).join(', ') ?? 'unknown (no app diff)');
  return {
    testId: diagnosis.testId,
    runId: diagnosis.runId,
    failingAssertion: evidence.failure.errorMessage,
    suspectAppChange: `Suspect change between ${evidence.appDiff?.baseSha ?? '?'} and ${evidence.appDiff?.headSha ?? '?'} in: ${suspectFiles}`,
    reproductionSteps: [
      `Check out commit ${evidence.appDiff?.headSha ?? '(failing commit)'}`,
      `Run the failing test (see stack trace for location)`,
      `Observe: ${evidence.failure.errorMessage}`,
    ],
    severityHint: 'high',
  };
}
