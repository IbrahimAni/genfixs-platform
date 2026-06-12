import { InMemoryGitHubClient, computeTestId, makeProjectFixture } from '@genfixs/domain';
import { ScriptedBrowserRunner } from '@genfixs/fix-author';
import { makePlaywrightReport } from '@genfixs/ingestion';
import { afterAll, describe, expect, it } from 'vitest';
import { BullMqQueue } from './adapters/bullmqQueue.js';
import { FsObjectStore } from './adapters/objectStores.js';
import { createAppContext } from './context.js';
import { createPostgresRepositories } from './repositories/postgres.js';

/**
 * LIVE integration tests: real Postgres, real Redis/BullMQ, real filesystem
 * artifact store — no in-memory fakes for infrastructure. Gated on
 * DATABASE_URL / REDIS_URL so CI without services skips cleanly.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];

describe.skipIf(!DATABASE_URL)('Postgres repositories (live)', () => {
  it('round-trips the full pipeline state through Postgres', async () => {
    const repos = await createPostgresRepositories(DATABASE_URL!);
    const suffix = Date.now().toString(36);
    const project = makeProjectFixture({ id: `proj_pg_${suffix}` });

    await repos.projects.save(project);
    expect((await repos.projects.get(project.id))?.name).toBe(project.name);

    const testId = computeTestId('tests/x.spec.ts', 'works');
    for (let i = 0; i < 3; i++) {
      await repos.runs.save({
        id: `run_pg_${suffix}_${i}`,
        projectId: project.id,
        commitSha: `sha${i}`,
        reportArtifacts: [],
        results: [
          {
            testId,
            file: 'tests/x.spec.ts',
            title: 'works',
            status: i === 1 ? 'failed' : 'passed',
            durationMs: 100,
            ...(i === 1
              ? {
                  failure: {
                    errorMessage: 'boom',
                    stackTrace: '',
                    screenshots: [],
                  },
                }
              : {}),
          },
        ],
        startedAt: new Date(Date.now() - (3 - i) * 60_000),
      });
    }
    expect(await repos.runs.historyStatuses(project.id, testId)).toEqual([
      'passed',
      'failed',
      'passed',
    ]);

    const quarantineId = `q_pg_${suffix}`;
    await repos.quarantine.save({
      id: quarantineId,
      projectId: project.id,
      testId,
      diagnosisId: `d_pg_${suffix}`,
      reason: 'flaky-nondeterministic',
      hypothesis: 'timing',
      quarantinedAt: new Date(),
      status: 'active',
    });
    expect(await repos.quarantine.listByProject(project.id, 'active')).toHaveLength(1);
    await repos.quarantine.release(quarantineId, new Date());
    expect(await repos.quarantine.listByProject(project.id, 'active')).toHaveLength(0);
    const released = await repos.quarantine.get(quarantineId);
    expect(released?.status).toBe('released');
    expect(released?.releasedAt).toBeInstanceOf(Date);

    await repos.flowTraces.save({
      id: `flow_pg_${suffix}`,
      projectId: project.id,
      testId,
      runId: `run_pg_${suffix}_1`,
      capturedAt: new Date(),
      steps: [{ index: 0, action: 'goto', url: '/x' }],
    });
    expect((await repos.flowTraces.listByTest(project.id, testId))[0]?.steps).toHaveLength(1);

    await repos.audit.append({
      id: `audit_pg_${suffix}`,
      projectId: project.id,
      at: new Date(),
      actor: 'system',
      type: 'run.ingested',
      detail: { check: true },
    });
    expect((await repos.audit.listByProject(project.id)).length).toBeGreaterThan(0);
    await repos.close();
  });
});

describe.skipIf(!DATABASE_URL || !REDIS_URL)(
  'end-to-end pipeline on live Postgres + Redis + filesystem artifacts',
  () => {
    const queues: BullMqQueue[] = [];
    afterAll(async () => {
      await Promise.all(queues.map((q) => q.close()));
    });

    it('heals a benign drift through real infrastructure', async () => {
      const suffix = Date.now().toString(36);
      const repos = await createPostgresRepositories(DATABASE_URL!);
      const queue = BullMqQueue.fromUrl(REDIS_URL!);
      queues.push(queue);
      const github = new InMemoryGitHubClient(); // external boundary: credential-gated
      const store = new FsObjectStore(`/tmp/genfixs-live-${suffix}`);

      let n = 0;
      const ctx = createAppContext({
        repos,
        queue,
        github,
        store,
        ids: { next: (p) => `${p}_live_${suffix}_${n++}` },
        browserRunner: new ScriptedBrowserRunner(new Set(['coupon-input', 'apply-discount-code'])),
      });

      const project = makeProjectFixture({ id: `proj_live_${suffix}` });
      await ctx.repos.projects.save(project);

      const source = `import { test, expect } from '@playwright/test';

test('applies discount code', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-coupon').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`;
      github.seedFile(project.testRepo, 'tests/checkout.spec.ts', 'headlive', source);
      github.seedDiff('greenlive', 'headlive', {
        baseSha: 'greenlive',
        headSha: 'headlive',
        files: [
          {
            path: 'src/components/Checkout.tsx',
            status: 'modified',
            patch: `-      <button data-testid="apply-coupon">Apply</button>
+      <button data-testid="apply-discount-code">Apply</button>`,
          },
        ],
      });

      const run = await ctx.ingestion.ingest({
        projectId: project.id,
        commitSha: 'headlive',
        lastGreenSha: 'greenlive',
        format: 'playwright-json',
        raw: makePlaywrightReport([
          {
            file: 'tests/checkout.spec.ts',
            title: 'applies discount code',
            status: 'failed',
            errorMessage: "Error: locator('[data-testid=apply-coupon]') not found",
            stack: `Error: not found\n    at tests/checkout.spec.ts:6:3`,
            withScreenshot: true,
          },
        ]),
      });

      // BullMQ has no synchronous drain — poll for the outcome.
      const deadline = Date.now() + 30_000;
      let actions = await repos.actions.listByProject(project.id);
      while (actions.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        actions = await repos.actions.listByProject(project.id);
      }

      expect(actions).toHaveLength(1);
      expect(actions[0]!.action.kind).toBe('HEAL');
      expect(github.pullRequests).toHaveLength(1);
      expect(github.pullRequests[0]!.input.files['tests/checkout.spec.ts']).toContain(
        'apply-discount-code',
      );

      // Artifacts really persisted to disk by the ingestion path.
      const rawReport = await store.getText(`runs/${run.id}/raw-report`);
      expect(rawReport).toContain('suites');

      // Diagnosis persisted in Postgres with the decided action attached.
      const diagnoses = await repos.diagnoses.listByProject(project.id);
      expect(diagnoses).toHaveLength(1);
      expect(diagnoses[0]!.classification).toBe('BENIGN_DRIFT');

      const deadline2 = Date.now() + 10_000;
      let updated = diagnoses[0]!;
      while (!updated.decidedAction && Date.now() < deadline2) {
        await new Promise((r) => setTimeout(r, 250));
        updated = (await repos.diagnoses.get(updated.id))!;
      }
      expect(updated.decidedAction?.kind).toBe('HEAL');
      await repos.close();
    }, 60_000);
  },
);
