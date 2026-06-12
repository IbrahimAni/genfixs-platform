# GenFixs: Product Development Document

*Version 1.0. Consolidates the founding brainstorm, the product brief, the validation experiment, and the competitive positioning into a single document a team can build from.*

**One-liner:** GenFixs is an autonomous test-maintenance engineer. It keeps a team's existing automated test suite green, honest, and trustworthy, working inside their own repo and CI, so that a passing suite actually means the product works.

---

## 1. Problem statement

Teams that automate testing no longer struggle to write tests. They struggle to keep them alive. Tests go flaky, break on every UI change, and engineers burn hours triaging walls of red to find the one failure that matters. The result is predictable: suites rot, get ignored, or worse, get "fixed" carelessly so that real regressions hide behind green checkmarks.

The pain is present-tense and universal for any team with a real Playwright or Cypress suite. The cost of not solving it is twofold: wasted senior engineering time on mechanical fix work, and the silent risk of shipping bugs behind a passing build.

## 2. Goals

1. **Time-to-value under one week.** A customer connects their CI and existing repo and receives their first correct, useful maintenance PR within seven days, with no migration and no rewriting.
2. **Zero false greens.** GenFixs never converts a genuinely failing test into a passing one when application behavior has changed. This is an absolute, not a percentage.
3. **Majority of mechanical breaks resolved with zero human time.** Benign locator and selector drift is healed automatically via auto-mergeable green PRs. Target to be calibrated by the validation experiment (Section 14).
4. **Human effort collapses from authoring to approving.** For behavioral changes, the agent authors the fix and the human's job is a short review, never a rewrite.
5. **Stakeholders can see suite health at a glance,** turning the test suite from an engineer-only artifact into a team-visible quality signal.

## 3. Non-goals (v1)

- **Test generation from scratch.** Generation grounded in specs is the v2 expansion, not the entry. Entering through existing suites is the wedge. (Exception: the on-demand, engineer-triggered generation flow is P1, see Section 7.)
- **The full feature node graph.** Powerful for impact analysis, but load-bearing for none of the three v1 behaviors. Deferred to v2, where it powers blast-radius detection.
- **Unit tests.** Engineers own these. GenFixs operates at the e2e/browser level.
- **API, security, and performance testing.** v3 breadth. v1 wins by being 10x at one job.
- **Fixing app-level flakiness.** Race conditions, shared state, and timing issues are often real app problems. GenFixs quarantines these and hands the engineer a root-cause hypothesis. It does not pretend to fix them by editing tests.
- **Replacing the QA function on day one.** That is the three-year destination, earned through trust. The v1 pitch is force-multiplication, with the QA lead as champion.
- **Running customer test suites on GenFixs compute.** Tests run in the customer's CI. This is both a trust decision and the key cost-containment decision.

## 4. Target users and personas

- **QA Lead / QA Manager (champion and buyer).** Owns suite health, drowning in maintenance triage. Wins when the suite stays green without babysitting.
- **Automation / QA Engineer (daily user).** Reviews and approves agent-authored PRs, handles escalations, configures the integration.
- **Software Engineer (indirect user).** Receives real-regression reports with evidence instead of vague "test is red" noise.
- **Product Owner / Business Analyst (v2 user).** Supplies intent artifacts (PRDs, acceptance criteria) that ground generation and intent-aware healing.
- **Engineering leadership (stakeholder).** Consumes suite-health reporting; carries the fear of the regression that shipped behind a green build.

The buyer profile is engineering-led teams who own quality in code and CI, and who will not migrate their tests into a low-code walled garden.

## 5. User stories

Ordered by priority.

