import { ArrowRight } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { onboardingSteps } from '@/constants';

export default function OnboardingPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Onboarding"
        title="Create a GenFixs workspace"
        description="This is the product-grade setup flow we will wire to authentication, billing, GitHub installation, and project creation."
      />

      <form className="mt-6 max-w-2xl rounded border border-ink-200 bg-surface px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Workspace name</span>
            <input
              className="mt-1 h-10 w-full rounded border border-ink-200 bg-paper px-3 text-sm outline-none transition focus:border-accent"
              placeholder="Acme QA"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-ink-600">Primary repository</span>
            <input
              className="mt-1 h-10 w-full rounded border border-ink-200 bg-paper px-3 text-sm outline-none transition focus:border-accent"
              placeholder="owner/repository"
            />
          </label>
        </div>

        <div className="mt-6 space-y-3">
          {onboardingSteps.map((step, index) => (
            <div key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-3">
              <span className="flex size-7 items-center justify-center rounded bg-ink-100 text-xs font-semibold text-ink-600">
                {index + 1}
              </span>
              <div>
                <h2 className="text-sm font-medium">{step.title}</h2>
                <p className="mt-1 text-xs leading-5 text-ink-600">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          className="mt-6 inline-flex h-10 items-center gap-2 rounded bg-accent px-4 text-sm font-medium text-white transition hover:opacity-90"
          type="button"
        >
          Continue setup
          <ArrowRight size={15} />
        </button>
      </form>
    </main>
  );
}
