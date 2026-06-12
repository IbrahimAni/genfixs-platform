# Credentials you need to provide

GenFixs starts with whatever you give it and clearly reports the rest: every
integration is either **LIVE** or **DEGRADED** in the startup log and at
`GET /api/status`. Nothing blocks startup; missing credentials only disable
the integration they belong to. This file lists each credential, where to get
it, and what stays disabled without it.

## Summary

| Env var                                                                   | Unlocks                                                    | Without it                                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                            | Postgres system of record                                  | In-memory state, lost on restart                                                                    |
| `REDIS_URL`                                                               | BullMQ queue (retries, scaling)                            | In-process queue, single node                                                                       |
| `ANTHROPIC_API_KEY`                                                       | Real LLM classification + rewrite authoring                | Deterministic rule-based classifier/author                                                          |
| `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` + `GITHUB_APP_INSTALLATION_ID` | Real PRs, issues, diffs, file reads against customer repos | In-memory GitHub fake; nothing reaches GitHub                                                       |
| `GITHUB_WEBHOOK_SECRET`                                                   | HMAC-verified webhook receiver (`/api/webhooks/github`)    | Webhook endpoint returns 503                                                                        |
| `GENFIXS_API_TOKEN`                                                       | Bearer-token auth on the API + dashboard                   | API is open — do not expose beyond localhost                                                        |
| `S3_BUCKET` (+ AWS credentials, optional `S3_ENDPOINT`)                   | S3-compatible artifact storage                             | Filesystem store at `GENFIXS_DATA_DIR` (default `./data/artifacts`) — real persistence, single node |
| `GENFIXS_VERIFICATION=playwright`                                         | Real-browser verification of heals/rewrites                | Scripted verification only; with neither, unverified heals are never surfaced (they quarantine)     |

Optional tuning: `GENFIXS_CLASSIFIER_MODEL` / `GENFIXS_AUTHOR_MODEL`
(default `claude-opus-4-8`), `GENFIXS_DATA_DIR`, `PORT`.

## 1. Anthropic API key — `ANTHROPIC_API_KEY`

1. Create a key at https://platform.claude.com/ (Console → API keys).
2. Set `ANTHROPIC_API_KEY=sk-ant-...`.

Used by the diagnosis engine (classification of ambiguous failures) and the
fix author (behavioral rewrites). Deterministic pre-filters run before any
model call, and model output can never directly trigger a merge or deletion —
it always passes through validation, confidence thresholds, and the policy
table.

## 2. GitHub App — `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`

Register once (GitHub → Settings → Developer settings → GitHub Apps → New):

1. **Permissions (least privilege):** Repository → Contents: Read & write,
   Pull requests: Read & write, Issues: Read & write, Metadata: Read.
   Nothing else.
2. **Webhook (optional):** URL `https://<your-host>/api/webhooks/github`,
   secret of your choosing → also set it as `GITHUB_WEBHOOK_SECRET`.
3. Generate a **private key** (App settings → Private keys). Provide the PEM
   via `GITHUB_APP_PRIVATE_KEY` — either the literal PEM or base64-encoded
   (auto-detected).
4. **Install the App** on the customer org/repos (test repo + app repo). The
   installation id is the number in the installation URL
   (`/settings/installations/<id>`) → `GITHUB_APP_INSTALLATION_ID`.
5. `GITHUB_APP_ID` is on the App's settings page.

GenFixs authenticates by minting a short-lived RS256 JWT and exchanging it for
an installation token (cached, auto-refreshed). v1 wiring is one installation;
multi-org routing is a config extension of `GitHubAppConfig.installations`.

## 3. Postgres — `DATABASE_URL`

Any Postgres ≥ 14, e.g. `postgres://user:pass@host:5432/genfixs`.
Migrations in `packages/api/migrations/` run automatically at startup.
`docker-compose.yml` ships one preconfigured.

## 4. Redis — `REDIS_URL`

Any Redis ≥ 6, e.g. `redis://host:6379`. Enables BullMQ with retries and
exponential backoff. `docker-compose.yml` ships one preconfigured.

## 5. API token — `GENFIXS_API_TOKEN`

Generate any strong secret (e.g. `openssl rand -hex 32`). The dashboard
prompts for it once and stores it in the browser; CI uses it with
`genfixs-upload --token`. **v1 is single-tenant** — one token guards the whole
API; per-user accounts/SSO are future work and noted in the build plan.

## 6. Artifact storage — `S3_BUCKET` (optional)

Filesystem storage works out of the box and persists under
`GENFIXS_DATA_DIR`. For S3-compatible storage set `S3_BUCKET`, standard AWS
credentials (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`), and
`S3_ENDPOINT` for MinIO/R2. Configure bucket lifecycle rules to expire raw
traces after 30–90 days (spec §10.2).

## 7. Verification browsers — `GENFIXS_VERIFICATION=playwright`

The worker image needs `@playwright/test` and browsers
(`npx playwright install chromium`, or set `PLAYWRIGHT_BROWSERS_PATH`).
Each project also needs a **verification URL** (staging/preview) in its
settings — without one, GenFixs refuses to surface unverified fixes for that
project by design.

## Checking what's live

```bash
curl -s localhost:4000/api/status | jq
```

or read the startup log:

```
GenFixs API listening on :4000
  [LIVE]     database: postgres
  [DEGRADED] github: in-memory fake (needs: GITHUB_APP_ID, ...)
  ...
```
