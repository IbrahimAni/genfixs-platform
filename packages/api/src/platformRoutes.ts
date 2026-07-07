import {
  BootstrapWorkspaceRequestSchema,
  CreateInvitationRequestSchema,
  CreateProjectRequestSchema,
  RecordUsageRequestSchema,
  UpsertSettingRequestSchema,
  newId,
  type PlatformContext,
} from '@genfixs/platform';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';

const UpsertFeatureFlagSchema = z.object({
  key: z.string().min(1),
  description: z.string().min(1),
  defaultEnabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100).default(0),
});

const FeatureFlagOverrideSchema = z.object({
  organizationId: z.string(),
  enabled: z.boolean(),
});

const UpsertIntegrationSchema = z.object({
  organizationId: z.string(),
  provider: z.enum(['github', 'gitlab', 'slack', 'stripe', 'vercel', 'sentry', 'custom']),
  status: z.enum(['pending', 'active', 'disabled', 'error']),
  externalAccountId: z.string().nullable().optional(),
  scopes: z.array(z.string()).default([]),
  config: z.record(z.unknown()).default({}),
  secretRef: z.string().nullable().optional(),
});

const QueueNotificationSchema = z.object({
  organizationId: z.string(),
  userId: z.string().nullable().optional(),
  channel: z.enum(['email', 'slack', 'webhook', 'in_app']),
  eventType: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
});

const UpsertSubscriptionSchema = z.object({
  organizationId: z.string(),
  provider: z.enum(['stripe', 'manual']),
  providerCustomerId: z.string().nullable().optional(),
  providerSubscriptionId: z.string().nullable().optional(),
  plan: z.enum(['free', 'starter', 'growth', 'enterprise']),
  status: z.enum(['trialing', 'active', 'past_due', 'canceled', 'paused']),
  currentPeriodStart: z.coerce.date().nullable().optional(),
  currentPeriodEnd: z.coerce.date().nullable().optional(),
  trialEndsAt: z.coerce.date().nullable().optional(),
});

