import { SignedIn, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import { ArrowRight, LogIn, Plus } from 'lucide-react';
import NavItems from '@/components/NavItems';

export default function Navbar() {
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <aside className="border-b border-ink-200 bg-surface px-4 py-4 lg:min-h-screen lg:border-r lg:border-b-0 lg:px-5 lg:py-6">
      <div className="flex items-center justify-between lg:block">
        <Link href="/dashboard" className="block">
          <div className="text-lg font-semibold tracking-tight">GenFixs</div>
          <div className="text-xs text-ink-600">Platform</div>
        </Link>

        <Link
          href="/onboarding"
          className="inline-flex size-9 items-center justify-center rounded border border-ink-200 text-ink-800 transition hover:border-accent hover:text-accent lg:mt-6 lg:w-full lg:gap-2 lg:px-3"
          aria-label="Create project"
          title="Create project"
        >
          <Plus size={16} />
          <span className="hidden text-sm font-medium lg:inline">New project</span>
        </Link>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4 lg:hidden">
        <Link href="/sign-in" className="inline-flex items-center gap-2 text-sm text-ink-600">
          <LogIn size={15} />
          Sign in
        </Link>
        {hasClerk && (
          <SignedIn>
            <UserButton />
          </SignedIn>
        )}
      </div>

      <div className="mt-5 hidden lg:block">
        <NavItems />
      </div>

      <div className="mt-5 flex gap-1 overflow-x-auto lg:hidden">
        <NavItems compact />
      </div>

      <Link
        href="/onboarding"
        className="mt-6 hidden items-center justify-between rounded border border-ink-200 px-3 py-3 text-sm text-ink-800 transition hover:border-accent hover:text-accent lg:flex"
      >
        Complete setup
        <ArrowRight size={15} />
      </Link>

      <div className="mt-4 hidden items-center justify-between border-t border-ink-100 pt-4 lg:flex">
        <Link href="/sign-in" className="inline-flex items-center gap-2 text-sm text-ink-600 hover:text-accent">
          <LogIn size={15} />
          Sign in
        </Link>
        {hasClerk && (
          <SignedIn>
            <UserButton />
          </SignedIn>
        )}
      </div>
    </aside>
  );
}
