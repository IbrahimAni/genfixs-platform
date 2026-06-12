import cors from '@fastify/cors';
import {
  MergePolicySchema,
  quarantineAgeDays,
} from '@genfixs/domain';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAppContext, type AppContext } from './context.js';

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

export function buildServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });

  // R1: report ingestion entry point (webhook/CLI upload).
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
    const flowTraces = await ctx.repos.flowTraces.listByTest(
      diagnosis.projectId,
      diagnosis.testId,
    );
    return { diagnosis, action: record?.action ?? null, decidedAt: record?.decidedAt ?? null, flowTraces };
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
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'internal error' });
  });

  return app;
}

const isMain = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMain) {
  const ctx = createAppContext();
  const app = buildServer(ctx);
  const port = Number(process.env['PORT'] ?? 4000);
  app
    .listen({ port, host: '0.0.0.0' })
    .then(() => console.log(`GenFixs API listening on :${port}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
