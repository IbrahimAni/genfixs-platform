import { AnthropicLlmClassifier } from '@genfixs/diagnosis-engine';
import { AnthropicRewriteModel, PlaywrightBrowserRunner } from '@genfixs/fix-author';
import {
  GitHubAppTokenProvider,
  GitHubRestClient,
  githubAppConfigFromEnv,
} from '@genfixs/pr-service';
import { createAppContext, type AppContext, type ContextOverrides } from './context.js';
import { BullMqQueue } from './adapters/bullmqQueue.js';
import { FsObjectStore, S3ObjectStore } from './adapters/objectStores.js';
import { createPostgresRepositories } from './repositories/postgres.js';

export interface IntegrationStatus {
  name: string;
  mode: string;
  live: boolean;
  /** What to provide to go live; empty when already live. */
  requires: string[];
  note?: string;
}

export interface RuntimeReport {
  startedAt: string;
  integrations: IntegrationStatus[];
}

/**
 * Production composition root: every integration goes live when its
 * credentials/config exist, and degrades to a clearly-reported local mode
 * when they don't ("note it down, do something about it, continue").
 * The full credential reference lives in CREDENTIALS.md; the same report is
 * served at GET /api/status.
 */
export async function createAppContextFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ctx: AppContext; report: RuntimeReport }> {
  const integrations: IntegrationStatus[] = [];
  const overrides: ContextOverrides = {};

  // --- Persistence ---
  if (env['DATABASE_URL']) {
    overrides.repos = await createPostgresRepositories(env['DATABASE_URL']);
    integrations.push({ name: 'database', mode: 'postgres', live: true, requires: [] });
  } else {
    integrations.push({
      name: 'database',
      mode: 'in-memory (volatile)',
      live: false,
      requires: ['DATABASE_URL'],
      note: 'All state is lost on restart until Postgres is configured.',
    });
  }

  // --- Queue ---
  if (env['REDIS_URL']) {
    overrides.queue = BullMqQueue.fromUrl(env['REDIS_URL']);
    integrations.push({ name: 'queue', mode: 'bullmq/redis', live: true, requires: [] });
  } else {
    integrations.push({
      name: 'queue',
      mode: 'in-memory (single process)',
      live: false,
      requires: ['REDIS_URL'],
      note: 'Jobs run in-process without retries or horizontal scaling.',
    });
  }

  // --- Artifact store ---
  if (env['S3_BUCKET']) {
    overrides.store = new S3ObjectStore({
      bucket: env['S3_BUCKET'],
      ...(env['AWS_REGION'] ? { region: env['AWS_REGION'] } : {}),
      ...(env['S3_ENDPOINT'] ? { endpoint: env['S3_ENDPOINT'], forcePathStyle: true } : {}),
    });
    integrations.push({ name: 'artifact-store', mode: 's3', live: true, requires: [] });
  } else {
    const dir = env['GENFIXS_DATA_DIR'] ?? './data/artifacts';
    overrides.store = new FsObjectStore(dir);
    integrations.push({
      name: 'artifact-store',
      mode: `filesystem (${dir})`,
      live: true,
      requires: ['S3_BUCKET + AWS credentials (optional, for S3-compatible storage)'],
      note: 'Filesystem persistence is real but single-node; use S3 for production.',
    });
  }

  // --- GitHub ---
  const githubApp = githubAppConfigFromEnv(env);
  if (githubApp) {
    const tokens = new GitHubAppTokenProvider(githubApp);
    overrides.github = new GitHubRestClient((repo) => tokens.getInstallationToken(repo));
    integrations.push({ name: 'github', mode: 'github-app', live: true, requires: [] });
  } else {
    integrations.push({
      name: 'github',
      mode: 'in-memory fake (no PRs/issues reach GitHub)',
      live: false,
      requires: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID'],
      note: 'Register a GitHub App (contents:rw, pull_requests:rw, issues:rw) and install it on the customer org. See CREDENTIALS.md.',
    });
  }

  // --- LLM classifier + rewrite author ---
  if (env['ANTHROPIC_API_KEY']) {
    overrides.classifier = new AnthropicLlmClassifier();
    overrides.rewriteModel = new AnthropicRewriteModel();
    integrations.push({
      name: 'llm',
      mode: `anthropic (${env['GENFIXS_CLASSIFIER_MODEL'] ?? 'claude-opus-4-8'})`,
      live: true,
      requires: [],
    });
  } else {
    integrations.push({
      name: 'llm',
      mode: 'deterministic rule-based classifier/author',
      live: false,
      requires: ['ANTHROPIC_API_KEY'],
      note: 'Classification quality is rule-based until a real model is configured.',
    });
  }

  // --- Verification browser ---
  if (env['GENFIXS_VERIFICATION'] === 'playwright') {
    overrides.browserRunner = new PlaywrightBrowserRunner();
    integrations.push({
      name: 'verification',
      mode: 'playwright (real browser)',
      live: true,
      requires: [],
    });
  } else {
    integrations.push({
      name: 'verification',
      mode: 'scripted (no real browser runs)',
      live: false,
      requires: [
        'GENFIXS_VERIFICATION=playwright',
        '@playwright/test + browsers on the worker image',
      ],
      note: 'Heals will not surface for projects without a verification path.',
    });
  }

  // --- API auth ---
  if (env['GENFIXS_API_TOKEN']) {
    integrations.push({ name: 'auth', mode: 'bearer token', live: true, requires: [] });
  } else {
    integrations.push({
      name: 'auth',
      mode: 'OPEN (no authentication)',
      live: false,
      requires: ['GENFIXS_API_TOKEN'],
      note: 'Set a token before exposing the API beyond localhost.',
    });
  }

  const ctx = createAppContext(overrides);
  return {
    ctx,
    report: { startedAt: new Date().toISOString(), integrations },
  };
}
