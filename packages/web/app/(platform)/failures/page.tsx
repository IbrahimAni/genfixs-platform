import EmptyPanel from '@/components/EmptyPanel';
import PageHeader from '@/components/PageHeader';

export default function FailuresPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Failures"
        title="Failure triage inbox"
        description="This will become the work queue for diagnosed CI failures, with classification, confidence, evidence, and generated actions."
      />
      <div className="mt-6">
        <EmptyPanel
          title="No failure evidence yet"
          description="Failures should appear only after a real CI report has been uploaded for a connected project."
          action="Connect CI evidence"
          href="/onboarding"
        />
      </div>
    </main>
  );
}
