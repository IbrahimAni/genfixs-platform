import {
  InMemoryGitHubClient,
  makeProjectFixture,
  type Project,
  type TestRun,
} from '@genfixs/domain';
import { ScriptedBrowserRunner } from '@genfixs/fix-author';
import { computeTestId } from '@genfixs/domain';
import { makePlaywrightReport, type FixtureSpec } from '@genfixs/ingestion';
import { createAppContext, type AppContext } from '../context.js';

/**
 * Demo mode (build plan M10): one fake project whose runs cover every
 * classification, exercised through the REAL pipeline — ingestion, evidence,
 * diagnosis, policy, authoring, verification, PR service — on fakes. Mirrors
 * the experiment plan's blind mixed batch, including the false-green trap
 * (refused) and the deletion trap (quarantined, not deleted).
 */

const FILES = {
  checkout: 'tests/checkout.spec.ts',
  onboarding: 'tests/onboarding.spec.ts',
  pricing: 'tests/pricing.spec.ts',
  exportCsv: 'tests/export.spec.ts',
  beta: 'tests/beta-dashboard.spec.ts',
  search: 'tests/search.spec.ts',
  profile: 'tests/profile.spec.ts',
  login: 'tests/login.spec.ts',
} as const;

const TITLES = {
  checkout: 'applies discount code',
  onboarding: 'completes onboarding',
  pricing: 'calculates total with discount',
  exportCsv: 'exports report as CSV',
  beta: 'shows beta dashboard widgets',
  search: 'search filters results',
  profile: 'updates profile avatar',
  login: 'logs in',
} as const;

const SOURCES: Record<keyof typeof FILES, string> = {
  checkout: `import { test, expect } from '@playwright/test';

test('applies discount code', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-coupon').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`,
  onboarding: `import { test, expect } from '@playwright/test';

test('completes onboarding', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByTestId('name-input').fill('Ada Lovelace');
  await page.getByTestId('continue-btn').click();
  await expect(page.locator('.step-indicator')).toHaveText('Step 2 of 2');
});
`,
  pricing: `import { test, expect } from '@playwright/test';

// covers pricing rules
test('calculates total with discount', async ({ page }) => {
  await page.goto('/pricing');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-discount-code').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`,
  exportCsv: `import { test, expect } from '@playwright/test';

// covers the ExportCsv feature
test('exports report as CSV', async ({ page }) => {
  await page.goto('/reports');
  await page.getByTestId('export-csv-btn').click();
  await expect(page.getByTestId('download-toast')).toBeVisible();
});
`,
  beta: `import { test, expect } from '@playwright/test';

test('shows beta dashboard widgets', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByTestId('beta-dashboard').click();
  await expect(page.getByTestId('beta-widgets')).toBeVisible();
});
`,
  search: `import { test, expect } from '@playwright/test';

test('search filters results', async ({ page }) => {
  await page.goto('/search');
  await page.getByTestId('search-input').fill('widgets');
  await page.waitForResponse(/\\/api\\/search/);
  await expect(page.getByTestId('result-row')).toHaveCount(3);
});
`,
  profile: `import { test, expect } from '@playwright/test';

test('updates profile avatar', async ({ page }) => {
  await page.goto('/profile');
  await page.getByTestId('avatar-upload').setInputFiles('fixtures/avatar.png');
  await expect(page).toHaveScreenshot('profile-avatar.png');
});
`,
  login: `import { test, expect } from '@playwright/test';

test('logs in', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('email-input').fill('qa@acme.test');
  await page.getByTestId('login-btn').click();
  await expect(page.getByTestId('account-menu')).toBeVisible();
});
`,
};

type CaseKey = keyof typeof FILES;

interface DemoCase {
  key: CaseKey;
  commit: string;
  green?: string;
  errorMessage: string;
  diffFiles?: Array<{ path: string; status: 'modified' | 'removed'; patch?: string }>;
}

