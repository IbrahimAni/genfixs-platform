import Link from 'next/link';
import { ArrowRight, Boxes, Database, KeyRound, RadioTower, ShieldCheck } from 'lucide-react';

export default function Page() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col justify-between">
        <header className="flex items-center justify-between border-b border-ink-200 pb-5">
          <Link href="/" className="block">
            <div className="text-lg font-semibold tracking-tight">GenFixs</div>
            <div className="text-xs text-ink-600">Platform foundation</div>
          </Link>
          <Link
            href="/onboarding"
            className="inline-flex h-9 items-center gap-2 rounded bg-accent px-3 text-sm font-medium text-white transition hover:opacity-90"
          >
            Start setup
            <ArrowRight size={15} />
          </Link>
        </header>

        <div className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-600">
              Production architecture
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-ink-950 sm:text-5xl">
              The SaaS operating layer for future GenFixs capabilities.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-ink-600">
              This foundation defines tenancy, identity, RBAC, subscriptions, usage, audit, events,
              integrations, settings, notifications, and project boundaries before the QA product
              surface is built on top.
            </p>
          </div>

          <section className="rounded border border-ink-200 bg-surface">
            <div className="border-b border-ink-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Foundation status</h2>
              <p className="text-xs text-ink-600">Postgres-backed service boundaries are in place.</p>
            </div>
            <div className="divide-y divide-ink-100">
              {[
                { icon: Boxes, label: 'Multi-tenant domain model' },
                { icon: KeyRound, label: 'Auth, RBAC, invitations' },
                { icon: Database, label: 'Database schema and repositories' },
                { icon: RadioTower, label: 'Event outbox and audit logs' },
                { icon: ShieldCheck, label: 'Usage, billing, settings, flags' },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="inline-flex size-8 items-center justify-center rounded bg-accent-soft text-accent">
                      <Icon size={16} />
                    </span>
                    {item.label}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="grid grid-cols-1 gap-px overflow-hidden rounded border border-ink-200 bg-ink-200 md:grid-cols-3">
          {[
            { label: 'Platform API', href: '/api/platform/status' },
            { label: 'Onboarding flow', href: '/onboarding' },
            { label: 'Workspace app shell', href: '/dashboard' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between bg-surface px-4 py-4 text-sm font-medium text-ink-800 transition hover:text-accent"
            >
              {item.label}
              <ArrowRight size={15} />
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
