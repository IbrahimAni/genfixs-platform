import {
  makeEvidenceFixture,
  makeProjectFixture,
  type Diagnosis,
} from '@genfixs/domain';
import { describe, expect, it } from 'vitest';
import { assertLocatorOnlyEdit } from './assertionGuard.js';
import { FixAuthor } from './fixAuthor.js';
import { applySelectorHeal } from './healAuthor.js';
import { FakeRewriteModel } from './rewriteModel.js';
import { ScriptedBrowserRunner, VerificationSandbox, extractFlowTrace } from './verifier.js';

const project = makeProjectFixture();

const SOURCE = `import { test, expect } from '@playwright/test';

test('applies discount', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.locator('[data-testid=apply-coupon]').click();
  await expect(page.locator('.cart-total')).toHaveText('$90.00');
});
`;

function driftDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    id: 'diag_1',
    projectId: project.id,
    testId: 'test_1',
    runId: 'run_1',
    classification: 'BENIGN_DRIFT',
    confidence: 0.97,
    source: 'prefilter-selector-drift',
    rationale: 'rename detected',
    suggestedSelectorFix: { oldSelector: 'apply-coupon', newSelector: 'apply-discount-code' },
    evidence: makeEvidenceFixture({
      testSource: SOURCE,
      failure: {
        errorMessage: "locator('[data-testid=apply-coupon]') not found",
        stackTrace: 'at tests/checkout.spec.ts:6:3',
        screenshots: [],
      },
    }),
    createdAt: new Date(),
    ...overrides,
  };
}

function author() {
  return new FixAuthor({ rewriteModel: new FakeRewriteModel() });
}

describe('applySelectorHeal', () => {
  it('rewrites getByTestId and [data-testid=...] forms', () => {
    const result = applySelectorHeal(SOURCE, {
      oldSelector: 'apply-coupon',
      newSelector: 'apply-discount-code',
    });
    expect(result).not.toHaveProperty('rejected');
    if ('content' in result) {
      expect(result.content).toContain("locator('[data-testid=apply-discount-code]')");
      expect(result.content).not.toContain('apply-coupon');
      expect(result.replacements).toBe(1);
    }
  });

  it('rejects when the selector is absent', () => {
    const result = applySelectorHeal(SOURCE, { oldSelector: 'ghost', newSelector: 'x' });
    expect(result).toHaveProperty('rejected');
  });
});

describe('assertion guard (D10): the heal can ONLY be the claimed rename', () => {
  const rename = { oldSelector: 'apply-coupon', newSelector: 'apply-discount-code' };

  it('accepts a pure selector rename', () => {
    const healed = SOURCE.replaceAll('apply-coupon', 'apply-discount-code');
    expect(assertLocatorOnlyEdit(SOURCE, healed, rename)).toEqual({ ok: true });
  });

  it('rejects an edit that also changes an assertion value (the false-green vector)', () => {
    const malicious = SOURCE.replaceAll('apply-coupon', 'apply-discount-code').replace(
      "'$90.00'",
      "'$110.00'",
    );
    const result = assertLocatorOnlyEdit(SOURCE, malicious, rename);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('beyond the selector rename');
  });

  it('rejects edits that add or remove lines (flow changes)', () => {
    const withExtraStep = SOURCE.replace(
      "  await page.locator('[data-testid=apply-coupon]').click();",
      "  await page.locator('[data-testid=apply-discount-code]').click();\n  await page.getByTestId('confirm').click();",
    );
    expect(assertLocatorOnlyEdit(SOURCE, withExtraStep, rename).ok).toBe(false);
  });

  it('rejects no-op edits', () => {
    expect(assertLocatorOnlyEdit(SOURCE, SOURCE, rename).ok).toBe(false);
  });
});

