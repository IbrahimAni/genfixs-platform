import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  EmptyState,
  Mono,
  PageHeader,
  Tag,
  Td,
  Th,
} from '../components/ui';
import { api, type QuarantineRow } from '../lib/api';

const REASON_LABEL: Record<string, string> = {
  'flaky-nondeterministic': 'flaky',
  unclassified: 'unclassified',
  'cannot-locate': 'cannot locate',
  'verification-failed': 'verification failed',
  'below-confidence-threshold': 'low confidence',
};

export function QuarantinePage({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<QuarantineRow[] | null>(null);

  const load = useCallback(() => {
    api.quarantine(projectId).then(setRows, console.error);
  }, [projectId]);
  useEffect(load, [load]);

  if (!rows) return null;
  const active = rows.filter((r) => r.status === 'active');
  const released = rows.filter((r) => r.status === 'released');

  return (
    <div>
      <PageHeader
        title="Quarantine"
        subtitle="Skipped with annotation, never deleted. Each entry carries a root-cause hypothesis; release or removal is yours to decide."
      />
      {active.length === 0 && <EmptyState>Quarantine is empty.</EmptyState>}
      {active.length > 0 && (
        <Card>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th className="w-28">Reason</Th>
                <Th>Hypothesis</Th>
                <Th className="w-20">Age</Th>
                <Th className="w-24"></Th>
              </tr>
            </thead>
            <tbody>
              {active.map((q) => (
                <tr key={q.id} className="hover:bg-ink-100/40">
                  <Td>
                    <Tag tone={q.reason === 'flaky-nondeterministic' ? 'neutral' : 'warn'}>
                      {REASON_LABEL[q.reason] ?? q.reason}
                    </Tag>
                  </Td>
                  <Td>
                    <Link to={`/diagnoses/${q.diagnosisId}`} className="group block">
                      <span className="text-sm leading-6 text-ink-700 group-hover:text-accent">
                        {q.hypothesis.length > 160 ? `${q.hypothesis.slice(0, 160)}…` : q.hypothesis}
                      </span>
                    </Link>
                    {q.removalRecommendation && (
                      <div className="mt-2 rounded border border-warn/20 bg-warn-soft px-3 py-2 text-xs leading-5 text-warn">
                        <span className="font-semibold">Removal recommended</span> — requires your
                        explicit sign-off. {q.removalRecommendation.rationale}
                      </div>
                    )}
                    <Mono className="mt-1 block text-[11px] text-ink-400">test {q.testId.slice(0, 12)}</Mono>
                  </Td>
                  <Td className="tabular-nums text-ink-700">{q.ageDays}d</Td>
                  <Td>
                    <button
                      className="rounded border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700 hover:border-accent hover:text-accent"
                      onClick={() => api.releaseQuarantine(q.id).then(load)}
                    >
                      Release
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {released.length > 0 && (
        <p className="mt-4 text-xs text-ink-400">
          {released.length} released record{released.length === 1 ? '' : 's'} retained in the audit
          trail.
        </p>
      )}
    </div>
  );
}
