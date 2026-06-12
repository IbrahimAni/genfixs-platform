import {
  InMemoryGitHubClient,
  type AppDiff,
  type Project,
  type TestResult,
  type TestRun,
} from '@genfixs/domain';
import { describe, expect, it } from 'vitest';
import { EvidenceBuilder } from './evidenceBuilder.js';
import { computeRunHistoryStats } from './flakeStats.js';
import { detectSelectorRename, extractSelectors, isPureSelectorDiff } from './selectorAnalysis.js';

const TEST_SOURCE = `import { test, expect } from '@playwright/test';

test('applies discount', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.locator('[data-testid=apply-coupon]').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`;

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj_1',
    name: 'Shop',
    org: { id: 'org_1', name: 'Acme' },
    testRepo: { provider: 'github', owner: 'acme', name: 'shop-tests', defaultBranch: 'main' },
    appRepo: { provider: 'github', owner: 'acme', name: 'shop', defaultBranch: 'main' },
    ciProvider: 'github-actions',
    framework: 'playwright',
    policies: {
      autoMergeBenignDrift: false,
      confidenceThresholds: {
        heal: 0.9,
        proposeRewrite: 0.75,
        reportRegression: 0.6,
        featureMissing: 0.7,
        flaky: 0.7,
      },
      deletionRequiresSignoff: true,
    },
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

const RENAME_DIFF: AppDiff = {
  baseSha: 'green1',
  headSha: 'head1',
  files: [
    {
      path: 'src/components/Checkout.tsx',
      status: 'modified',
      patch: `--- a/src/components/Checkout.tsx
+++ b/src/components/Checkout.tsx
-      <button data-testid="apply-coupon" onClick={apply}>Apply</button>
+      <button data-testid="apply-discount-code" onClick={apply}>Apply</button>`,
    },
  ],
};

const LOGIC_DIFF: AppDiff = {
  baseSha: 'green1',
  headSha: 'head1',
  files: [
    {
      path: 'src/lib/pricing.ts',
      status: 'modified',
      patch: `-  return subtotal * (1 - discount);
+  return subtotal * (1 + discount);`,
    },
  ],
};

describe('selector extraction', () => {
  it('extracts testids, css and normalizes locator-wrapped testids', () => {
    const selectors = extractSelectors(TEST_SOURCE);
    expect(selectors).toContainEqual({ kind: 'testid', value: 'coupon-input' });
    expect(selectors).toContainEqual({ kind: 'testid', value: 'apply-coupon' });
    expect(selectors).toContainEqual({ kind: 'css', value: '.cart-total' });
  });
});

describe('pure-selector diff detection', () => {
  it('accepts an attribute-only testid rename', () => {
    expect(isPureSelectorDiff(RENAME_DIFF)).toBe(true);
  });

  it('rejects logic changes', () => {
    expect(isPureSelectorDiff(LOGIC_DIFF)).toBe(false);
  });

  it('rejects file additions/removals and empty diffs', () => {
    expect(
      isPureSelectorDiff({
        baseSha: 'a',
        headSha: 'b',
        files: [{ path: 'src/Feature.tsx', status: 'removed' }],
      }),
    ).toBe(false);
    expect(isPureSelectorDiff({ baseSha: 'a', headSha: 'b', files: [] })).toBe(false);
  });

  it('rejects mixed diffs where a selector rename hides among logic changes', () => {
    const mixed: AppDiff = {
      baseSha: 'a',
      headSha: 'b',
      files: [...RENAME_DIFF.files, ...LOGIC_DIFF.files],
    };
    expect(isPureSelectorDiff(mixed)).toBe(false);
  });
});

describe('selector rename detection', () => {
  it('finds the old → new testid for a selector the test uses', () => {
    expect(detectSelectorRename(RENAME_DIFF, extractSelectors(TEST_SOURCE))).toEqual({
      oldSelector: 'apply-coupon',
      newSelector: 'apply-discount-code',
    });
  });

  it('ignores renames of testids the test does not use', () => {
    const unrelated: AppDiff = {
      baseSha: 'a',
      headSha: 'b',
      files: [
        {
          path: 'src/components/Nav.tsx',
          status: 'modified',
          patch: `-      <a data-testid="nav-home">Home</a>
+      <a data-testid="nav-start">Home</a>`,
        },
      ],
    };
    expect(detectSelectorRename(unrelated, extractSelectors(TEST_SOURCE))).toBeUndefined();
  });
});

describe('flake statistics', () => {
  it('counts pass/fail flips within the window', () => {
    const stats = computeRunHistoryStats([
      'passed',
      'failed',
      'passed',
      'passed',
      'failed',
      'passed',
      'failed',
    ]);
    expect(stats.flips).toBe(5);
    expect(stats.failures).toBe(3);
  });

  it('a consistently failing test has one flip, not many', () => {
    const stats = computeRunHistoryStats(['passed', 'passed', 'failed', 'failed', 'failed']);
    expect(stats.flips).toBe(1);
  });

  it('skipped runs do not create flips', () => {
    const stats = computeRunHistoryStats(['passed', 'skipped', 'passed', 'passed']);
    expect(stats.flips).toBe(0);
  });
});

describe('EvidenceBuilder', () => {
  function setup(project: Project) {
    const github = new InMemoryGitHubClient();
    github.seedFile(project.testRepo, 'tests/checkout.spec.ts', 'head1', TEST_SOURCE);
    github.seedDiff('green1', 'head1', RENAME_DIFF);
    const builder = new EvidenceBuilder({
      github,
      getHistory: async () => ['passed', 'passed', 'failed'],
      getIntentArtifacts: async () => [],
    });
    return { github, builder };
  }

  const result: TestResult = {
    testId: 'tid_1',
    file: 'tests/checkout.spec.ts',
    title: 'applies discount',
    status: 'failed',
    durationMs: 1500,
    failure: {
      errorMessage: "locator('[data-testid=apply-coupon]') not found",
      stackTrace: 'at tests/checkout.spec.ts:6',
      screenshots: [],
    },
  };

  const run: TestRun = {
    id: 'run_1',
    projectId: 'proj_1',
    commitSha: 'head1',
    lastGreenSha: 'green1',
    reportArtifacts: [],
    results: [result],
    startedAt: new Date(),
  };

  it('assembles a full bundle when the app repo is connected', async () => {
    const project = makeProject();
    const { builder } = setup(project);
    const bundle = await builder.build(project, run, result);

    expect(bundle.testSource).toBe(TEST_SOURCE);
    expect(bundle.appDiff?.files[0]?.path).toBe('src/components/Checkout.tsx');
    expect(bundle.selectorsInTest).toContain('testid=apply-coupon');
    expect(bundle.relevantAppPaths).toContain('src/components/Checkout.tsx');
    expect(bundle.history.totalRuns).toBe(3);
  });

  it('degrades gracefully without an app repo: no diff, no relevant paths', async () => {
    const project = makeProject();
    const noAppRepo: Project = { ...project };
    delete (noAppRepo as { appRepo?: unknown }).appRepo;
    const { builder } = setup(noAppRepo);
    const bundle = await builder.build(noAppRepo, run, result);
    expect(bundle.appDiff).toBeUndefined();
    expect(bundle.relevantAppPaths).toEqual([]);
  });

  it('refuses to build evidence for non-failed results', async () => {
    const project = makeProject();
    const { builder } = setup(project);
    await expect(builder.build(project, run, { ...result, status: 'passed' })).rejects.toThrow(
      /only built for failed/,
    );
  });
});