/** One scenario per classification (experiment plan phase 2). */
const CASES: DemoCase[] = [
  {
    // 1. Benign locator drift → auto-heal, green PR.
    key: 'checkout',
    commit: 'c1drift00',
    green: 'g1green00',
    errorMessage: "Error: locator('[data-testid=apply-coupon]') not found",
    diffFiles: [
      {
        path: 'src/components/Checkout.tsx',
        status: 'modified',
        patch: `-      <button data-testid="apply-coupon" onClick={apply}>Apply</button>
+      <button data-testid="apply-discount-code" onClick={apply}>Apply</button>`,
      },
    ],
  },
  {
    // 2. Intended flow change → authored rewrite, PR for human confirmation.
    key: 'onboarding',
    commit: 'c2flow000',
    green: 'g2green00',
    errorMessage: "expect(locator).toHaveText: expected 'Step 2 of 2' received 'Step 2 of 4'",
    diffFiles: [
      {
        path: 'src/components/Onboarding.tsx',
        status: 'modified',
        patch: `-  if (step < 2) {
+  if (step < 4) {
+      <button data-testid="confirm-terms">Accept terms</button>
+      <button data-testid="review-order">Review order</button>`,
      },
    ],
  },
  {
    // 3. The false-green trap: logic broken, locators untouched → regression report.
    key: 'pricing',
    commit: 'c3bug0000',
    green: 'g3green00',
    errorMessage: "expect(locator).toHaveText: expected '$90.00' received '$110.00'",
    diffFiles: [
      {
        path: 'src/lib/pricing.ts',
        status: 'modified',
        patch: `-  return subtotal * (1 - discount);
+  return subtotal * (1 + discount);`,
      },
    ],
  },
  {
    // 4. Feature truly removed → quarantine + removal recommendation (human sign-off).
    key: 'exportCsv',
    commit: 'c4gone000',
    green: 'g4green00',
    errorMessage: "Error: locator('[data-testid=export-csv-btn]') not found",
    diffFiles: [{ path: 'src/components/ExportCsv.tsx', status: 'removed' }],
  },
  {
    // 5. The deletion trap: feature hidden behind a flag → cannot-locate quarantine.
    key: 'beta',
    commit: 'c5flag000',
    green: 'g5green00',
    errorMessage: "Error: locator('[data-testid=beta-dashboard]') not found",
    diffFiles: [
      {
        path: 'src/lib/flags.ts',
        status: 'modified',
        patch: `-  betaDashboard: true,
+  betaDashboard: flags.isEnabled('beta-dashboard-v2'),`,
      },
    ],
  },
  {
    // 6. Nondeterministic timing failure → flaky quarantine with hypothesis.
    key: 'search',
    commit: 'c6flaky00',
    errorMessage: 'TimeoutError: page.waitForResponse: Timeout 30000ms exceeded',
  },
  {
    // 7. Ambiguous visual failure → UNCLASSIFIED, quarantined and escalated.
    key: 'profile',
    commit: 'c7vague00',
    green: 'g7green00',
    errorMessage: 'Error: Screenshot comparison failed: 1243 pixels differ',
    diffFiles: [
      {
        path: 'src/styles/global.css',
        status: 'modified',
        patch: `-  .avatar-frame { border-radius: 50%; }
+  .avatar-frame { border-radius: 8px; }`,
      },
    ],
  },
];

function reportFor(
  failing: CaseKey | null,
  statusOf: (key: CaseKey) => FixtureSpec['status'],
): string {
  const specs: FixtureSpec[] = (Object.keys(FILES) as CaseKey[]).map((key) => {
    const c = CASES.find((x) => x.key === key);
    return {
      file: FILES[key],
      title: TITLES[key],
      status: key === failing ? 'failed' : statusOf(key),
      ...(key === failing && c
        ? {
            errorMessage: c.errorMessage,
            stack: `${c.errorMessage}\n    at ${FILES[key]}:6:3`,
            withScreenshot: true,
            withTrace: true,
          }
        : {}),
    };
  });
  return makePlaywrightReport(specs);
}

export interface DemoContext extends AppContext {
  project: Project;
}

