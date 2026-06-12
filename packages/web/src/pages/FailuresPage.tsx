import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  ClassificationBadge,
  EmptyState,
  Mono,
  PageHeader,
  SectionTitle,
  Tag,
  Td,
  Th,
} from '../components/ui';
import { api, type Classification, type FailureRow } from '../lib/api';

const GROUP_ORDER: Classification[] = [
  'REAL_REGRESSION_SUSPECTED',
  'BEHAVIOR_CHANGE',
  'BENIGN_DRIFT',
  'FEATURE_MISSING',
  'FLAKY_NONDETERMINISTIC',
  'UNCLASSIFIED',
];

function ActionCell({ failure }: { failure: FailureRow }) {
  const a = failure.action;
  if (!a) return <Tag>pending</Tag>;
  switch (a.kind) {
    case 'HEAL':
      return (
        <span className="flex items-center gap-2">
          <Tag tone="ok">healed</Tag>
          {a.pr && (
            <a className="text-accent hover:underline" href={a.pr.url} target="_blank" rel="noreferrer">
              PR #{a.pr.number}
            </a>
          )}
          {a.autoMerged === false && <span className="text-xs text-ink-400">awaiting review</span>}
        </span>
      );
    case 'PROPOSE_REWRITE':
      return (
        <span className="flex items-center gap-2">
          <Tag tone="warn">rewrite proposed</Tag>
          {a.pr && (
            <a className="text-accent hover:underline" href={a.pr.url} target="_blank" rel="noreferrer">
              PR #{a.pr.number}
            </a>
          )}
          <span className="text-xs text-ink-400">needs your confirmation</span>
        </span>
      );
    case 'REPORT_REGRESSION':
      return (
        <span className="flex items-center gap-2">
          <Tag tone="bad">bug reported</Tag>
          {a.report?.issue && (
            <a
              className="text-accent hover:underline"
              href={a.report.issue.url}
              target="_blank"
              rel="noreferrer"
            >
              issue #{a.report.issue.number}
            </a>
          )}
          <span className="text-xs text-ink-400">test untouched</span>
        </span>
      );
    case 'QUARANTINE':
      return <Tag>quarantined</Tag>;
    case 'RECOMMEND_REMOVAL':
      return (
        <span className="flex items-center gap-2">
          <Tag tone="warn">removal recommended</Tag>
          <span className="text-xs text-ink-400">requires sign-off</span>
        </span>
      );
    case 'ESCALATE':
      return <Tag tone="warn">escalated</Tag>;
    default:
      return <Tag>{a.kind}</Tag>;
  }
}

export function FailuresPage({ projectId }: { projectId: string }) {
  const [failures, setFailures] = useState<FailureRow[] | null>(null);
  useEffect(() => {
    api.failures(projectId).then(setFailures, console.error);
  }, [projectId]);

  if (!failures) return null;

  const groups = GROUP_ORDER.map((c) => ({
    classification: c,
    rows: failures.filter((f) => f.classification === c),
  })).filter((g) => g.rows.length > 0);

  return (
    <div>
      <PageHeader
        title="Failures inbox"
        subtitle="Every diagnosed break, grouped by classification. Most destructive judgment first."
      />
      {groups.length === 0 && <EmptyState>No diagnosed failures. The suite is quiet.</EmptyState>}
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.classification}>
            <SectionTitle>
              <span className="flex items-center gap-2 normal-case tracking-normal">
                <ClassificationBadge value={group.classification} />
                <span className="text-ink-400">{group.rows.length}</span>
              </span>
            </SectionTitle>
            <Card>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <Th>Failure</Th>
                    <Th className="w-24">Confidence</Th>
                    <Th className="w-72">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((f) => (
                    <tr key={f.id} className="hover:bg-ink-100/40">
                      <Td>
                        <Link to={`/diagnoses/${f.id}`} className="group block">
                          <Mono className="text-ink-900 group-hover:text-accent">
                            {f.errorMessage.length > 96
                              ? `${f.errorMessage.slice(0, 96)}…`
                              : f.errorMessage}
                          </Mono>
                          <div className="mt-1 text-xs text-ink-400">
                            {new Date(f.createdAt).toLocaleDateString()} · {f.source}
                            {f.degradedFrom && ` · degraded from ${f.degradedFrom}`}
                          </div>
                        </Link>
                      </Td>
                      <Td className="tabular-nums text-ink-700">
                        {Math.round(f.confidence * 100)}%
                      </Td>
                      <Td>
                        <ActionCell failure={f} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
