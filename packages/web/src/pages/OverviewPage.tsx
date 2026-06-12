import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendChart } from '../components/TrendChart';
import { Card, ClassificationBadge, PageHeader, SectionTitle, Stat } from '../components/ui';
import { api, type Classification, type ProjectDetail } from '../lib/api';

const CLASSIFICATION_ORDER: Classification[] = [
  'BENIGN_DRIFT',
  'BEHAVIOR_CHANGE',
  'REAL_REGRESSION_SUSPECTED',
  'FEATURE_MISSING',
  'FLAKY_NONDETERMINISTIC',
  'UNCLASSIFIED',
];

export function OverviewPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  useEffect(() => {
    api.project(projectId).then(setProject, console.error);
  }, [projectId]);

  if (!project) return null;
  const s = project.snapshot;

  return (
    <div>
      <PageHeader
        title="Suite health"
        subtitle={`${project.testRepo.owner}/${project.testRepo.name} · ${project.framework}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Auto-heal rate"
          value={`${Math.round(s.autoHealRate * 100)}%`}
          hint={`${s.totalBreaks} breaks diagnosed`}
        />
        <Stat
          label="Regressions caught"
          value={String(s.regressionsCaught)}
          hint="reported, tests untouched"
        />
        <Stat
          label="Quarantine backlog"
          value={String(s.quarantineBacklog)}
          hint="skip-with-annotation"
        />
        <Stat
          label="False greens"
          value={String(s.falseGreenCount)}
          tone={s.falseGreenCount === 0 ? 'ok' : 'bad'}
          hint={s.falseGreenCount === 0 ? 'as it must be' : 'INCIDENT — investigate now'}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="px-5 py-4 lg:col-span-3">
          <SectionTitle>Pass / fail trend</SectionTitle>
          <TrendChart points={project.trend} />
        </Card>

        <Card className="px-5 py-4 lg:col-span-2">
          <SectionTitle>Breaks by classification</SectionTitle>
          <ul className="mt-1 flex flex-col gap-2.5">
            {CLASSIFICATION_ORDER.map((c) => (
              <li key={c} className="flex items-center justify-between gap-3">
                <ClassificationBadge value={c} />
                <span className="text-sm font-medium tabular-nums">
                  {s.breaksByClassification[c] ?? 0}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-400">
            Mean time to green: {s.meanTimeToGreen.toFixed(1)}h ·{' '}
            <Link className="text-accent hover:underline" to={`/projects/${projectId}/failures`}>
              open failures inbox
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
