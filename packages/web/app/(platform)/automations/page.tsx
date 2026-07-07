import EmptyPanel from '@/components/EmptyPanel';
import PageHeader from '@/components/PageHeader';

export default function AutomationsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Automations"
        title="Guarded fix automation"
        description="Automation will manage generated PRs, quarantine actions, regression reports, and human approval gates."
      />
      <div className="mt-6">
        <EmptyPanel
          title="No automation policy configured"
          description="Policies should be workspace-controlled before GenFixs drafts or surfaces changes."
          action="Review settings"
          href="/settings"
        />
      </div>
    </main>
  );
}
