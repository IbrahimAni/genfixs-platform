import { SignIn } from '@clerk/nextjs';
import AuthConfigRequired from '@/components/AuthConfigRequired';

export default function SignInPage() {
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <main className="grid min-h-screen grid-cols-1 bg-paper lg:grid-cols-[minmax(0,1fr)_31rem]">
      <section className="flex min-h-[22rem] flex-col justify-between px-6 py-6 lg:min-h-screen lg:px-10">
        <div>
          <div className="text-lg font-semibold tracking-tight">GenFixs</div>
          <div className="text-xs text-ink-600">Platform foundation</div>
        </div>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-600">
            Secure access
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink-950">
            Sign in to your GenFixs workspace.
          </h1>
          <p className="mt-4 text-sm leading-6 text-ink-600">
            Authentication is handled by Clerk. The platform API stores users, identities,
            memberships, roles, and audit history behind the tenant boundary.
          </p>
        </div>
        <p className="text-xs text-ink-500">Protected routes require an active session.</p>
      </section>

      <section className="flex items-center justify-center border-t border-ink-200 bg-surface px-4 py-8 lg:border-t-0 lg:border-l">
        {hasClerk ? (
          <SignIn
            path="/sign-in"
            routing="path"
            signUpUrl="/sign-up"
            afterSignInUrl="/dashboard"
            appearance={{
              elements: {
                cardBox: 'shadow-none border border-ink-200',
                card: 'shadow-none',
              },
            }}
          />
        ) : (
          <AuthConfigRequired />
        )}
      </section>
    </main>
  );
}
