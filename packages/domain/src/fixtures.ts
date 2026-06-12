import type { EvidenceBundle } from './evidence.js';
import type { Project } from './project.js';
import { DEFAULT_MERGE_POLICY } from './policy.js';

/** Shared test/demo fixture builders. Not part of the production surface. */

export function makeProjectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_demo',
    name: 'Acme Shop',
    org: { id: 'org_acme', name: 'Acme' },
    testRepo: { provider: 'github', owner: 'acme', name: 'shop-e2e', defaultBranch: 'main' },
    appRepo: { provider: 'github', owner: 'acme', name: 'shop', defaultBranch: 'main' },
    ciProvider: 'github-actions',
    framework: 'playwright',
    policies: structuredClone(DEFAULT_MERGE_POLICY),
    verificationBaseUrl: 'https://staging.acme-shop.test',
    createdAt: new Date('2026-01-15T00:00:00Z'),
    ...overrides,
  };
}

export function makeEvidenceFixture(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    testId: 'test_fixture',
    runId: 'run_fixture',
    testSource: `import { test, expect } from '@playwright/test';

test('applies discount', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-coupon').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`,
    failure: {
      errorMessage: 'Test failed',
      stackTrace: 'at tests/checkout.spec.ts:6:3',
      screenshots: [],
    },
    history: {
      totalRuns: 10,
      failures: 1,
      flips: 1,
      recentStatuses: [
        'passed',
        'passed',
        'passed',
        'passed',
        'passed',
        'passed',
        'passed',
        'passed',
        'passed',
        'failed',
      ],
    },
    intentArtifacts: [],
    selectorsInTest: ['testid=coupon-input', 'testid=apply-coupon', 'css=.cart-total'],
    relevantAppPaths: [],
    ...overrides,
  };
}
