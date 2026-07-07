import EmptyPanel from '@/components/EmptyPanel';
import PageHeader from '@/components/PageHeader';

export default function ProjectsPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Projects"
        title="Repository connections"
        description="Projects will connect a customer workspace to test repositories, app repositories, CI providers, and verification URLs."
      />
      <div className="mt-6">
        <EmptyPanel
          title="No projects connected"
          description="The next implementation step is a real project creation form backed by the platform API."
          action="Start onboarding"
          href="/onboarding"
        />
      </div>
    </main>
  );
}