export async function registerPlatformRoutes(
  app: FastifyInstance,
  platform: PlatformContext | undefined,
): Promise<void> {
  const requirePlatform = (reply: FastifyReply): PlatformContext | undefined => {
    if (platform) return platform;
    void reply.code(503).send({
      error: 'platform database unavailable',
      detail: 'Set DATABASE_URL so the SaaS platform schema and repositories can initialize.',
    });
    return undefined;
  };

  app.get('/api/platform/status', async (_req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    return { ok: true, architecture: 'postgres-backed multi-tenant SaaS platform' };
  });

  app.post('/api/platform/bootstrap', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = BootstrapWorkspaceRequestSchema.parse(req.body);
    const result = await ctx.services.bootstrapWorkspace(body, requestContext(req));
    return reply.code(201).send(result);
  });

  app.get('/api/platform/users/:userId/organizations', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const { userId } = req.params as { userId: string };
    return ctx.repos.organizations.listForUser(userId);
  });

  app.get('/api/platform/organizations/:organizationId', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const { organizationId } = req.params as { organizationId: string };
    const organization = await ctx.repos.organizations.get(organizationId);
    if (!organization) return reply.code(404).send({ error: 'unknown organization' });
    const [teams, projects, memberships, subscription, usage, integrations, settings, audit] =
      await Promise.all([
        ctx.repos.teams.listByOrganization(organizationId),
        ctx.repos.projects.listByOrganization(organizationId),
        ctx.repos.memberships.listByOrganization(organizationId),
        ctx.repos.subscriptions.getByOrganization(organizationId),
        ctx.repos.usage.summarize(organizationId),
        ctx.repos.integrations.listByOrganization(organizationId),
        ctx.repos.settings.list({ organizationId }),
        ctx.repos.audit.listByOrganization(organizationId, 25),
      ]);
    return { organization, teams, projects, memberships, subscription, usage, integrations, settings, audit };
  });

  app.post('/api/platform/projects', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = CreateProjectRequestSchema.parse(req.body);
    const project = await ctx.services.createProject(body, requestContext(req));
    return reply.code(201).send(project);
  });

  app.post('/api/platform/invitations', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = CreateInvitationRequestSchema.parse(req.body);
    const actor = requestContext(req);
    if (!actor.userId) return reply.code(401).send({ error: 'x-genfixs-user-id required' });
    const invitation = await ctx.services.createInvitation(body, { ...actor, userId: actor.userId });
    return reply.code(201).send(invitation);
  });

  app.post('/api/platform/usage', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = RecordUsageRequestSchema.parse(req.body);
    await ctx.services.recordUsage(body);
    return reply.code(202).send({ recorded: true });
  });

  app.put('/api/platform/settings', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = UpsertSettingRequestSchema.parse(req.body);
    const setting = await ctx.services.upsertSetting(body, requestContext(req));
    return setting;
  });

  app.get('/api/platform/organizations/:organizationId/events', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const { organizationId } = req.params as { organizationId: string };
    const events = await ctx.repos.events.listPending(100);
    return events.filter((event) => event.organizationId === organizationId);
  });

  app.put('/api/platform/feature-flags/:key', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const { key } = req.params as { key: string };
    const body = UpsertFeatureFlagSchema.parse({ ...(req.body as object), key });
    const now = new Date();
    await ctx.repos.featureFlags.upsert({
      key: body.key,
      description: body.description,
      defaultEnabled: body.defaultEnabled,
      rolloutPercentage: body.rolloutPercentage,
      createdAt: now,
      updatedAt: now,
    });
    return { key: body.key };
  });

  app.put('/api/platform/feature-flags/:key/organizations/:organizationId', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const { key, organizationId } = req.params as { key: string; organizationId: string };
    const body = FeatureFlagOverrideSchema.parse({ ...(req.body as object), organizationId });
    await ctx.repos.featureFlags.setOrganizationOverride(key, body.organizationId, body.enabled, new Date());
    return { key, organizationId: body.organizationId, enabled: body.enabled };
  });

  app.get('/api/platform/feature-flags/:key/organizations/:organizationId', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const { key, organizationId } = req.params as { key: string; organizationId: string };
    return { key, organizationId, enabled: await ctx.repos.featureFlags.isEnabled(key, organizationId) };
  });

  app.put('/api/platform/integrations', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = UpsertIntegrationSchema.parse(req.body);
    const actor = requestContext(req);
    const now = new Date();
    await ctx.repos.integrations.upsert({
      id: newId('int'),
      organizationId: body.organizationId,
      provider: body.provider,
      status: body.status,
      externalAccountId: body.externalAccountId ?? null,
      scopes: body.scopes,
      config: body.config,
      secretRef: body.secretRef ?? null,
      installedByUserId: actor.userId ?? null,
      installedAt: now,
      updatedAt: now,
    });
    return { installed: true };
  });

  app.put('/api/platform/subscriptions', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = UpsertSubscriptionSchema.parse(req.body);
    const now = new Date();
    await ctx.repos.subscriptions.upsert({
      id: newId('sub'),
      organizationId: body.organizationId,
      provider: body.provider,
      providerCustomerId: body.providerCustomerId ?? null,
      providerSubscriptionId: body.providerSubscriptionId ?? null,
      plan: body.plan,
      status: body.status,
      currentPeriodStart: body.currentPeriodStart ?? null,
      currentPeriodEnd: body.currentPeriodEnd ?? null,
      trialEndsAt: body.trialEndsAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return { saved: true };
  });

  app.post('/api/platform/notifications', async (req, reply) => {
    const ctx = requirePlatform(reply);
    if (!ctx) return;
    const body = QueueNotificationSchema.parse(req.body);
    const now = new Date();
    await ctx.repos.notifications.enqueue({
      id: newId('notif'),
      organizationId: body.organizationId,
      userId: body.userId ?? null,
      channel: body.channel,
      eventType: body.eventType,
      title: body.title,
      body: body.body,
      status: 'queued',
      metadata: body.metadata,
      createdAt: now,
      sentAt: null,
      readAt: null,
    });
    return reply.code(202).send({ queued: true });
  });
}

function requestContext(req: { headers: Record<string, string | string[] | undefined>; ip?: string }) {
  const header = req.headers['x-genfixs-user-id'];
  const userId = Array.isArray(header) ? header[0] : header;
  const userAgentHeader = req.headers['user-agent'];
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
  return {
    ...(userId ? { userId } : {}),
    ...(req.ip ? { ipAddress: req.ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}
