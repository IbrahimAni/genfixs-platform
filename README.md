# GenFixs

GenFixs is an autonomous test-maintenance engineer: it keeps a team's existing
Playwright suite green, honest, and trustworthy — working inside their own repo
and CI — so that a passing suite actually means the product works.

Spec and rationale live in [`docs/`](docs/):

- [`GenFixs-product-development-document.md`](docs/GenFixs-product-development-document.md) — the buildable spec (source of truth)
- [`GenFixs-product-brief.md`](docs/GenFixs-product-brief.md) — vision and principles
- [`GenFixs-experiment-plan.md`](docs/GenFixs-experiment-plan.md) — the validation runbook
- [`BUILD-PLAN.md`](docs/BUILD-PLAN.md) — milestones and status
- [`DECISIONS.md`](docs/DECISIONS.md) — open-interpretation decisions

## The non-negotiables (where they live in code)

| Principle                                  | Enforcement                                                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Heal silently, fail loudly                 | Only `BENIGN_DRIFT` can reach the heal path (`action-orchestrator/src/policy.ts`); the structural guard rejects any edit beyond the selector rename (`fix-author/src/assertionGuard.ts`) |
| A false green is worse than a false red    | `REAL_REGRESSION_SUSPECTED` can never produce a test edit; refusal asserted in `policy.test.ts` and `orchestrator.test.ts` exhaustively                                                  |
| Author, do not notify                      | `BEHAVIOR_CHANGE` always yields a drafted, verified rewrite PR requiring human approval; no auto-merge code path exists for rewrites (`pr-service`)                                      |
| Deletion is gated hardest                  | No DELETE action is representable in the domain model; `FEATURE_MISSING` maxes out at a quarantine + recommendation; `deletionRequiresSignoff` is a literal `true` in the policy schema  |
| When in doubt, never heal                  | Confidence below project thresholds degrades to `UNCLASSIFIED` → quarantine (diagnosis engine AND orchestrator re-check)                                                                 |
| Verify before surfacing                    | An unverified heal/rewrite never becomes a PR; it degrades to quarantine (`orchestrator.ts`); no verification environment ⇒ no PR                                                        |
| The customer's repo is the source of truth | All changes ship as PRs via a least-privilege GitHub App surface (`pr-service`)                                                                                                          |

The LLM classifies; deterministic policy decides. Model output never directly
triggers a merge or deletion.

## Layout

pnpm workspace, TypeScript end to end:

| Package                        | Role                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`              | Shared model (spec §9): entities, classification enum, policy, ports for all external dependencies, in-memory fakes |
| `packages/ingestion`           | Playwright JSON report parsing (JUnit XML fallback), artifact persistence, `run.ingested` events (R1)               |
| `packages/evidence-builder`    | Evidence bundles: app diff, flake statistics, selector analysis (graph-ready links, R15 insurance)                  |
| `packages/diagnosis-engine`    | Deterministic pre-filters first, LLM classification for the ambiguous remainder, confidence gates (R2)              |
| `packages/action-orchestrator` | The spec §8 decision table as pure policy + the executor that enforces the principles (the trust core)              |
| `packages/fix-author`          | Heal/rewrite authoring, assertion guard, verification sandbox, flow-trace capture (R3, R4, R8)                      |
| `packages/pr-service`          | PR/issue boundary with double-enforced merge gates (R3–R5)                                                          |
| `packages/api`                 | Repositories (in-memory + Postgres), queue wiring (in-memory + BullMQ), Fastify HTTP API, demo seed                 |
| `packages/web`                 | Suite-health dashboard (R9): overview, failures inbox, diagnosis detail, quarantine, settings                       |

Everything external — GitHub, the classifier model, browser runs, object
storage, the queue — sits behind a port with an in-memory fake, so the entire
system runs and tests locally with zero external services. Real adapters
(GitHub REST, Playwright runner, Postgres, BullMQ) are included and swap in via
the composition root (`packages/api/src/context.ts`).

## Run it

### Development / demo

```bash
pnpm install
pnpm test        # full suite; live Postgres/Redis/browser tests run when available
pnpm build       # typecheck all packages + build the dashboard

# Demo mode: a seeded project covering every classification —
# including the refused false-green trap and the flag-hidden feature.
pnpm demo                          # API on :4000
pnpm --filter @genfixs/web dev     # dashboard on :5173 (proxies /api)
```

### Production

```bash
cp /dev/null .env   # fill in from CREDENTIALS.md
docker compose up --build
```

Postgres and Redis are included; everything else goes live as you provide
credentials (see [`CREDENTIALS.md`](CREDENTIALS.md)). The API serves the built
dashboard on the same port and reports integration readiness at
`GET /api/status` and in the startup log.

Bare-metal equivalent: set the env vars and `pnpm --filter @genfixs/api start`.

### Connect a suite's CI

After connecting a project in the dashboard (or `POST /api/projects`), add an
upload step to the suite's CI:

```yaml
- run: npx playwright test --reporter=json > pw-report.json || true
- run: node node_modules/@genfixs/ingestion/bin/genfixs-upload.mjs
    --project "$GENFIXS_PROJECT_ID" --report pw-report.json --commit "$GITHUB_SHA"
  env:
    GENFIXS_API_URL: ${{ vars.GENFIXS_API_URL }}
    GENFIXS_API_TOKEN: ${{ secrets.GENFIXS_API_TOKEN }}
```

JUnit XML works too (`--format junit-xml`) for non-Playwright CI.

## Status

v1 / P0 scope (R1–R9) complete and production-wired: 104 tests including live
integration runs on real Postgres, Redis/BullMQ, and real Chromium
verification. Real adapters for every external dependency; what's left to go
fully live is the customer-side credentials listed in
[`CREDENTIALS.md`](CREDENTIALS.md). See [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md)
for per-milestone status.
