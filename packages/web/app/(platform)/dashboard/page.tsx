import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import EmptyPanel from '@/components/EmptyPanel';
import PageHeader from '@/components/PageHeader';
import { emptyStateChecks, onboardingSteps, platformAreas, trustPrinciples } from '@/constants';

export default function DashboardPage() {
  return (
    <main>
      <PageHeader
        eyebrow="Workspace"
        title="Build your GenFixs platform"
        description="Start by connecting a repository and CI evidence. The dashboard stays empty until real suites, failures, fixes, and review policies are wired in."
      />

      <section className="grid grid-cols-1 gap-px overflow-hidden rounded border border-ink-200 bg-ink-200 lg:grid-cols-4">
        {emptyStateChecks.map((check) => (
          <div key={check} className="bg-surface px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-ink-800">
              <CheckCircle2 size={16} className="text-ink-400" />
              {check}
            </div>
          </div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded border border-ink-200 bg-surface">
          <div className="border-b border-ink-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Product areas</h2>
            <p className="text-xs text-ink-600">The core SaaS surfaces we will build out first.</p>
          </div>
          <div className="divide-y divide-ink-100">
            {platformAreas.map((area) => (
              <article key={area.href} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto]">
                <div>
                  <h3 className="text-sm font-medium text-ink-950">{area.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-600">{area.description}</p>
                </div>
                <Link
                  href={area.href}
                  className="inline-flex h-8 items-center gap-2 rounded border border-ink-200 px-3 text-xs font-medium text-ink-800 transition hover:border-accent hover:text-accent"
                >
                  {area.action}
                  <ArrowRight size={14} />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded border border-ink-200 bg-surface">
          <div className="border-b border-ink-200 px-4 py-3">
            <h2 className="text-sm font-semibold">Setup path</h2>
            <p className="text-xs text-ink-600">A proper SaaS onboarding flow, not demo seed data.</p>
          </div>
          <div className="space-y-4 px-4 py-4">
            {onboardingSteps.map((step, index) => (
              <div key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-3">
                <span className="flex size-7 items-center justify-center rounded bg-ink-100 text-xs font-semibold text-ink-600">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-medium">{step.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-ink-600">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmptyPanel
          title="Connect your first suite"
          description="Create a real project record before showing repository health, failures, and PR automation."
          action="Open onboarding"
          href="/onboarding"
        />
        <section className="rounded border border-ink-200 bg-surface px-5 py-5">
          <h2 className="text-sm font-semibold">Trust rules</h2>
          <ul className="mt-3 space-y-2">
            {trustPrinciples.map((principle) => (
              <li key={principle} className="flex items-center gap-2 text-sm text-ink-700">
                <CheckCircle2 size={15} className="text-green" />
                {principle}
              </li>
            ))}
          </ul>
        </section>
      </section>
    </main>
  );
}
