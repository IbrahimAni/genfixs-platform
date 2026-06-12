# GenFixs v1 Build Plan

*Scope: P0 requirements R1–R9 from `GenFixs-product-development-document.md`. P1/P2 features are out of scope; P2 architectural insurance (persist `TestFlowModel` flow traces, graph-ready entities) is honored from day one.*

**Status legend:** `PLANNED` · `IN PROGRESS` · `DONE` · `PARTIAL (notes)`

---

## Architecture summary

- **Monorepo:** pnpm workspaces + turborepo. TypeScript end to end, strict mode everywhere.
- **Packages:** `domain`, `ingestion`, `evidence-builder`, `diagnosis-engine`, `action-orchestrator`, `fix-author`, `pr-service`, `api`, `web`.
- **Infra:** Postgres (system of record), S3-compatible object store (artifacts), BullMQ on Redis (event-driven pipeline). All three behind interfaces with in-memory fakes so the full pipeline runs locally with zero external services.
- **External dependencies stubbed behind interfaces:** `GitHubClient` (App auth, PRs, diffs, checks), `LlmClassifier`, `BrowserRunner` (Playwright sandbox runs), `ObjectStore`, `Queue`. Real adapters are drop-in; fakes are the default in dev/test/demo.
- **Pipeline (queue-driven):** `run.ingested` → evidence-builder → `evidence.ready` → diagnosis-engine → `diagnosis.ready` → action-orchestrator → (`heal.requested` → fix-author → verification → pr-service) | (`report.requested` → pr-service issue) | quarantine writes. Every agent action lands in an append-only audit log.

## Trust invariants (encoded as code + tests, never comments)

These are enforced in the **action-orchestrator** (deterministic policy) and asserted by exhaustive tests:

1. **No false greens.** Only `BENIGN_DRIFT` may produce a HEAL. `REAL_REGRESSION_SUSPECTED` can never produce any test-editing action regardless of confidence, policy, or LLM output. Explicit refusal tests.
2. **LLM classifies; policy decides.** The decision table (spec §8) is a pure, deterministic function `(Diagnosis, MergePolicy) → AgentAction`. Model output can never directly trigger a merge or deletion.
3. **Deletion gated hardest.** No code path can auto-merge a deletion or emit a delete action. `FEATURE_MISSING` maxes out at `RECOMMEND_REMOVAL` (human-only execution) and defaults to quarantine.
4. **Author, don't notify.** `BEHAVIOR_CHANGE` always yields a drafted rewrite PR requiring human approval — never a bare notification, never auto-merge.
5. **When in doubt, do nothing.** Confidence below project threshold degrades to `UNCLASSIFIED` → quarantine. Healing requires the highest confidence; doing nothing requires none.
6. **Verify before surfacing.** A heal/rewrite PR is never opened unless the authored test verified green in the sandbox. Enforced in the fix-author → pr-service handoff, with tests.

---

## Milestones

### M0 — Repo scaffold `DONE`
Monorepo bootstrap: pnpm workspaces, turborepo, shared tsconfig/eslint/prettier, vitest, CI-ready scripts (`build`, `test`, `lint`, `typecheck`). Empty package shells. `docs/DECISIONS.md` started.

**Exit:** `pnpm build && pnpm test` green across all packages.

### M1 — `domain` package (spec §9) `DONE`
The shared vocabulary every service consumes. No service code before this.

- Types/entities: `Classification` enum, `Project`, `MergePolicy`, `TestRun`, `TestResult`, `FailureEvidence`, `Diagnosis`, `EvidenceBundle`, `AgentAction`, `IntentArtifact`, `SuiteHealthSnapshot`, `ArtifactRef`, `RepoRef`, `OrgRef`, audit-log event types.
- **P2 insurance:** `TestFlowModel` (ordered step/selector traces per test) as a first-class persisted entity; entities carry stable IDs and structured links (test ↔ selectors ↔ flows ↔ app paths) so the v2 graph can be assembled later.
- Zod schemas for runtime validation at every service boundary; queue event payload types.
- Stable test identity: `testId = hash(file + title)` helper (spec §17 open question — logged in DECISIONS.md).

**Exit:** typed, validated, unit-tested; all later packages import only from here.

### M2 — `ingestion` (R1) `PLANNED`
- Playwright JSON report parser (first-class), JUnit XML parser (fallback) → normalized `TestRun`/`TestResult`/`FailureEvidence`.
- Report upload endpoint + webhook receiver shape (stateless, queue-backed); artifacts (traces, screenshots, DOM snapshots) persisted to the object store with lifecycle metadata.
- Emits `run.ingested`.

**Exit:** real Playwright report fixtures (passing, failing, mixed, with attachments) round-trip into normalized entities; JUnit fallback covered.

### M3 — `evidence-builder` `PLANNED`
- Assembles `EvidenceBundle`: app-repo diff last-green → failing commit (via `GitHubClient`, optional — absence degrades gracefully), run-history flake statistics per testId, linked intent artifacts, failure artifacts.
- Pure-selector-diff detector (is the test-relevant diff exclusively locator/attribute changes?) — feeds the deterministic pre-filter.
- Emits `evidence.ready`.

**Exit:** bundles built with and without app-repo connection; flake stats correct on seeded run history.