1. As a QA engineer, I want GenFixs to automatically fix tests broken by renamed locators and open a green PR, so that I never spend time on mechanical selector fixes.
2. As a QA engineer, I want GenFixs to detect when a test failure reflects a real app regression and refuse to touch the test, so that bugs are never hidden behind a healed test.
3. As a QA engineer, I want GenFixs to author a proposed test update when a flow legitimately changes, with the app change attached as evidence, so that my job is a thirty-second confirm instead of a rewrite.
4. As a QA engineer, I want unclassifiable failures quarantined with a root-cause hypothesis, so that flaky tests stop polluting the signal while staying visible.
5. As a QA lead, I want a suite-health view (heal rate, real regressions caught, quarantine backlog), so that I can report quality status to stakeholders without manual collation.
6. As a QA engineer, I want GenFixs to flag tests whose target feature appears to be removed, recommending quarantine and requiring my sign-off before any deletion, so that coverage never silently shrinks.
7. As a software engineer, I want regression reports that include the failing assertion, the relevant app change, and a reproduction, so that I can fix the bug without re-deriving the diagnosis.
8. As a QA engineer, I want agent-authored code to match my repo's existing conventions and style, so that PRs read like a teammate wrote them.
9. (P1) As a QA engineer, I want to request new tests grounded in an uploaded spec or linked Jira ticket, review the generated test cases first, and trigger code generation per-case or in bulk, so that coverage grows deliberately and cost stays controlled.

## 6. Core principles (non-negotiable, encode these in the system)

1. **Heal silently, fail loudly.** Auto-fix only pure drift where the test's intent is preserved. Surface real behavior changes. When in doubt, never heal.
2. **A false green is worse than a false red.** Nobody investigates green. Every component that edits tests must be biased accordingly.
3. **Author, do not notify.** Even for changes requiring human judgment, the agent drafts the fix. "Manual" always means "human approves what the agent wrote," never "human writes it."
4. **Deletion is gated hardest.** Never auto-merge a deletion. Prefer quarantine/skip over delete. Require strong evidence plus explicit human sign-off. An agent that deletes tests can drive coverage to zero and call the suite green.
5. **Ground in intent.** Specs and acceptance criteria are ground truth. Jira/Slack activity are tripwires (signals an area is in motion), never specifications.
6. **The customer's repo is the source of truth.** All changes arrive as PRs into their repository, in their style, reviewed in their workflow.

## 7. Functional requirements

### P0: Must-have (v1 cannot ship without these)

**R1. CI and repo integration**
- Connect to GitHub (first), consuming test run results (Playwright report ingestion first; JUnit XML as a general fallback) and reading/writing the test repo via a GitHub App with least-privilege scopes.
- Acceptance: Given a connected repo and CI, when a test run completes with failures, then GenFixs ingests the full report (traces, errors, DOM snapshots where available) within minutes and begins diagnosis.

**R2. Failure classification engine (the heart of the product)**
- Every failing test is classified into exactly one of: `BENIGN_DRIFT`, `BEHAVIOR_CHANGE`, `REAL_REGRESSION_SUSPECTED`, `FEATURE_MISSING`, `FLAKY_NONDETERMINISTIC`, `UNCLASSIFIED`.
- Inputs: the failing test code, the failure artifacts (error, trace, screenshots, DOM snapshot), the app diff between last-green and current commit (when the app repo is connected), run history for flake statistics, and intent artifacts when available.
- Each classification carries a confidence score. Below threshold, the result degrades to `UNCLASSIFIED`.
- Acceptance (the critical negative case): Given an app change that breaks logic while locators are untouched, when the test fails, then classification is `REAL_REGRESSION_SUSPECTED` and no fix is authored. The test is never edited.
- Acceptance: Given a renamed testid with unchanged behavior, when the test fails, then classification is `BENIGN_DRIFT` with high confidence.

**R3. Auto-heal for benign drift**
- For `BENIGN_DRIFT`: author the minimal fix, verify it locally (run the healed test against the current app build), and open a PR that is already green. Auto-merge is configurable per repo and off by default until the customer enables it.
- Acceptance: Given a `BENIGN_DRIFT` classification, when the heal is authored, then the PR contains only locator/selector-level changes, assertions are untouched, the PR body explains what drifted, and CI passes before the PR is surfaced.

