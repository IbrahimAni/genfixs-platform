import type { ReactNode } from 'react';
import type { Classification } from '../lib/api';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-ink-200 bg-surface ${className}`}>{children}</div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
      {children}
    </h2>
  );
}

const CLASSIFICATION_META: Record<Classification, { label: string; tone: string }> = {
  BENIGN_DRIFT: { label: 'Benign drift', tone: 'bg-ok-soft text-ok' },
  BEHAVIOR_CHANGE: { label: 'Behavior change', tone: 'bg-warn-soft text-warn' },
  REAL_REGRESSION_SUSPECTED: { label: 'Regression suspected', tone: 'bg-bad-soft text-bad' },
  FEATURE_MISSING: { label: 'Feature missing', tone: 'bg-warn-soft text-warn' },
  FLAKY_NONDETERMINISTIC: { label: 'Flaky', tone: 'bg-ink-100 text-ink-700' },
  UNCLASSIFIED: { label: 'Unclassified', tone: 'bg-ink-100 text-ink-700' },
};

export function ClassificationBadge({ value }: { value: Classification }) {
  const meta = CLASSIFICATION_META[value];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${meta.tone}`}
    >
      {meta.label}
    </span>
  );
}

export function Tag({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700',
    accent: 'bg-accent-soft text-accent',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
  };
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'bad';
}) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {label}
      </div>
      <div
        className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${tone === 'bad' ? 'text-bad' : tone === 'ok' ? 'text-ok' : 'text-ink-900'}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-400">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-200 px-6 py-12 text-center text-sm text-ink-400">
      {children}
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`border-b border-ink-200 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-ink-100 px-4 py-3 align-top text-sm ${className}`}>
      {children}
    </td>
  );
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[12.5px] ${className}`}>{children}</span>;
}
