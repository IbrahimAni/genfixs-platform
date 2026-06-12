import {
  InMemoryGitHubClient,
  InMemoryObjectStore,
  InMemoryQueue,
  randomIdGenerator,
  systemClock,
  type Clock,
  type GitHubClient,
  type IdGenerator,
  type LlmClassifier,
  type ObjectStore,
  type Queue,
} from '@genfixs/domain';
import type { BrowserRunner } from '@genfixs/domain';
import { FakeLlmClassifier } from '@genfixs/diagnosis-engine';
import { FakeRewriteModel, ScriptedBrowserRunner, type RewriteModel } from '@genfixs/fix-author';
import { IngestionService } from '@genfixs/ingestion';
import { HealthService } from './healthService.js';
import { wirePipeline } from './pipeline.js';
import { createInMemoryRepositories } from './repositories/inMemory.js';
import type { Repositories } from './repositories/interfaces.js';

export interface AppContext {
  repos: Repositories;
  queue: Queue;
  store: ObjectStore;
  github: GitHubClient;
  ingestion: IngestionService;
  health: HealthService;
  clock: Clock;
  ids: IdGenerator;
}

export interface ContextOverrides {
  repos?: Repositories;
  queue?: Queue;
  store?: ObjectStore;
  github?: GitHubClient;
  classifier?: LlmClassifier;
  rewriteModel?: RewriteModel;
  browserRunner?: BrowserRunner;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Composition root. Fakes by default — the whole system runs locally with no
 * external services; real adapters (Postgres, BullMQ, GitHub App, Playwright,
 * a real classifier) swap in here via configuration.
 */
export function createAppContext(overrides: ContextOverrides = {}): AppContext {
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? randomIdGenerator;
  const repos = overrides.repos ?? createInMemoryRepositories();
  const queue = overrides.queue ?? new InMemoryQueue();
  const store = overrides.store ?? new InMemoryObjectStore();
  const github = overrides.github ?? new InMemoryGitHubClient();

  const ingestion = new IngestionService({
    store,
    queue,
    clock,
    ids,
    saveRun: (run) => repos.runs.save(run),
    audit: async (event) => {
      await repos.audit.append({ ...event, id: ids.next('audit'), at: clock.now() });
    },
  });

  wirePipeline({
    repos,
    queue,
    github,
    classifier: overrides.classifier ?? new FakeLlmClassifier(),
    rewriteModel: overrides.rewriteModel ?? new FakeRewriteModel(),
    browserRunner: overrides.browserRunner ?? new ScriptedBrowserRunner(new Set()),
    clock,
    ids,
  });

  return {
    repos,
    queue,
    store,
    github,
    ingestion,
    health: new HealthService(repos),
    clock,
    ids,
  };
}
