import { PlatformService } from './services.js';
import { createPlatformPostgresRepositories } from './postgres.js';
import type { PlatformRepositories } from './repositories.js';

export interface PlatformContext {
  repos: PlatformRepositories;
  services: PlatformService;
  close(): Promise<void>;
}

export async function createPlatformContext(connectionString: string): Promise<PlatformContext> {
  const repos = await createPlatformPostgresRepositories(connectionString);
  return {
    repos,
    services: new PlatformService(repos),
    close: () => repos.close(),
  };
}
