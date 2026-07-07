import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { MergePolicySchema, ProjectSchema, quarantineAgeDays } from '@genfixs/domain';
import { AuthorizationError, type PlatformContext } from '@genfixs/platform';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createAppContextFromEnv, type RuntimeReport } from './config.js';
import type { AppContext } from './context.js';
import { registerPlatformRoutes } from './platformRoutes.js';

const IngestBodySchema = z.object({
  commitSha: z.string(),
  lastGreenSha: z.string().optional(),
  format: z.enum(['playwright-json', 'junit-xml']),
  raw: z.string(),
});

const SettingsBodySchema = z.object({
  policies: MergePolicySchema.optional(),
  verificationBaseUrl: z.string().optional(),
});

const CreateProjectSchema = z.object({
  name: z.string().min(1),
  org: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  testRepo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    defaultBranch: z.string().default('main'),
  }),
  appRepo: z
    .object({
      owner: z.string().min(1),
      name: z.string().min(1),
      defaultBranch: z.string().default('main'),
    })
    .optional(),
  ciProvider: z.enum(['github-actions', 'gitlab-ci', 'other']).default('github-actions'),
  framework: z.enum(['playwright', 'cypress']).default('playwright'),
  verificationBaseUrl: z.string().optional(),
});

export interface ServerOptions {
  report?: RuntimeReport;
  apiToken?: string;
  webhookSecret?: string;
  platform?: PlatformContext;
}