### M4 — `diagnosis-engine` (R2) `PLANNED`
- **Stage 1, deterministic pre-filters (no LLM):** flake-statistics filter (intermittent pass/fail history + timing/network error signatures → `FLAKY_NONDETERMINISTIC`); pure-selector-drift filter (selector-only app diff + locator-not-found error → `BENIGN_DRIFT` high confidence).
- **Stage 2, LLM classification** for the ambiguous remainder, behind `LlmClassifier` interface (deterministic rule-based fake for tests/demo; real Claude adapter swappable). Output constrained to the §8 table vocabulary: classification + confidence + rationale.
- Confidence thresholds come from project policy; **below threshold → `UNCLASSIFIED`**, always.
- Emits `Diagnosis` + `diagnosis.ready`.

**Exit (critical acceptance, R2):** app-logic break with untouched locators → `REAL_REGRESSION_SUSPECTED`, never `BENIGN_DRIFT`; renamed testid with cosmetic diff → `BENIGN_DRIFT` high confidence; low confidence → `UNCLASSIFIED`. Pre-filters never invoke the LLM stub when they match.

### M5 — `action-orchestrator` (the trust core; spec §8) `PLANNED`
- The §8 decision table as a pure deterministic policy function; exhaustive unit tests over **every classification × policy permutation × confidence band** — the most important tests in the codebase.
- Explicit refusal tests: regression never healed; deletion never auto-merged; `BEHAVIOR_CHANGE` never auto-merge-eligible; `UNCLASSIFIED`/`FLAKY` → quarantine with hypothesis; bias rule (conflicting signals → less destructive action).
- Auto-merge eligibility: only `BENIGN_DRIFT` + per-repo opt-in (off by default) + verified green.
- Quarantine manager (R6, R7): skip-with-annotation records (never delete), age + reason + root-cause hypothesis tracked.
- Audit log write for every decided action.

**Exit:** exhaustive policy test suite green; mutation-style negative tests prove the forbidden transitions are unrepresentable.

### M6 — `fix-author` + verification sandbox (R3, R4, R8) `PLANNED`
- Heal author for `BENIGN_DRIFT`: minimal locator/selector-level edit, **assertions untouched** (enforced by a post-edit AST/diff guard that rejects any heal touching assertions or flow logic).
- Rewrite author for `BEHAVIOR_CHANGE`: drafts updated test + diff-level evidence summary + "is this intended?" framing.
- Style matching (R8): respect repo prettier/eslint configs, locator-strategy detection, run lint/format on output.
- **Verification sandbox:** authored test runs via `BrowserRunner` (Playwright adapter; scripted fake for local/test). Not-green → no PR, action degrades to quarantine/escalate. Verification runs capture and persist `TestFlowModel` traces (P2 insurance).

**Exit:** heal fixture verifies green and produces a locator-only diff; a heal attempt that would touch an assertion is rejected by the guard with a test proving it; failed verification provably never reaches pr-service.

### M7 — `pr-service` (R3, R4, R5) `PLANNED`
- `GitHubClient` interface (least-privilege GitHub App shape) + full in-memory fake; real Octokit adapter stubbed for later credentials.
- Structured PR bodies: classification, evidence, what drifted/changed, why it's safe / "is this intended?". Branch-protection honored.
- Auto-merge call allowed **only** when the orchestrator's decided action carries auto-merge eligibility (re-checked here — defense in depth).
- Regression reports (R5) as GitHub issues: failing assertion, suspect app change, repro steps, severity hints; test stays red and untouched.

**Exit:** PRs/issues created against the fake with correct bodies and merge gates; double-enforcement test that pr-service refuses auto-merge for anything but eligible `BENIGN_DRIFT`.

### M8 — `api` + persistence + pipeline wiring `PLANNED`
- Postgres schema (projects, runs, results, diagnoses, actions, quarantine, flow traces, audit log, health snapshots) behind a repository layer with an in-memory fake; migrations included.
- BullMQ queue wiring of M2–M7 into the event-driven pipeline; in-memory queue fake for tests.
- REST API for the dashboard: projects, suite health (R9 metrics: pass/fail trend, breaks by classification, auto-heal rate, regressions caught, quarantine backlog, mean time-to-green), failures inbox, diagnosis detail, quarantine list, settings (merge policy, thresholds, repo connection).

**Exit:** end-to-end integration test — ingest fixture report → diagnosis → action → PR/issue/quarantine → visible via API, entirely on fakes.

### M9 — `web` dashboard (R9) `PLANNED`
React + Vite + Tailwind with a small design-token layer (near-monochrome: off-white ground, single gray scale, one restrained accent; muted green/amber/red only on test states and classifications; Inter; no gradients or decoration). shadcn/ui as a quiet base.

Screens:
1. **Project overview** — suite-health snapshot, pass/fail trend, R9 metrics, calm tables/sparklines.
2. **Failures inbox** — grouped by classification.
3. **Diagnosis detail** — evidence bundle, confidence, decided action, PR/issue link.
4. **Quarantine list** — age, reason, root-cause hypothesis.
5. **Settings** — repo connection, merge policy (auto-merge opt-in), confidence thresholds.

**Exit:** all five screens live against the API; lint/typecheck/test green.

### M10 — Demo mode + hardening `PLANNED`
- Seed script: fake project + sample runs producing at least one of **every** classification (including the false-green trap refused and the flag-hidden feature quarantined as cannot-locate, per the experiment plan), so the dashboard is reviewable immediately.
- Full-suite pass, `docs/DECISIONS.md` finalized, README with run instructions, BUILD-PLAN statuses updated.

**Exit:** `pnpm demo` boots API + web with seeded data; one command runs everything locally on fakes.

---

## Explicitly deferred (hard boundaries per spec §3)
Test generation (R10), Cypress (R11), GitLab (R12), Slack/Jira integrations (R13), intent-aware healing (R14), feature graph/observatory/multi-role (R15–R18), running customer suites on our compute, fixing app-level flakiness.
