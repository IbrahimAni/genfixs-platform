import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { api, setToken, UnauthorizedError, type ProjectSummary } from './lib/api';
import { DiagnosisPage } from './pages/DiagnosisPage';
import { FailuresPage } from './pages/FailuresPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { OverviewPage } from './pages/OverviewPage';
import { QuarantinePage } from './pages/QuarantinePage';
import { SettingsPage } from './pages/SettingsPage';

function TokenGate({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setToken(value.trim());
    onSubmit();
  };
  return (
    <div className="grid min-h-screen place-items-center">
      <form onSubmit={submit} className="w-80">
        <div className="mb-1 text-sm font-semibold tracking-tight">GenFixs</div>
        <p className="mb-4 text-sm text-ink-500">
          This API requires a token (<span className="font-mono text-xs">GENFIXS_API_TOKEN</span>).
        </p>
        <input
          type="password"
          autoFocus
          className="w-full rounded border border-ink-200 bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          placeholder="API token"
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
        />
        <button
          type="submit"
          className="mt-3 rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Continue
        </button>
      </form>
    </div>
  );
}

function ProjectLayout({ projects }: { projects: ProjectSummary[] }) {
  const { projectId } = useParams();
  const project = projects.find((p) => p.id === projectId);
  if (!project) return <Navigate to="/" replace />;

  const nav = [
    { to: `/projects/${project.id}`, label: 'Overview', end: true },
    { to: `/projects/${project.id}/failures`, label: 'Failures', end: false },
    { to: `/projects/${project.id}/quarantine`, label: 'Quarantine', end: false },
    { to: `/projects/${project.id}/settings`, label: 'Settings', end: false },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl">
      <aside className="w-52 shrink-0 border-r border-ink-200 px-5 py-8">
        <div className="mb-1 text-sm font-semibold tracking-tight">GenFixs</div>
        <div className="mb-8 truncate text-xs text-ink-500">
          {project.org.name} / {project.name}
        </div>
        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded px-2.5 py-1.5 text-sm ${
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-700 hover:bg-ink-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 border-t border-ink-100 pt-4">
          <Link to="/new" className="text-xs text-ink-400 hover:text-accent">
            + Connect another project
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">
        <Routes>
          <Route index element={<OverviewPage projectId={project.id} />} />
          <Route path="failures" element={<FailuresPage projectId={project.id} />} />
          <Route path="quarantine" element={<QuarantinePage projectId={project.id} />} />
          <Route path="settings" element={<SettingsPage projectId={project.id} />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    setNeedsToken(false);
    api.projects().then(setProjects, (e: Error) => {
      if (e instanceof UnauthorizedError) setNeedsToken(true);
      else setError(e.message);
    });
  }, [reloadKey]);

  if (needsToken) return <TokenGate onSubmit={() => setReloadKey((k) => k + 1)} />;
  if (error)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-ink-500">
        Could not reach the GenFixs API. Is it running?{' '}
        <span className="ml-2 font-mono text-xs">{error}</span>
      </div>
    );
  if (!projects)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-ink-400">Loading…</div>
    );
  if (projects.length === 0)
    return (
      <Routes>
        <Route path="/new" element={<NewProjectPage />} />
        <Route
          path="*"
          element={
            <div className="grid min-h-screen place-items-center">
              <div className="text-center">
                <div className="mb-2 text-sm font-semibold tracking-tight">GenFixs</div>
                <p className="mb-4 text-sm text-ink-500">No projects connected yet.</p>
                <Link
                  to="/new"
                  className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Connect your first project
                </Link>
              </div>
            </div>
          }
        />
      </Routes>
    );

  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/projects/${projects[0]!.id}`} replace />} />
      <Route path="/new" element={<NewProjectPage />} />
      <Route path="/projects/:projectId/*" element={<ProjectLayout projects={projects} />} />
      <Route path="/diagnoses/:diagnosisId" element={<DiagnosisPage />} />
    </Routes>
  );
}
