import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProjectFixture } from '@genfixs/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlaywrightBrowserRunner } from './adapters/playwrightBrowserRunner.js';
import { VerificationSandbox } from './verifier.js';

/**
 * LIVE verification test: runs the authored (healed) test against the real
 * demo-shop app in a REAL Chromium via @playwright/test — the actual
 * spec §10.7 verification path, no scripted runner. Gated on browser
 * availability (PLAYWRIGHT_BROWSERS_PATH or default cache).
 */
const browsersPath = process.env['PLAYWRIGHT_BROWSERS_PATH'];
const browsersAvailable = browsersPath !== undefined && existsSync(browsersPath);

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));

const HEALED_TEST = `import { test, expect } from '@playwright/test';

test('applies discount code', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-discount-code').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`;

/** The pre-heal test, still pointing at the drifted selector. */
const BROKEN_TEST = HEALED_TEST.replace('apply-discount-code', 'apply-coupon');

describe.skipIf(!browsersAvailable)('real browser verification (live)', () => {
  let server: { close(): void };
  let baseUrl: string;

  beforeAll(async () => {
    // @ts-expect-error plain-JS example app, no type declarations
    const mod = await import('../../../examples/demo-shop/server.mjs');
    const started = (await mod.startDemoShop(0)) as { server: { close(): void }; port: number };
    server = started.server;
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterAll(() => {
    server.close();
  });

  function sandbox() {
    return new VerificationSandbox(
      new PlaywrightBrowserRunner({ runnerDir: packageDir, timeoutMs: 120_000 }),
    );
  }

  it('a correct heal verifies green against the live app', async () => {
    const project = makeProjectFixture({ verificationBaseUrl: baseUrl });
    const result = await sandbox().verify(project, {
      kind: 'heal',
      testFile: 'tests/checkout.spec.ts',
      testTitle: 'applies discount code',
      files: { 'tests/checkout.spec.ts': HEALED_TEST },
      summary: '',
    });
    expect(result.errorMessage ?? '(none)').toBe('(none)');
    expect(result.passed).toBe(true);
    expect(result.flowTrace.map((s) => s.action)).toEqual(['goto', 'fill', 'click', 'expect']);
  }, 120_000);

  it('the un-healed test still fails against the live app — so it would never become a PR', async () => {
    const project = makeProjectFixture({ verificationBaseUrl: baseUrl });
    const result = await sandbox().verify(project, {
      kind: 'heal',
      testFile: 'tests/checkout.spec.ts',
      testTitle: 'applies discount code',
      files: { 'tests/checkout.spec.ts': BROKEN_TEST },
      summary: '',
    });
    expect(result.passed).toBe(false);
  }, 120_000);
});