**R4. Proposed fixes for behavior changes**
- For `BEHAVIOR_CHANGE`: author the updated test matching the new flow, attach evidence of the app change, and open a PR explicitly requiring human confirmation that the new behavior is intended. Never auto-merge.
- Acceptance: Given a flow extended from two steps to four, when GenFixs processes the failure, then the PR contains the rewritten test, a diff-level summary of the app change, and the question "is this intended?", and the PR cannot merge without human approval.

**R5. Regression reporting**
- For `REAL_REGRESSION_SUSPECTED`: produce a report containing the failing assertion, the suspect app change, reproduction steps, and severity hints. Deliver to the configured channel (GitHub issue first; Slack/Jira as P1 integrations).
- Acceptance: the test remains red and untouched until the regression is resolved or a human reclassifies.

**R6. Quarantine and escalation**
- For `FLAKY_NONDETERMINISTIC` and `UNCLASSIFIED`: quarantine (skip-with-annotation, never delete), and escalate with a root-cause hypothesis (timing, network, shared state, ambiguous diff).
- Acceptance: quarantined tests are visibly tracked with age and reason; the quarantine list is part of suite-health reporting.

**R7. Feature-missing handling**
- For `FEATURE_MISSING`: distinguish "cannot locate" from "truly removed" using available evidence (app diff, feature flags). Recommend quarantine; deletion is a human-only action behind explicit sign-off.
- Acceptance: Given a feature hidden behind a flag, when its tests fail, then GenFixs quarantines as cannot-locate and does not propose deletion.

**R8. Style-matched authorship**
- Authored code follows the repo's existing conventions: locator strategy, helper usage, naming, fixtures, formatting (respect lint/prettier configs).
- Acceptance: PRs pass the repo's existing lint/format CI without manual cleanup.

**R9. Suite-health dashboard (minimal)**
- Per project: pass/fail trend, breaks by classification, auto-heal rate, regressions caught, quarantine backlog, mean time-to-green.
- This is the seed of the later "observatory," scoped to maintenance signals only.

### P1: Nice-to-have (fast follows)

- **R10. Spec-grounded on-demand generation.** Upload specs / link Jira; agent drafts test cases first; engineer triggers code generation per-case or bulk; output lands as PRs. New-repo customers get a recommended structure scaffold; existing repos get style-matched tests.
- **R11. Cypress support** (Playwright is the v1 framework).
- **R12. GitLab support** (GitHub is v1).
- **R13. Slack and Jira notification/reporting integrations,** including Jira/Slack activity as re-check tripwires.
- **R14. Intent-aware healing.** Where specs exist, use them to verify that a heal preserves the assertion's protected intent.

### P2: Future considerations (design for, do not build)

- **R15. Feature node graph and impact analysis.** Component-to-feature-to-test mapping enabling blast-radius detection ("this component changed, these tests are at risk"). Architectural implication now: persist structured links between tests, selectors, flows, and app code paths so the graph can be assembled later.
- **R16. Full observatory** for all stakeholders across test types.
- **R17. Broader test types:** API, security, performance.
- **R18. Multi-role workflow** (BA/PO spec approval loops) toward the "replace much of the QA function" destination.

## 8. The classification policy (decision table)

| Classification | Evidence pattern | Action | Merge policy | Human time |
|---|---|---|---|---|
| BENIGN_DRIFT | Selector/DOM drift, intent preserved, app diff cosmetic | Author heal, verify green, open PR | Auto-merge eligible (opt-in) | Zero |
| BEHAVIOR_CHANGE | Flow/assertion no longer matches app, diff shows intentional-looking change | Author rewritten test + evidence | Human approval required | ~30s review |
| REAL_REGRESSION_SUSPECTED | Test logic sound, app output wrong vs. expectation/intent | Report bug, do not touch test | N/A (no PR) | Engineer fixes app |
| FEATURE_MISSING | Target unreachable; diff suggests removal or gating | Quarantine; recommend removal only with strong evidence | Deletion: human sign-off only, never auto | Review |
| FLAKY_NONDETERMINISTIC | Intermittent across history; timing/network signatures | Quarantine + root-cause hypothesis | N/A | Triage when ready |
| UNCLASSIFIED | Confidence below threshold | Quarantine + escalate | N/A | Review |