export function buildServer(ctx: AppContext, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });

  // Serve the built dashboard when present (single-container deployment):
  // API and UI share one origin, so no proxy is needed.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  // Keep the raw body around for webhook HMAC verification.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch (err) {
      done(err as Error);
    }
  });

  // Bearer-token auth when configured. /api/status stays open (it reports
  // exactly this kind of configuration state); the webhook authenticates via HMAC.
  app.addHook('onRequest', async (req, reply) => {
    if (!options.apiToken) return;
    if (req.url === '/api/status' || req.url.startsWith('/api/webhooks/')) return;
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization;
    if (header !== `Bearer ${options.apiToken}`) {
      return reply.code(401).send({ error: 'missing or invalid API token' });
    }
  });

  /** Which integrations are live vs awaiting credentials (see CREDENTIALS.md). */
  app.get('/api/status', async () => {
    return options.report ?? { startedAt: new Date().toISOString(), integrations: [] };
  });

  void registerPlatformRoutes(app, options.platform);

  // Onboarding: connect a project (R1).
  app.post('/api/projects', async (req, reply) => {
    const body = CreateProjectSchema.parse(req.body);
    const project = ProjectSchema.parse({
      id: ctx.ids.next('proj'),
      name: body.name,
      org: body.org,
      testRepo: { provider: 'github', ...body.testRepo },
      ...(body.appRepo ? { appRepo: { provider: 'github', ...body.appRepo } } : {}),
      ciProvider: body.ciProvider,
      framework: body.framework,
      policies: MergePolicySchema.parse({}),
      ...(body.verificationBaseUrl ? { verificationBaseUrl: body.verificationBaseUrl } : {}),
      createdAt: ctx.clock.now(),
    });
    await ctx.repos.projects.save(project);
    await ctx.repos.audit.append({
      id: ctx.ids.next('audit'),
      projectId: project.id,
      at: ctx.clock.now(),
      actor: 'human',
      type: 'project.created',
      detail: { testRepo: `${project.testRepo.owner}/${project.testRepo.name}` },
    });
    return reply.code(201).send(project);
  });

  // R1: report ingestion entry point (CI uploader step or manual upload).
  app.post('/api/projects/:projectId/ingest', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await ctx.repos.projects.get(projectId);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    const body = IngestBodySchema.parse(req.body);
    const run = await ctx.ingestion.ingest({
      projectId,
      commitSha: body.commitSha,
      format: body.format,
      raw: body.raw,
      ...(body.lastGreenSha ? { lastGreenSha: body.lastGreenSha } : {}),
    });
    return reply.code(202).send({ runId: run.id, results: run.results.length });
  });

  /**
   * GitHub webhook receiver (HMAC-verified). State transitions are audited;
   * report delivery itself comes through the CI uploader (spec §10.1's
   * "lightweight CLI step"), which carries the full Playwright JSON report —
   * workflow_run artifacts don't, without an extra artifact-download round trip.
   */
  app.post('/api/webhooks/github', async (req, reply) => {
    if (!options.webhookSecret) {
      return reply
        .code(503)
        .send({ error: 'webhook secret not configured (GITHUB_WEBHOOK_SECRET)' });
    }
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
    const expected = `sha256=${createHmac('sha256', options.webhookSecret).update(rawBody).digest('hex')}`;
    if (
      typeof signature !== 'string' ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    const event = req.headers['x-github-event'];
    const payload = req.body as { action?: string; repository?: { full_name?: string } };
    const projects = await ctx.repos.projects.list();
    const project = projects.find(
      (p) => `${p.testRepo.owner}/${p.testRepo.name}` === payload.repository?.full_name,
    );
    if (project) {
      await ctx.repos.audit.append({
        id: ctx.ids.next('audit'),
        projectId: project.id,
        at: ctx.clock.now(),
        actor: 'system',
        type: 'webhook.received',
        detail: { event, action: payload.action ?? null },
      });
    }
    return reply.code(202).send({ received: true });
  });

  app.get('/api/projects', async () => {
    const projects = await ctx.repos.projects.list();
    return Promise.all(
      projects.map(async (p) => ({
        ...p,
        snapshot: await ctx.health.snapshot(p.id, ctx.clock.now()),
      })),
    );
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await ctx.repos.projects.get(id);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    return {
      ...project,
      snapshot: await ctx.health.snapshot(id, ctx.clock.now()),
      trend: await ctx.health.trend(id),
    };
  });

  app.get('/api/projects/:id/failures', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await ctx.repos.projects.get(id);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    const diagnoses = await ctx.repos.diagnoses.listByProject(id);
    const withActions = await Promise.all(
      diagnoses.map(async (d) => ({
        id: d.id,
        testId: d.testId,
        runId: d.runId,
        classification: d.classification,
        confidence: d.confidence,
        source: d.source,
        rationale: d.rationale,
        degradedFrom: d.degradedFrom ?? null,
        errorMessage: d.evidence.failure.errorMessage,
        createdAt: d.createdAt,
        action: (await ctx.repos.actions.getByDiagnosis(d.id))?.action ?? null,
      })),
    );
    return withActions.reverse();
  });

  app.get('/api/diagnoses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const diagnosis = await ctx.repos.diagnoses.get(id);
    if (!diagnosis) return reply.code(404).send({ error: 'unknown diagnosis' });
    const record = await ctx.repos.actions.getByDiagnosis(id);
    const flowTraces = await ctx.repos.flowTraces.listByTest(diagnosis.projectId, diagnosis.testId);
    return {
      diagnosis,
      action: record?.action ?? null,
      decidedAt: record?.decidedAt ?? null,
      flowTraces,
    };
  });

  app.get('/api/projects/:id/quarantine', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await ctx.repos.projects.get(id);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    const records = await ctx.repos.quarantine.listByProject(id);
    const now = ctx.clock.now();
    return records.map((record) => ({ ...record, ageDays: quarantineAgeDays(record, now) }));
  });

  // R6/R7: release is the human-driven exit; deletion has no endpoint at all.
  app.post('/api/quarantine/:id/release', async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await ctx.repos.quarantine.get(id);
    if (!record) return reply.code(404).send({ error: 'unknown quarantine record' });
    await ctx.repos.quarantine.release(id, ctx.clock.now());
    await ctx.repos.audit.append({
      id: ctx.ids.next('audit'),
      projectId: record.projectId,
      at: ctx.clock.now(),
      actor: 'human',
      type: 'quarantine.released',
      testId: record.testId,
      detail: { quarantineId: id },
    });
    return { released: true };
  });

  app.get('/api/projects/:id/settings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await ctx.repos.projects.get(id);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    return {
      testRepo: project.testRepo,
      appRepo: project.appRepo ?? null,
      ciProvider: project.ciProvider,
      framework: project.framework,
      policies: project.policies,
      verificationBaseUrl: project.verificationBaseUrl ?? null,
    };
  });

  app.put('/api/projects/:id/settings', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await ctx.repos.projects.get(id);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    // MergePolicySchema enforces deletionRequiresSignoff: true at parse time —
    // there is no payload that turns the deletion gate off.
    const body = SettingsBodySchema.parse(req.body);
    const updated = {
      ...project,
      ...(body.policies ? { policies: body.policies } : {}),
      ...(body.verificationBaseUrl !== undefined
        ? { verificationBaseUrl: body.verificationBaseUrl }
        : {}),
    };
    await ctx.repos.projects.save(updated);
    return { policies: updated.policies, verificationBaseUrl: updated.verificationBaseUrl ?? null };
  });

  app.get('/api/projects/:id/audit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await ctx.repos.projects.get(id);
    if (!project) return reply.code(404).send({ error: 'unknown project' });
    return ctx.repos.audit.listByProject(id);
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    }
    if (err instanceof AuthorizationError) {
      return reply.code(403).send({ error: 'forbidden', detail: err.message });
    }
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'internal error' });
  });

  return app;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  const { ctx, report } = await createAppContextFromEnv();
  const platform =
    process.env['DATABASE_URL'] !== undefined
      ? await import('@genfixs/platform').then((m) =>
          m.createPlatformContext(process.env['DATABASE_URL']!),
        )
      : undefined;
  const app = buildServer(ctx, {
    report,
    ...(platform ? { platform } : {}),
    ...(process.env['GENFIXS_API_TOKEN'] ? { apiToken: process.env['GENFIXS_API_TOKEN'] } : {}),
    ...(process.env['GITHUB_WEBHOOK_SECRET']
      ? { webhookSecret: process.env['GITHUB_WEBHOOK_SECRET'] }
      : {}),
  });
  const port = Number(process.env['PORT'] ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`GenFixs API listening on :${port}`);
  for (const integration of report.integrations) {
    const status = integration.live ? 'LIVE' : 'DEGRADED';
    console.log(
      `  [${status}] ${integration.name}: ${integration.mode}` +
        (integration.requires.length > 0 ? ` (needs: ${integration.requires.join(', ')})` : ''),
    );
  }
}
