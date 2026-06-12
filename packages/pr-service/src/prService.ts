import type {
  AuditEvent,
  AuthoredFix,
  Diagnosis,
  GitHubClient,
  IssueRef,
  Project,
  PullRequestRef,
  RegressionReport,
} from '@genfixs/domain';
import { healPrBody, regressionIssueBody, rewritePrBody } from './prBodies.js';

export class PolicyViolationError extends Error {}

export interface PrServiceDeps {
  github: GitHubClient;
  audit(event: Omit<AuditEvent, 'id' | 'at'>): Promise<void>;
}

/**
 * The PR boundary (spec §10.8). Defense in depth: even though the orchestrator
 * already enforces policy, this service independently refuses auto-merge for
 * anything but BENIGN_DRIFT heals and refuses heal PRs for non-drift
 * diagnoses. Two layers must both be wrong for a false green to ship.
 */
export class PrService {
  constructor(private readonly deps: PrServiceDeps) {}

  async openHealPr(
    project: Project,
    diagnosis: Diagnosis,
    fix: AuthoredFix,
    options: { autoMerge: boolean },
  ): Promise<{ pr: PullRequestRef; autoMerged: boolean }> {
    if (diagnosis.classification !== 'BENIGN_DRIFT') {
      throw new PolicyViolationError(
        `Heal PRs are only permitted for BENIGN_DRIFT; got ${diagnosis.classification}`,
      );
    }
    if (fix.kind !== 'heal') {
      throw new PolicyViolationError(`openHealPr received a ${fix.kind} fix`);
    }

    const pr = await this.deps.github.openPullRequest({
      repo: project.testRepo,
      branch: `genfixs/heal/${diagnosis.testId}`,
      baseBranch: project.testRepo.defaultBranch,
      title: `fix(test): heal locator drift in ${fix.testTitle}`,
      body: healPrBody(diagnosis, fix),
      files: fix.files,
    });
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: 'pr.opened',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: { kind: 'heal', url: pr.url },
    });

    let autoMerged = false;
    if (options.autoMerge) {
      // Re-check the policy at this boundary rather than trusting the caller.
      if (project.policies.autoMergeBenignDrift !== true) {
        await this.deps.audit({
          projectId: project.id,
          actor: 'system',
          type: 'pr.auto-merge-refused',
          testId: diagnosis.testId,
          detail: { reason: 'project policy has not opted in to auto-merge' },
        });
      } else {
        await this.deps.github.enableAutoMerge(pr);
        autoMerged = true;
        await this.deps.audit({
          projectId: project.id,
          actor: 'system',
          type: 'pr.auto-merge-enabled',
          testId: diagnosis.testId,
          detail: { url: pr.url },
        });
      }
    }
    return { pr, autoMerged };
  }

  async openRewritePr(
    project: Project,
    diagnosis: Diagnosis,
    fix: AuthoredFix,
  ): Promise<{ pr: PullRequestRef }> {
    if (diagnosis.classification !== 'BEHAVIOR_CHANGE') {
      throw new PolicyViolationError(
        `Rewrite PRs are only permitted for BEHAVIOR_CHANGE; got ${diagnosis.classification}`,
      );
    }

    const pr = await this.deps.github.openPullRequest({
      repo: project.testRepo,
      branch: `genfixs/rewrite/${diagnosis.testId}`,
      baseBranch: project.testRepo.defaultBranch,
      title: `test: proposed update for changed flow — ${fix.testTitle} (needs confirmation)`,
      body: rewritePrBody(diagnosis, fix),
      files: fix.files,
    });
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: 'pr.opened',
      testId: diagnosis.testId,
      runId: diagnosis.runId,
      detail: { kind: 'rewrite', url: pr.url, requiresHumanApproval: true },
    });
    // Note the absence of any enableAutoMerge path here: rewrites cannot
    // auto-merge by construction (R4).
    return { pr };
  }

  async createRegressionIssue(project: Project, report: RegressionReport): Promise<IssueRef> {
    const targetRepo = project.appRepo ?? project.testRepo;
    const issue = await this.deps.github.createIssue({
      repo: targetRepo,
      title: `Suspected regression: ${report.failingAssertion.slice(0, 80)}`,
      body: regressionIssueBody(report),
      labels: ['genfixs', 'regression-suspected'],
    });
    await this.deps.audit({
      projectId: project.id,
      actor: 'system',
      type: 'issue.opened',
      testId: report.testId,
      runId: report.runId,
      detail: { url: issue.url },
    });
    return issue;
  }
}