Bias rule: when signals conflict, prefer the action lower in destructiveness. Healing requires the highest confidence; doing nothing requires none.

## 9. Domain model

The core entities, expressed TypeScript-first since that is the implementation language. This is the vocabulary the whole system shares.

```typescript
type Classification =
  | 'BENIGN_DRIFT'
  | 'BEHAVIOR_CHANGE'
  | 'REAL_REGRESSION_SUSPECTED'
  | 'FEATURE_MISSING'
  | 'FLAKY_NONDETERMINISTIC'
  | 'UNCLASSIFIED';

interface Project {
  id: string;
  org: OrgRef;
  testRepo: RepoRef;            // where tests live, PRs go here
  appRepo?: RepoRef;            // optional but unlocks diff-based diagnosis
  ciProvider: 'github-actions' | 'gitlab-ci' | 'other';
  framework: 'playwright' | 'cypress';
  policies: MergePolicy;        // auto-merge opt-in, deletion gates, confidence thresholds
}

interface TestRun {
  id: string;
  projectId: string;
  commitSha: string;
  reportArtifacts: ArtifactRef[];   // playwright report, traces, screenshots
  results: TestResult[];
  startedAt: Date;
}

interface TestResult {
  testId: string;                   // stable identity across runs (file + title hash)
  status: 'passed' | 'failed' | 'skipped' | 'quarantined';
  failure?: FailureEvidence;
}

interface FailureEvidence {
  errorMessage: string;
  stackTrace: string;
  domSnapshot?: ArtifactRef;
  trace?: ArtifactRef;
  screenshots: ArtifactRef[];
}

interface Diagnosis {
  id: string;
  testId: string;
  runId: string;
  classification: Classification;
  confidence: number;               // 0..1, thresholds set per project policy
  evidence: EvidenceBundle;         // app diff, run history stats, intent refs
  decidedAction: AgentAction;
}

type AgentAction =
  | { kind: 'HEAL'; pr: PullRequestRef }                    // benign drift
  | { kind: 'PROPOSE_REWRITE'; pr: PullRequestRef }         // behavior change
  | { kind: 'REPORT_REGRESSION'; report: RegressionReport }
  | { kind: 'QUARANTINE'; hypothesis: string }
  | { kind: 'RECOMMEND_REMOVAL'; rationale: string }        // human-only execution
  | { kind: 'ESCALATE'; reason: string };

interface IntentArtifact {          // ground truth for generation + intent-aware healing
  id: string;
  projectId: string;
  source: 'upload' | 'jira' | 'confluence';
  kind: 'prd' | 'acceptance-criteria' | 'ticket';
  content: ArtifactRef;
  linkedFeatures: string[];
}

interface SuiteHealthSnapshot {
  projectId: string;
  window: DateRange;
  autoHealRate: number;             // healed with zero human time / total breaks
  falseGreenCount: number;          // must remain 0; tracked as an alarm, not a metric to optimize
  regressionsCaught: number;
  quarantineBacklog: number;
  meanTimeToGreen: number;          // hours
}
```

Design note for v2: persist `TestFlowModel` (ordered step/selector traces per test) from day one. It is cheap to capture during verification runs and becomes the substrate for the v2 feature graph and blast-radius analysis.

## 10. System architecture

Work backwards from the unit of value: a clean, correct, CI-passing pull request. Every component exists to produce that safely.

```
Customer CI ──webhook/report──▶ Ingestion ──▶ Diagnosis Engine ──▶ Action Orchestrator
   ▲                              │                │   ▲                │
   │                              ▼                ▼   │                ▼
   │                        Artifact Store    Evidence Builder     Fix Author (agent)
   │                                          (app diff, history,      │
   │                                           intent artifacts)       ▼
   │                                                              Verification Sandbox
   │                                                              (run healed test vs app)
   └──────────────── PR Service (GitHub App) ◀─────────────────────────┘
                          │
                          ▼
                 Reporting & Dashboard ──▶ QA Lead / Stakeholders
```

**Components:**