export async function seedDemo(): Promise<DemoContext> {
  let n = 0;
  const ids = { next: (prefix: string) => `${prefix}_${(n++).toString(36).padStart(4, '0')}` };
  const github = new InMemoryGitHubClient();

  // The "live app" the verification sandbox sees: drifted/new selectors exist,
  // so correct heals/rewrites verify green.
  const liveSelectors = new Set([
    'coupon-input',
    'apply-discount-code',
    'name-input',
    'continue-btn',
    'confirm-terms',
    'review-order',
    'email-input',
    'login-btn',
    'account-menu',
  ]);

  const ctx = createAppContext({
    github,
    ids,
    browserRunner: new ScriptedBrowserRunner(liveSelectors),
  });

  const project = makeProjectFixture({ id: 'proj_demo' });
  await ctx.repos.projects.save(project);

  // Seed repo contents and per-case diffs.
  for (const c of CASES) {
    github.seedFile(project.testRepo, FILES[c.key], c.commit, SOURCES[c.key]);
    if (c.green && c.diffFiles) {
      github.seedDiff(c.green, c.commit, {
        baseSha: c.green,
        headSha: c.commit,
        files: c.diffFiles,
      });
    }
  }

  // Pre-GenFixs history (saved directly): the search test flip-flops — the
  // substrate the flake pre-filter needs.
  const historyStart = new Date('2026-05-26T08:00:00Z');
  for (let i = 0; i < 6; i++) {
    const run: TestRun = {
      id: ids.next('hrun'),
      projectId: project.id,
      commitSha: `h${i}history`,
      reportArtifacts: [],
      results: (Object.keys(FILES) as CaseKey[]).map((key) => ({
        testId: computeTestId(FILES[key], TITLES[key]),
        file: FILES[key],
        title: TITLES[key],
        status: key === 'search' && i % 2 === 1 ? 'failed' : 'passed',
        durationMs: 1100,
        ...(key === 'search' && i % 2 === 1
          ? {
              failure: {
                errorMessage: 'TimeoutError: page.waitForResponse: Timeout 30000ms exceeded',
                stackTrace: `at ${FILES.search}:7:3`,
                screenshots: [],
              },
            }
          : {}),
      })),
      startedAt: new Date(historyStart.getTime() + i * 86_400_000),
    };
    await ctx.repos.runs.save(run);
  }

  // Current runs: each introduces exactly one classification scenario.
  // Earlier outcomes carry forward: healed/approved tests pass again,
  // quarantined tests show as skipped (skip-with-annotation, R6).
  const resolved = new Set<CaseKey>();
  const quarantined = new Set<CaseKey>();
  const runStart = new Date('2026-06-05T09:00:00Z');

  for (const [i, c] of CASES.entries()) {
    await ctx.ingestion.ingest({
      projectId: project.id,
      commitSha: c.commit,
      ...(c.green ? { lastGreenSha: c.green } : {}),
      format: 'playwright-json',
      raw: reportFor(c.key, (key) => (quarantined.has(key) ? 'skipped' : 'passed')),
      startedAt: new Date(runStart.getTime() + i * 86_400_000),
    });
    await ctx.queue.drain();

    if (c.key === 'checkout' || c.key === 'onboarding' || c.key === 'pricing') {
      resolved.add(c.key); // PR merged / bug fixed in the story
    } else {
      quarantined.add(c.key);
    }
  }

  // A final green run: everything passing or parked in quarantine.
  await ctx.ingestion.ingest({
    projectId: project.id,
    commitSha: 'c8green00',
    format: 'playwright-json',
    raw: reportFor(null, (key) => (quarantined.has(key) ? 'skipped' : 'passed')),
    startedAt: new Date('2026-06-12T09:00:00Z'),
  });
  await ctx.queue.drain();

  const errors = (ctx.queue as { errors?: unknown[] }).errors ?? [];
  if (errors.length > 0) {
    throw new Error(`Demo pipeline reported errors: ${String(errors[0])}`);
  }

  // Backdate quarantine records to their run dates so ages read realistically
  // (the pipeline stamped them with wall-clock time during seeding).
  for (const record of await ctx.repos.quarantine.listByProject(project.id)) {
    const diagnosis = await ctx.repos.diagnoses.get(record.diagnosisId);
    const run = diagnosis ? await ctx.repos.runs.get(diagnosis.runId) : undefined;
    if (run) {
      await ctx.repos.quarantine.save({
        ...record,
        quarantinedAt: new Date(run.startedAt.getTime() + 3_600_000),
      });
    }
  }

  return { ...ctx, project };
}
