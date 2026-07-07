import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type OnboardingStep = {
  title: string;
  description: string;
  status: 'ready' | 'blocked' | 'pending';
};

export type PlatformArea = {
  title: string;
  description: string;
  href: string;
  action: string;
};