1. **Ingestion service.** Receives CI webhooks and report uploads (Playwright reporter plugin or a lightweight CLI step in the customer's pipeline). Normalizes into `TestRun`/`TestResult`. Stateless, queue-backed.
2. **Artifact store.** Traces, screenshots, DOM snapshots, reports. Object storage (S3-compatible) with lifecycle policies (e.g. raw traces expire after 30 to 90 days; diagnoses and metadata persist).
3. **Evidence builder.** Assembles the diagnosis context: app-repo diff between last-green and failing commit, run-history statistics for flake detection, linked intent artifacts. The richer this bundle, the better classification gets; the app-repo connection is optional but materially improves accuracy and should be encouraged at onboarding.
4. **Diagnosis engine.** LLM-driven classification over the evidence bundle, constrained by the decision table in Section 8, emitting `Diagnosis` with confidence. Deterministic pre-filters first (flake statistics, pure-selector diffs) so the model is reserved for genuinely ambiguous cases; this is both an accuracy and a cost lever.
5. **Action orchestrator.** Maps diagnosis to `AgentAction` under project policy (thresholds, auto-merge opt-in, deletion gates). This is where the non-negotiable principles are enforced in code, not left to model judgment.
6. **Fix author.** Agent that drafts the heal or rewrite: reads repo conventions, edits test code, runs lint/format. DOM-driven stack (Playwright plus model, Stagehand-style abstractions) on managed or self-hosted browser infrastructure; vision-based control reserved for DOM-opaque cases. Persistent authenticated sessions per role account, captured once at onboarding.
7. **Verification sandbox.** Before any PR is surfaced, the authored change runs against the current app build (customer's staging URL or ephemeral environment). A heal that does not verify green is never shown.
8. **PR service.** GitHub App with least-privilege scopes; opens PRs with structured bodies (classification, evidence, what changed, why it is safe). Honors branch protection. Auto-merge only where policy allows and only for `BENIGN_DRIFT`.
9. **Reporting and dashboard.** Suite-health snapshots, regression reports, quarantine tracking. Web app.

**Cross-cutting:**
- **Queue-based, event-driven core** (test runs arrive in bursts; diagnosis and authoring are slow, expensive jobs).
- **Multi-tenancy isolation:** per-tenant encryption of repo credentials and session state; agents run in isolated sandboxes per customer; customer code never enters shared model fine-tuning.
- **Audit log of every agent action,** because the product's pitch is trust and the audit trail is the receipt.

## 11. Data and storage

Storage is not the cost concern; compute is. Still, decide the tiers up front:

- **Relational core (Postgres):** projects, runs, results, diagnoses, actions, policies, health snapshots. This is the system of record.
- **Object storage:** artifacts (traces, screenshots, reports), lifecycle-expired aggressively.
- **The customer's repo:** the tests themselves. GenFixs never becomes the home of test code.
- **Flow traces (`TestFlowModel`):** compact structured records persisted from verification runs, the v2 graph substrate.

## 12. Economics and pricing

- **Cost structure:** the dominant variable cost is LLM tokens plus browser-agent minutes for diagnosis, authoring, and verification. Test execution stays in customer CI, which keeps GenFixs cost contained and predictable.
- **Cost levers:** deterministic pre-filters before model calls; small models for classification, large models only for authoring; verification runs scoped to the single healed test, not the suite.
- **Pricing shape:** steady subscription for "keep my suite healthy" (sized by suite size/active tests), plus opt-in credits for heavy elective work (bulk generation, large onboarding analyses). No surprise invoices: a peace-of-mind product that sends a shock bill defeats itself.
- **The number to measure first:** monthly cost to keep one real app's suite alive (diagnosis + authoring + verification compute per break, times break rate). Price from that, not from competitor anchoring alone.

## 13. Competitive positioning

Self-healing is table stakes; mabl, Testim, Applitools and others ship it, and mabl markets up to 95% maintenance elimination. GenFixs does not compete on heal-rate. The differentiation is structural:

1. **Code-native, repo-resident.** Incumbents are largely low-code systems of record where tests live in their platform. GenFixs works on the customer's existing Playwright/Cypress code, in their style, delivered as PRs. No migration, no lock-in. For engineering-led teams this is the entire decision.
2. **Trust-optimized, not heal-rate-optimized.** Aggressive healing is how regressions get turned green. GenFixs heals less on purpose; the restraint is the product. Incumbents whose headline is "95% eliminated" cannot pivot to "we heal less for safety" without undercutting themselves.
3. **Built for the engineering-led buyer,** a segment the low-code platforms serve awkwardly and the managed services (QA Wolf) replace rather than empower.

Framing: incumbents answer "how do we stop tests breaking the build" (productivity). GenFixs answers "how do we keep green honest" (trust). The proof of the trust pitch is the validation experiment's number: high safe-fix rate with zero false greens.

## 14. Validation gate (pre-build)

The full runbook lives in `GenFixs-experiment-plan.md`. Summary of the gate:

- Run blind mixed-change batches (drift, flow changes, removals, a planted real bug, a flag-hidden feature, do-not-touch changes) against repos with existing suites.
- Grade on classification accuracy, not repair count. The planted real bug must be refused, not healed.
- The output number, the share of breaks resolvable with zero human time and zero false greens, calibrates Goal 3, the pricing model, and how ambitious the v1 build should be.
- This gate should pass before committing to the full architecture build-out.

## 15. Success metrics

**Leading (days to weeks):**
- Time from repo connection to first merged GenFixs PR (target: under 7 days, stretch: under 48 hours).
- Auto-heal rate on `BENIGN_DRIFT` (target set by experiment; measure weekly).
- Classification precision on human-audited samples (target: >90% on drift vs. behavior; 100% refusal on seeded regressions in internal red-team runs).
- PR acceptance rate without modification (target: >80%).

**Lagging (weeks to months):**
- False greens in production usage: 0, tracked as an alarm with incident review, never traded off.
- Engineer hours on test maintenance per month, before vs. after (customer-reported).
- Quarantine backlog trend per customer (should trend down or stay triaged).
- Retention and expansion: customers enabling auto-merge over time is the trust metric in behavioral form.

## 16. Rollout phasing

- **Phase 0, validation:** run the experiment gate (Section 14).
- **Phase 1, private alpha:** GitHub + Playwright only, P0 requirements R1 to R9, three to five design partners with existing suites, auto-merge off, every action human-reviewed. Goal: prove classification quality on real, foreign codebases.
- **Phase 2, beta:** enable opt-in auto-merge for `BENIGN_DRIFT` once per-customer precision is demonstrated; add R10 (spec-grounded on-demand generation) and Slack/Jira reporting.
- **Phase 3, GA:** Cypress, GitLab, pricing live, dashboard hardened.
- **v2:** feature graph + impact analysis (blast radius), intent-aware healing as default.
- **v3:** broader test types, full observatory, multi-role workflow, the earned move toward replacing much of the QA function.

## 17. Open questions

**Blocking (answer before or during Phase 1):**
- Engineering: what exact signal set distinguishes `BENIGN_DRIFT` from `BEHAVIOR_CHANGE` at >90% precision, and what confidence thresholds gate each action? (The experiment informs this; the classifier design decides it.)
- Engineering: verification sandbox strategy when the customer has no staging URL or ephemeral environments. What is the minimum viable verification?
- Product: what is the addressable auto-fix rate from the experiment, and does it support a category product or force a repositioning?

**Non-blocking:**
- Product: exact subscription sizing dimension (active tests vs. monitored runs vs. seats).
- Engineering: test identity stability strategy when files/titles are refactored (content-hash vs. annotation-based IDs).
- Legal/Security: SOC 2 timeline; data-residency requirements from design partners; explicit "customer code never trains shared models" guarantee wording.
- Design: PR body template that maximizes thirty-second reviewability for `BEHAVIOR_CHANGE` approvals.

## 18. Companion documents

- `GenFixs-product-brief.md`: the narrative brief (vision, wedge, principles) for investors and new collaborators.
- `GenFixs-experiment-plan.md`: the pre-build validation runbook.
