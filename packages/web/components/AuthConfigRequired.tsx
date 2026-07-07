import Link from 'next/link';
import { KeyRound } from 'lucide-react';

export default function AuthConfigRequired() {
  return (
    <section className="w-full max-w-md rounded border border-ink-200 bg-surface px-5 py-5">
      <span className="inline-flex size-9 items-center justify-center rounded bg-accent-soft text-accent">
        <KeyRound size={17} />
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">Authentication is not configured</h1>
      <p className="mt-2 text-sm leading-6 text-ink-600">
        Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to run the production Clerk
        authentication flow.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex h-10 items-center rounded bg-accent px-4 text-sm font-medium text-white transition hover:opacity-90"
      >
        Back to foundation
      </Link>
    </section>
  );
}
