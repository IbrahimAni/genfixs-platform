import { ClerkProvider } from '@clerk/nextjs';

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) return <>{children}</>;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={{
        variables: {
          colorPrimary: '#315f7c',
          borderRadius: '4px',
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
