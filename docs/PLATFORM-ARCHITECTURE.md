# GenFixs SaaS Platform Architecture

This branch establishes the production foundation that future GenFixs QA capabilities depend on.
The QA engine should attach to this platform layer instead of owning tenancy, auth, billing,
settings, usage, or integrations itself.

## Technology Choices

- Web: Next.js App Router, React, Tailwind CSS, shadcn-compatible layout.
- API: Fastify, Zod request contracts, TypeScript service boundaries.
- Database: Postgres, tenant-scoped relational schema, JSONB only for bounded metadata/config.
- Events: Postgres outbox table for reliable publish-after-commit workflows.
- Queue: Redis/BullMQ already present for asynchronous QA work.
- Artifacts: S3-compatible object storage for production, filesystem only for local single-node runs.
- Containers: separate API and web Docker targets so each can scale independently.

## Service Boundaries

- `@genfixs/platform`: SaaS foundation.
  Owns organizations, teams, memberships, RBAC, invitations, projects, subscriptions, usage,
  feature flags, notification records, settings, integrations, audit logs, event contracts,
  repository interfaces, and Postgres adapters.
- `@genfixs/api`: HTTP boundary.
  Mounts `/api/platform/*` for SaaS platform operations and existing `/api/projects/*` QA endpoints.
- `@genfixs/web`: Next.js web application.
  Hosts public foundation entry, onboarding, and authenticated app routes.
- Existing QA packages remain feature-domain packages.
  They should require a platform `organizationId` and `projectId` rather than inventing their own
  tenant model.

## Database Architecture

The platform schema is in `packages/platform/migrations/001_platform.sql`.

Core tables:

- `platform_users`, `platform_auth_identities`, `platform_sessions`
- `platform_organizations`, `platform_teams`, `platform_memberships`, `platform_team_memberships`
- `platform_projects`
- `platform_invitations`
- `platform_audit_logs`
- `platform_subscriptions`
- `platform_usage_meters`, `platform_usage_records`
- `platform_feature_flags`, `platform_feature_flag_overrides`
- `platform_notifications`, `platform_notification_preferences`
- `platform_settings`
- `platform_integrations`
- `platform_event_outbox`
- `platform_api_keys`

Every customer-owned record is scoped by `organization_id`. Project-level records use
`project_id` under that organization. Future QA tables should follow the same rule.

## Authorization

RBAC lives in `packages/platform/src/rbac.ts`.

Roles:

- `owner`
- `admin`
- `developer`
- `viewer`
- `billing_admin`

Permissions are explicit strings such as `projects:manage`, `settings:manage`, `billing:manage`,
and `audit:read`. Service methods call `AuthorizationService.assertPermission` before mutating
tenant data.

## API Architecture

Platform routes are mounted in `packages/api/src/platformRoutes.ts`.

Important routes:

- `GET /api/platform/status`
- `POST /api/platform/bootstrap`
- `GET /api/platform/users/:userId/organizations`
- `GET /api/platform/organizations/:organizationId`
- `POST /api/platform/projects`
- `POST /api/platform/invitations`
- `POST /api/platform/usage`
- `PUT /api/platform/settings`
- `PUT /api/platform/feature-flags/:key`
- `PUT /api/platform/feature-flags/:key/organizations/:organizationId`
- `GET /api/platform/feature-flags/:key/organizations/:organizationId`
- `PUT /api/platform/integrations`
- `PUT /api/platform/subscriptions`
- `POST /api/platform/notifications`
- `GET /api/platform/organizations/:organizationId/events`

Request contracts are Zod schemas in `packages/platform/src/contracts.ts`.

## Event Architecture

Events are written to `platform_event_outbox` by platform services. This gives future workers a
safe publish boundary for notifications, billing sync, integration sync, and QA processing.

Event constants live in `packages/platform/src/events.ts`.

## Observability, Logging, And Errors

The foundation uses typed domain/service errors and API error mapping:

- Zod validation errors become `400 invalid request`.
- RBAC failures become `403 forbidden`.
- Platform database unavailability becomes `503 platform database unavailable`.

Typed observability boundaries live in `packages/platform/src/observability.ts`:

- `Logger` and `ConsoleJsonLogger` for structured JSON logs.
- `Tracer` and `TraceContext` for future OpenTelemetry adapters.
- `PlatformError` for operational errors with stable codes and HTTP status mapping.

The production next step is to plug OpenTelemetry into the `Tracer` interface around API handlers,
repository calls, queue jobs, and outbox publishers.

## Deployment Architecture

`Dockerfile` defines:

- `api` target: Fastify API on port `4000`.
- `web` target: Next.js web app on port `3000`.

`docker-compose.yml` runs:

- Postgres
- Redis
- API
- Web

Local production-shaped run:

```bash
cp .env.example .env
docker compose up --build
```

## Future QA Integration Rule

Every future GenFixs QA capability should accept platform IDs:

- `organizationId`
- `projectId`
- `actorUserId` when user-driven

It should emit platform audit logs and outbox events for durable visibility.
