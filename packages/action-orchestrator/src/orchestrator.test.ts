import {
  makeEvidenceFixture,
  makeProjectFixture,
  type ActionRecord,
  type AuditEvent,
  type AuthoredFix,
  type Diagnosis,
  type QuarantineRecord,
  type TestFlowModel,
} from '@genfixs/domain';
import { describe, expect, it, vi } from 'vitest';
import { ActionOrchestrator, type OrchestratorDeps } from './orchestrator.js';

const FIX: AuthoredFix = {
  kind: 'heal',
  testFile: 'tests/checkout.spec.ts',
  testTitle: 'applies discount',
  files: { 'tests/checkout.spec.ts': '// healed content' },
  summary: 'Renamed testid apply-coupon → apply-discount-code',
};

function makeDiagnosis(overrides: Partial<Diagnosis> = {}): Diagnosis {
  return {
    id: 'diag_1',
    projectId: 'proj_demo',
    testId: 'test_1',
    runId: 'run_1',
    classification: 'BENIGN_DRIFT',
    confidence: 0.97,
    source: 'prefilter-selector-drift',
    rationale: 'pure selector rename',
    evidence: makeEvidenceFixture(),
    createdAt: new Date(),
    ...overrides,
  };
}

function setup(options: { verificationPasses?: boolean; healRejected?: string } = {}) {
  const quarantines: QuarantineRecord[] = [];
  const flowTraces: Omit<TestFlowModel, 'id'>[] = [];
  const actions: ActionRecord[] = [];
  const audits: Omit<AuditEvent, 'id' | 'at'>[] = [];
  let n = 0;

  const fixAuthor = {
    authorHeal: vi.fn(async () =>
      options.healRejected !== undefined ? { rejected: options.healRejected } : { fix: FIX },
    ),
    authorRewrite: vi.fn(async () => ({ fix: { ...FIX, kind: 'rewrite' as const } })),
  };
  const verifier = {
    verify: vi.fn(async () => ({
      passed: options.verificationPasses !== false,
      ...(options.verificationPasses === false ? { errorMessage: 'still failing' } : {}),
      flowTrace: [
        { index: 0, action: 'goto' as const, url: '/checkout' },
        { index: 1, action: 'click' as const, selector: '[data-testid=apply-discount-code]' },
      ],
    })),
  };
  const prService = {
    openHealPr: vi.fn(async (_p, _d, _f, opts: { autoMerge: boolean }) => ({
      pr: {
        repo: {
          provider: 'github' as const,
          owner: 'acme',
          name: 'shop-e2e',
          defaultBranch: 'main',
        },
        number: 7,
        url: 'https://github.com/acme/shop-e2e/pull/7',
        branch: 'genfixs/heal-test-1',
      },
      autoMerged: opts.autoMerge,
    })),
    openRewritePr: vi.fn(async () => ({
      pr: {
        repo: {
          provider: 'github' as const,
          owner: 'acme',
          name: 'shop-e2e',
          defaultBranch: 'main',
        },
        number: 8,
        url: 'https://github.com/acme/shop-e2e/pull/8',
        branch: 'genfixs/rewrite-test-1',
      },
    })),
    createRegressionIssue: vi.fn(async () => ({
      repo: { provider: 'github' as const, owner: 'acme', name: 'shop', defaultBranch: 'main' },
      number: 21,
      url: 'https://github.com/acme/shop/issues/21',
    })),
  };

  const deps: OrchestratorDeps = {
    fixAuthor,
    verifier,
    prService,
    saveQuarantine: async (r) => {
      const record = { ...r, id: `q_${n++}` };
      quarantines.push(record);
      return record;
    },
    saveFlowTrace: async (t) => {
      flowTraces.push(t);
    },
    saveAction: async (a) => {
      actions.push(a);
    },
    audit: async (e) => {
      audits.push(e);
    },
    clock: { now: () => new Date('2026-06-12T12:00:00Z') },
    ids: { next: (p) => `${p}_${n++}` },
  };

  return {
    orchestrator: new ActionOrchestrator(deps),
    fixAuthor,
    verifier,
    prService,
    quarantines,
    flowTraces,
    actions,
    audits,
  };
}

const project = makeProjectFixture();
const projectAutoMerge = makeProjectFixture({
  policies: { ...structuredClone(project.policies), autoMergeBenignDrift: true },
});

describe('heal path (R3)', () => {
  it('verified heal → PR opened, no auto-merge without opt-in, flow trace persisted', async () => {
    const ctx = setup();
    const record = await ctx.orchestrator.execute(project, makeDiagnosis());

    expect(record.action.kind).toBe('HEAL');
    if (record.action.kind === 'HEAL') {
      expect(record.action.autoMerged).toBe(false);
      expect(record.action.pr.number).toBe(7);
    }
    expect(ctx.prService.openHealPr).toHaveBeenCalledWith(project, expect.anything(), FIX, {
      autoMerge: false,
    });
    // P2 insurance: verification flow trace persisted as TestFlowModel.
    expect(ctx.flowTraces).toHaveLength(1);
    expect(ctx.flowTraces[0]?.steps).toHaveLength(2);
    expect(ctx.quarantines).toHaveLength(0);
  });

  it('auto-merge flows through only when the project opted in', async () => {
    const ctx = setup();
    const record = await ctx.orchestrator.execute(projectAutoMerge, makeDiagnosis());
    if (record.action.kind === 'HEAL') expect(record.action.autoMerged).toBe(true);
    expect(ctx.prService.openHealPr).toHaveBeenCalledWith(
      projectAutoMerge,
      expect.anything(),
      FIX,
      { autoMerge: true },
    );
  });

  it('a heal that fails verification NEVER becomes a PR; it degrades to quarantine (the core refusal)', async () => {
    const ctx = setup({ verificationPasses: false });
    const record = await ctx.orchestrator.execute(projectAutoMerge, makeDiagnosis());

    expect(ctx.prService.openHealPr).not.toHaveBeenCalled();
    expect(ctx.quarantines).toHaveLength(1);
    expect(ctx.quarantines[0]?.reason).toBe('verification-failed');
    expect(record.action.kind).toBe('ESCALATE');
    expect(ctx.audits.some((a) => a.type === 'verification.failed')).toBe(true);
  });

  it('a heal the structural guard rejects never reaches verification or a PR', async () => {
    const ctx = setup({ healRejected: 'edit would touch an assertion' });
    await ctx.orchestrator.execute(project, makeDiagnosis());

    expect(ctx.verifier.verify).not.toHaveBeenCalled();
    expect(ctx.prService.openHealPr).not.toHaveBeenCalled();
    expect(ctx.quarantines).toHaveLength(1);
    expect(ctx.audits.some((a) => a.type === 'heal.rejected-by-guard')).toBe(true);
  });
});

