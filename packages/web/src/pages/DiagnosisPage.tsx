import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, ClassificationBadge, Mono, PageHeader, SectionTitle, Tag } from '../components/ui';
import { api, type DiagnosisDetail } from '../lib/api';

function DiffView({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto rounded bg-ink-100/60 px-3 py-2 font-mono text-[12px] leading-5">
      {patch.split('\n').map((line, i) => (
        <div
          key={i}
          className={
            line.startsWith('+') ? 'text-ok' : line.startsWith('-') ? 'text-bad' : 'text-ink-500'
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

export function DiagnosisPage() {
  const { diagnosisId } = useParams();
  const [detail, setDetail] = useState<DiagnosisDetail | null>(null);
  useEffect(() => {
    if (diagnosisId) api.diagnosis(diagnosisId).then(setDetail, console.error);
  }, [diagnosisId]);

  if (!detail) return null;
  const { diagnosis, action, flowTraces } = detail;
  const e = diagnosis.evidence;

  return (
    <div className="mx-auto max-w-4xl px-10 py-8">
      <Link
        to={`/projects/${diagnosis.projectId}/failures`}
        className="mb-6 inline-block text-sm text-accent hover:underline"
      >
        ← Failures inbox
      </Link>
      <PageHeader
        title="Diagnosis"
        subtitle={`Run ${diagnosis.runId} · ${new Date(diagnosis.createdAt).toLocaleString()}`}
      />

      <div className="mb-6 flex items-center gap-3">
        <ClassificationBadge value={diagnosis.classification} />
        <span className="text-sm tabular-nums text-ink-700">
          {Math.round(diagnosis.confidence * 100)}% confidence
        </span>
        <Tag>{diagnosis.source}</Tag>
        {diagnosis.degradedFrom && <Tag tone="warn">degraded from {diagnosis.degradedFrom}</Tag>}
      </div>

      <div className="flex flex-col gap-6">
        <Card className="px-5 py-4">
          <SectionTitle>Why</SectionTitle>
          <p className="text-sm leading-6 text-ink-700">{diagnosis.rationale}</p>
          {diagnosis.suggestedSelectorFix && (
            <p className="mt-2 text-sm text-ink-700">
              Selector fix:{' '}
              <Mono className="text-bad line-through">
                {diagnosis.suggestedSelectorFix.oldSelector}
              </Mono>{' '}
              → <Mono className="text-ok">{diagnosis.suggestedSelectorFix.newSelector}</Mono>
            </p>
          )}
        </Card>

        <Card className="px-5 py-4">
          <SectionTitle>Action taken</SectionTitle>
          {!action && <p className="text-sm text-ink-500">Pending.</p>}
          {action && (
            <div className="text-sm leading-6 text-ink-700">
              <div className="mb-1 font-medium text-ink-900">
                {action.kind.replaceAll('_', ' ')}
              </div>
              {action.pr && (
                <a
                  className="text-accent hover:underline"
                  href={action.pr.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Pull request #{action.pr.number}
                </a>
              )}
              {action.report?.issue && (
                <a
                  className="text-accent hover:underline"
                  href={action.report.issue.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Issue #{action.report.issue.number}
                </a>
              )}
              {action.hypothesis && <p>{action.hypothesis}</p>}
              {action.rationale && <p>{action.rationale}</p>}
              {action.reason && <p>{action.reason}</p>}
            </div>
          )}
        </Card>

        <Card className="px-5 py-4">
          <SectionTitle>Failure</SectionTitle>
          <Mono className="block text-bad">{e.failure.errorMessage}</Mono>
          {e.failure.stackTrace && (
            <Mono className="mt-1 block text-ink-400">{e.failure.stackTrace}</Mono>
          )}
          <div className="mt-3 text-xs text-ink-400">
            History: {e.history.failures}/{e.history.totalRuns} recent runs failed ·{' '}
            {e.history.flips} pass↔fail flips
          </div>
        </Card>

        {e.appDiff && (
          <Card className="px-5 py-4">
            <SectionTitle>
              App change ({e.appDiff.baseSha.slice(0, 9)} → {e.appDiff.headSha.slice(0, 9)})
            </SectionTitle>
            <div className="flex flex-col gap-3">
              {e.appDiff.files.map((f) => (
                <div key={f.path}>
                  <div className="mb-1 flex items-center gap-2">
                    <Mono className="text-ink-900">{f.path}</Mono>
                    <Tag tone={f.status === 'removed' ? 'bad' : 'neutral'}>{f.status}</Tag>
                    {e.relevantAppPaths.includes(f.path) && <Tag tone="accent">linked to test</Tag>}
                  </div>
                  {f.patch && <DiffView patch={f.patch} />}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="px-5 py-4">
          <SectionTitle>Test source</SectionTitle>
          <pre className="overflow-x-auto rounded bg-ink-100/60 px-3 py-2 font-mono text-[12px] leading-5 text-ink-700">
            {e.testSource}
          </pre>
        </Card>

        {flowTraces.length > 0 && (
          <Card className="px-5 py-4">
            <SectionTitle>Verified flow trace</SectionTitle>
            <ol className="flex flex-col gap-1">
              {flowTraces.at(-1)!.steps.map((s) => (
                <li key={s.index} className="flex items-baseline gap-3 text-sm">
                  <span className="w-5 text-right text-xs tabular-nums text-ink-400">
                    {s.index + 1}
                  </span>
                  <span className="w-14 font-medium text-ink-700">{s.action}</span>
                  <Mono className="text-ink-500">{s.selector ?? s.url ?? ''}</Mono>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}
