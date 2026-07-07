export default function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="border-b border-ink-200 pb-5">
      {eyebrow && (
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-600">{eyebrow}</p>
      )}
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-950">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-600">{description}</p>}
    </header>
  );
}
