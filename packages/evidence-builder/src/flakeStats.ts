import type { RunHistoryStats, TestStatus } from '@genfixs/domain';

/**
 * Run-history statistics for deterministic flake detection (spec §10.3/§10.4).
 * `statuses` is most-recent-last for a single testId, restricted by the caller
 * to runs where the test's code was unchanged (DECISIONS.md D4).
 */
export function computeRunHistoryStats(statuses: TestStatus[], window = 10): RunHistoryStats {
  const recent = statuses.slice(-window);
  let flips = 0;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    const prevBinary = prev === 'passed' ? 'pass' : prev === 'failed' ? 'fail' : null;
    const currBinary = curr === 'passed' ? 'pass' : curr === 'failed' ? 'fail' : null;
    if (prevBinary && currBinary && prevBinary !== currBinary) flips++;
  }
  return {
    totalRuns: recent.length,
    failures: recent.filter((s) => s === 'failed').length,
    flips,
    recentStatuses: recent,
  };
}
