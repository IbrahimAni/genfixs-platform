import type {
  AppDiff,
  EvidenceBundle,
  GitHubClient,
  IntentArtifact,
  Project,
  TestResult,
  TestRun,
  TestStatus,
} from '@genfixs/domain';
import { computeRunHistoryStats } from './flakeStats.js';
import {
  extractSelectors,
  findRelevantAppPaths,
  serializeSelector,
} from './selectorAnalysis.js';

export interface EvidenceBuilderDeps {
  github: GitHubClient;
  /** Most-recent-last statuses for a testId across prior runs (unchanged test code). */
  getHistory(projectId: string, testId: string): Promise<TestStatus[]>;
  getIntentArtifacts(projectId: string, testId: string): Promise<IntentArtifact[]>;
}

/**
 * Assembles the diagnosis context (spec §10.3). The app-repo connection is
 * optional; absence degrades gracefully to a bundle without `appDiff`, which
 * biases diagnosis toward less destructive outcomes downstream.
 */
export class EvidenceBuilder {
  constructor(private readonly deps: EvidenceBuilderDeps) {}

  async build(project: Project, run: TestRun, result: TestResult): Promise<EvidenceBundle> {
    if (result.status !== 'failed' || !result.failure) {
      throw new Error(`Evidence is only built for failed tests (got ${result.status})`);
    }

    const testSource =
      (await this.deps.github.getFileContent(project.testRepo, result.file, run.commitSha)) ?? '';

    let appDiff: AppDiff | undefined;
    if (project.appRepo && run.lastGreenSha && run.lastGreenSha !== run.commitSha) {
      appDiff = await this.deps.github.compareCommits(
        project.appRepo,
        run.lastGreenSha,
        run.commitSha,
      );
    }

    const selectors = extractSelectors(testSource);
    const history = computeRunHistoryStats(
      await this.deps.getHistory(project.id, result.testId),
    );
    const intentArtifacts = await this.deps.getIntentArtifacts(project.id, result.testId);

    return {
      testId: result.testId,
      runId: run.id,
      testSource,
      failure: result.failure,
      ...(appDiff ? { appDiff } : {}),
      history,
      intentArtifacts,
      selectorsInTest: selectors.map(serializeSelector),
      relevantAppPaths: findRelevantAppPaths(appDiff, testSource, selectors),
    };
  }
}
