import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export default function EmptyPanel({
  title,
  description,
  action,
  href,
}: {
  title: string;
  description: string;
  action: string;
  href: string;
}) {
  return (
    <section className="rounded border border-ink-200 bg-surface px-5 py-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-600">{description}</p>
      <Link
        href={href}
        className="mt-4 inline-flex h-9 items-center gap-2 rounded bg-accent px-3 text-sm font-medium text-white transition hover:opacity-90"
      >
        {action}
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}
