import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, PageHeader, SectionTitle } from '../components/ui';
import { api } from '../lib/api';

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-900">{label}</span>
      {hint && <span className="block text-xs leading-5 text-ink-500">{hint}</span>}
      <input
        className="mt-1.5 w-full rounded border border-ink-200 bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        value={value}
        required={required}
        placeholder={placeholder ?? ''}
        onChange={(ev) => onChange(ev.target.value)}
      />
    </label>
  );
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [testRepo, setTestRepo] = useState('');
  const [appRepo, setAppRepo] = useState('');
  const [verificationBaseUrl, setVerificationBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parseRepo = (value: string) => {
    const [owner, repoName] = value.split('/');
    if (!owner || !repoName) return null;
    return { owner: owner.trim(), name: repoName.trim(), defaultBranch: 'main' };
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const test = parseRepo(testRepo);
    if (!test) return setError('Test repository must be in owner/name form.');
    const app = appRepo ? parseRepo(appRepo) : undefined;
    if (appRepo && !app) return setError('App repository must be in owner/name form.');

    setSubmitting(true);
    try {
      const project = await api.createProject({
        name,
        org: { id: orgName.toLowerCase().replace(/\W+/g, '-'), name: orgName },
        testRepo: test,
        ...(app ? { appRepo: app } : {}),
        ...(verificationBaseUrl ? { verificationBaseUrl } : {}),
      });
      navigate(`/projects/${project.id}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-10 py-12">
      <PageHeader
        title="Connect a project"
        subtitle="GenFixs watches this suite's CI runs and maintains it via pull requests into your repository."
      />
      <form onSubmit={submit} className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 px-5 py-5">
          <SectionTitle>Project</SectionTitle>
          <Field
            label="Project name"
            value={name}
            onChange={setName}
            required
            placeholder="Acme Shop"
          />
          <Field
            label="Organization"
            value={orgName}
            onChange={setOrgName}
            required
            placeholder="Acme"
          />
        </Card>
        <Card className="flex flex-col gap-4 px-5 py-5">
          <SectionTitle>Repositories</SectionTitle>
          <Field
            label="Test repository"
            hint="Where the Playwright suite lives; heal and rewrite PRs go here."
            value={testRepo}
            onChange={setTestRepo}
            required
            placeholder="acme/shop-e2e"
          />
          <Field
            label="App repository (recommended)"
            hint="Unlocks diff-based diagnosis — materially better classification."
            value={appRepo}
            onChange={setAppRepo}
            placeholder="acme/shop"
          />
          <Field
            label="Verification URL"
            hint="Staging/preview URL for sandbox verification. Without one, no heal will ever surface (unverified fixes are never shown)."
            value={verificationBaseUrl}
            onChange={setVerificationBaseUrl}
            placeholder="https://staging.acme-shop.com"
          />
        </Card>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Connecting…' : 'Connect project'}
          </button>
        </div>
        <p className="text-xs leading-5 text-ink-400">
          Next step: add the <span className="font-mono">genfixs-upload</span> step to your CI so
          report ingestion starts flowing (see the README's CI section).
        </p>
      </form>
    </div>
  );
}