describe('FixAuthor.authorHeal', () => {
  it('authors a minimal heal with an explanatory summary', async () => {
    const result = await author().authorHeal(project, driftDiagnosis());
    expect(result).toHaveProperty('fix');
    if ('fix' in result) {
      expect(result.fix.kind).toBe('heal');
      expect(result.fix.testFile).toBe('tests/checkout.spec.ts');
      expect(result.fix.files['tests/checkout.spec.ts']).toContain('apply-discount-code');
      expect(result.fix.summary).toContain('apply-coupon');
      expect(result.fix.summary).toContain('Assertions and flow are untouched');
    }
  });

  it('refuses to heal any non-drift classification, even if asked', async () => {
    const result = await author().authorHeal(
      project,
      driftDiagnosis({ classification: 'REAL_REGRESSION_SUSPECTED' }),
    );
    expect(result).toHaveProperty('rejected');
    if ('rejected' in result) expect(result.rejected).toContain('Refusing to heal');
  });

  it('refuses when no selector fix suggestion exists (when in doubt, never heal)', async () => {
    const diagnosis = driftDiagnosis();
    delete (diagnosis as { suggestedSelectorFix?: unknown }).suggestedSelectorFix;
    const result = await author().authorHeal(project, diagnosis);
    expect(result).toHaveProperty('rejected');
  });
});

describe('FixAuthor.authorRewrite (R4)', () => {
  it('drafts a rewrite walking the new flow, with diff-level evidence attached', async () => {
    const diagnosis = driftDiagnosis({
      classification: 'BEHAVIOR_CHANGE',
      confidence: 0.85,
      evidence: makeEvidenceFixture({
        testSource: SOURCE,
        appDiff: {
          baseSha: 'green',
          headSha: 'head',
          files: [
            {
              path: 'src/components/Checkout.tsx',
              status: 'modified',
              patch: `+      <button data-testid="confirm-terms">Accept terms</button>
+      <button data-testid="review-order">Review</button>`,
            },
          ],
        },
      }),
    });
    const { fix } = await author().authorRewrite(project, diagnosis);
    expect(fix.kind).toBe('rewrite');
    expect(fix.files[fix.testFile]).toContain("getByTestId('confirm-terms')");
    expect(fix.files[fix.testFile]).toContain("getByTestId('review-order')");
    expect(fix.evidenceSummary).toContain('src/components/Checkout.tsx');
    expect(fix.evidenceSummary).toContain('```diff');
  });
});

describe('VerificationSandbox (spec §10.7, D3)', () => {
  const healedFiles = {
    'tests/checkout.spec.ts': SOURCE.replaceAll('apply-coupon', 'apply-discount-code'),
  };

  it('passes a heal whose selectors all exist in the live app', async () => {
    const runner = new ScriptedBrowserRunner(
      new Set(['coupon-input', 'apply-discount-code']),
    );
    const sandbox = new VerificationSandbox(runner);
    const result = await sandbox.verify(project, {
      kind: 'heal',
      testFile: 'tests/checkout.spec.ts',
      testTitle: 'applies discount',
      files: healedFiles,
      summary: '',
    });
    expect(result.passed).toBe(true);
    expect(result.flowTrace.length).toBeGreaterThan(2);
    expect(result.flowTrace[0]).toMatchObject({ action: 'goto', url: '/checkout' });
  });

  it('fails a heal whose selector still does not exist', async () => {
    const runner = new ScriptedBrowserRunner(new Set(['coupon-input', 'something-else']));
    const sandbox = new VerificationSandbox(runner);
    const result = await sandbox.verify(project, {
      kind: 'heal',
      testFile: 'tests/checkout.spec.ts',
      testTitle: 'applies discount',
      files: healedFiles,
      summary: '',
    });
    expect(result.passed).toBe(false);
    expect(result.errorMessage).toContain('apply-discount-code');
  });

  it('refuses to verify (and therefore to surface) when no verification environment exists', async () => {
    const noEnv = makeProjectFixture();
    delete (noEnv as { verificationBaseUrl?: unknown }).verificationBaseUrl;
    const sandbox = new VerificationSandbox(
      new ScriptedBrowserRunner(new Set(['coupon-input', 'apply-discount-code'])),
    );
    const result = await sandbox.verify(noEnv, {
      kind: 'heal',
      testFile: 'tests/checkout.spec.ts',
      testTitle: 'applies discount',
      files: healedFiles,
      summary: '',
    });
    expect(result.passed).toBe(false);
    expect(result.errorMessage).toContain('No verification environment');
  });
});

describe('flow trace extraction (P2 insurance)', () => {
  it('captures ordered steps with selectors and urls', () => {
    const trace = extractFlowTrace(SOURCE);
    expect(trace.map((s) => s.action)).toEqual(['goto', 'fill', 'click', 'expect']);
    expect(trace[1]?.selector).toBe('[data-testid=coupon-input]');
  });
});
