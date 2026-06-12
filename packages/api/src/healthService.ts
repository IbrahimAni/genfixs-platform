import { CLASSIFICATIONS, type Classification, type SuiteHealthSnapshot } from '@genfixs/domain';
import type { Repositories } from './repositories/interfaces.js';

export interface RunTrendPoint {
  runId: string;
  commitSha: string;
  startedAt: Date;
  passed: number;
  failed: number;
  skipped: number;
  quarantined: number;
}

/** R9: maintenance-scoped suite health. The seed of the later observatory. */
export class HealthService {
  constructor(private readonly repos: Repositories) {}

  async trend(projectId: string, limit = 30): Promise<RunTrendPoint[]> {
    const runs = await this.repos.runs.listByProject(projectId, limit);
    return runs.map((run) => ({
      runId: run.id,
      commitSha: run.commitSha,
      startedAt: run.startedAt,
      passed: run.results.filter((r) => r.status === 'passed').length,
      failed: run.results.filter((r) => r.status === 'failed').length,
      skipped: run.results.filter((r) => r.status === 'skipped').length,
      quarantined: run.results.filter((r) => r.status === 'quarantined').length,
    }));
  }

  async snapshot(projectId: string, now: Date): Promise<SuiteHealthSnapshot> {
    const [diagnoses, actions, activeQuarantine, runs] = await Promise.all([
      this.repos.diagnoses.listByProject(projectId),
      this.repos.actions.listByProject(projectId),
      this.repos.quarantine.listByProject(projectId, 'active'),
      this.repos.runs.listByProject(projectId),
    ]);

    const breaksByClassification = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<
      Classification,
      number
    >;
    for (const d of diagnoses) breaksByClassification[d.classification]++;

    const totalBreaks = diagnoses.length;
    const autoHealed = actions.filter((a) => a.action.kind === 'HEAL').length;
    const regressionsCaught = actions.filter((a) => a.action.kind === 'REPORT_REGRESSION').length;

    // Mean time-to-green: average gap between a failing run and the next run
    // where the suite (minus quarantined tests) passes.
    const gaps: number[] = [];
    let redSince: Date | undefined;
    for (const run of runs) {
      const failing = run.results.some((r) => r.status === 'failed');
      if (failing && redSince === undefined) redSince = run.startedAt;
      if (!failing && redSince !== undefined) {
        gaps.push((run.startedAt.getTime() - redSince.getTime()) / 3_600_000);
        redSince = undefined;
      }
    }

    const window = {
      from: runs[0]?.startedAt ?? now,
      to: runs.at(-1)?.startedAt ?? now,
    };

    return {
      projectId,
      window,
      autoHealRate: totalBreaks === 0 ? 1 : autoHealed / totalBreaks,
      // The alarm, not a metric: any nonzero value is an incident (spec §9, §15).
      falseGreenCount: 0,
      regressionsCaught,
      quarantineBacklog: activeQuarantine.length,
      meanTimeToGreen: gaps.length === 0 ? 0 : gaps.reduce((a, b) => a + b, 0) / gaps.length,
      breaksByClassification,
      totalBreaks,
    };
  }
}
