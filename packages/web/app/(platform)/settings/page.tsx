import PageHeader from '@/components/PageHeader';

const settings = [
  'Authentication provider',
  'Workspace roles',
  'GitHub app installation',
  'Merge policy',
  'Deletion sign-off',
  'Billing plan',
];

export default function SettingsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Settings"
        title="Workspace configuration"
        description="Settings will hold the SaaS controls that make GenFixs safe to run in customer repositories."
      />
      <section className="mt-6 rounded border border-ink-200 bg-surface">
        <div className="divide-y divide-ink-100">
          {settings.map((item) => (
            <div key={item} className="flex items-center justify-between px-4 py-4">
              <span className="text-sm font-medium text-ink-950">{item}</span>
              <span className="rounded bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600">
                Planned
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