describe('rewrite path (R4)', () => {
  it('behavior change → drafted rewrite PR via openRewritePr (no auto-merge surface exists)', async () => {
    const ctx = setup();
    const record = await ctx.orchestrator.execute(
      projectAutoMerge, // even with auto-merge on
      makeDiagnosis({ classification: 'BEHAVIOR_CHANGE', confidence: 0.85 }),
    );
    expect(record.action.kind).toBe('PROPOSE_REWRITE');
    expect(ctx.prService.openRewritePr).toHaveBeenCalledTimes(1);
    expect(ctx.prService.openHealPr).not.toHaveBeenCalled();
  });

  it('an unverified rewrite is quarantined, not surfaced', async () => {
    const ctx = setup({ verificationPasses: false });
    await ctx.orchestrator.execute(
      project,
      makeDiagnosis({ classification: 'BEHAVIOR_CHANGE', confidence: 0.85 }),
    );
    expect(ctx.prService.openRewritePr).not.toHaveBeenCalled();
    expect(ctx.quarantines[0]?.reason).toBe('verification-failed');
  });
});

describe('regression path (R5): the false-green trap', () => {
  it('reports the bug and provably never invokes the fix author', async () => {
    const ctx = setup();
    const record = await ctx.orchestrator.execute(
      projectAutoMerge,
      makeDiagnosis({
        classification: 'REAL_REGRESSION_SUSPECTED',
        confidence: 0.95,
        evidence: makeEvidenceFixture({
          appDiff: {
            baseSha: 'green',
            headSha: 'head',
            files: [{ path: 'src/lib/pricing.ts', status: 'modified', patch: '-x\n+y' }],
          },
          relevantAppPaths: ['src/lib/pricing.ts'],
          failure: {
            errorMessage: "expected '$110.00' to equal '$90.00'",
            stackTrace: '',
            screenshots: [],
          },
        }),
      }),
    );

    expect(record.action.kind).toBe('REPORT_REGRESSION');
    if (record.action.kind === 'REPORT_REGRESSION') {
      expect(record.action.report.issue?.number).toBe(21);
      expect(record.action.report.failingAssertion).toContain('$90.00');
      expect(record.action.report.suspectAppChange).toContain('src/lib/pricing.ts');
    }
    // The trust guarantee, asserted directly:
    expect(ctx.fixAuthor.authorHeal).not.toHaveBeenCalled();
    expect(ctx.fixAuthor.authorRewrite).not.toHaveBeenCalled();
    expect(ctx.prService.openHealPr).not.toHaveBeenCalled();
    expect(ctx.prService.openRewritePr).not.toHaveBeenCalled();
  });
});

describe('quarantine paths (R6, R7)', () => {
  it('flaky → quarantine record with hypothesis, no PR machinery touched', async () => {
    const ctx = setup();
    const record = await ctx.orchestrator.execute(
      project,
      makeDiagnosis({
        classification: 'FLAKY_NONDETERMINISTIC',
        confidence: 0.9,
        rationale: 'timing signature: timeout exceeded',
      }),
    );
    expect(record.action.kind).toBe('QUARANTINE');
    expect(ctx.quarantines[0]?.hypothesis).toContain('timing');
    expect(ctx.fixAuthor.authorHeal).not.toHaveBeenCalled();
  });

  it('feature truly removed → RECOMMEND_REMOVAL recorded, but still quarantined and never deleted', async () => {
    const ctx = setup();
    const record = await ctx.orchestrator.execute(
      projectAutoMerge,
      makeDiagnosis({
        classification: 'FEATURE_MISSING',
        confidence: 0.9,
        evidence: makeEvidenceFixture({
          appDiff: {
            baseSha: 'a',
            headSha: 'b',
            files: [{ path: 'src/components/Coupon.tsx', status: 'removed' }],
          },
          relevantAppPaths: ['src/components/Coupon.tsx'],
        }),
      }),
    );
    expect(record.action.kind).toBe('RECOMMEND_REMOVAL');
    expect(ctx.quarantines).toHaveLength(1);
    expect(ctx.quarantines[0]?.removalRecommendation).toBeDefined();
    expect(ctx.audits.some((a) => a.type === 'removal.recommended')).toBe(true);
    // No PR, no merge, no deletion — recommendation only.
    expect(ctx.prService.openHealPr).not.toHaveBeenCalled();
    expect(ctx.prService.openRewritePr).not.toHaveBeenCalled();
  });

  it('every executed action lands in the audit log', async () => {
    const ctx = setup();
    await ctx.orchestrator.execute(project, makeDiagnosis());
    expect(ctx.audits.filter((a) => a.type === 'action.decided')).toHaveLength(1);
    expect(ctx.actions).toHaveLength(1);
  });
});
