'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from '@/constants';
import { cn } from '@/lib/utils';

export default function NavItems({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname() ?? '';

  return (
    <nav className={cn('flex gap-1', compact ? 'flex-row' : 'flex-col')}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded px-3 text-sm text-ink-600 transition hover:bg-ink-100 hover:text-ink-950',
              active && 'bg-accent-soft font-medium text-accent',
            )}
          >
            <Icon size={16} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
