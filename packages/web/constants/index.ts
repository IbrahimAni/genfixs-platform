import { Activity, GitBranch, Inbox, Settings, ShieldCheck, Workflow } from 'lucide-react';
import type { NavItem, OnboardingStep, PlatformArea } from '@/types';

export const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: Activity },
  { label: 'Projects', href: '/projects', icon: GitBranch },
  { label: 'Failures', href: '/failures', icon: Inbox },
  { label: 'Automations', href: '/automations', icon: Workflow },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export const onboardingSteps: OnboardingStep[] = [
  {
    title: 'Create your workspace',
    description: 'Set the organization name, default branch policy, and reviewer rules.',
    status: 'ready',
  },
  {
    title: 'Connect GitHub',
    description: 'Install the GenFixs app with least-privilege access to test repositories.',
    status: 'pending',
  },
  {
    title: 'Upload CI evidence',
    description: 'Send Playwright reports and artifacts after each run.',
    status: 'pending',
  },
  {
    title: 'Enable guarded fixes',
    description: 'Choose when GenFixs can draft PRs, quarantine tests, or require approval.',
    status: 'pending',
  },
];

export const platformAreas: PlatformArea[] = [
  {
    title: 'Project intake',
    description: 'Connect repositories, CI providers, and verification environments.',
    href: '/projects',
    action: 'Set up projects',
  },
  {
    title: 'Failure triage',
    description: 'Classify failing tests into drift, regressions, missing features, and flakes.',
    href: '/failures',
    action: 'Open failures',
  },
  {
    title: 'Policy controls',
    description: 'Keep merges, rewrites, quarantines, and deletion sign-off under explicit rules.',
    href: '/settings',
    action: 'Review settings',
  },
];

export const emptyStateChecks = [
  'No repositories connected yet',
  'No CI reports uploaded yet',
  'No fixes drafted yet',
  'No quarantine decisions pending',
];

export const trustPrinciples = [
  'Never turn a real regression green',
  'Verify fixes before surfacing them',
  'Draft code changes as pull requests',
  'Require human sign-off for removals',
];

export const setupIcon = ShieldCheck;
