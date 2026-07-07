import Navbar from '@/components/Navbar';

export default function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[16rem_1fr]">
      <Navbar />
      <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</section>
    </div>
  );
}
