import { createSign } from 'node:crypto';
import type { RepoRef } from '@genfixs/domain';

/**
 * GitHub App installation-token minting (R1: least-privilege GitHub App).
 *
 * Flow: sign a short-lived RS256 JWT with the App's private key, then exchange
 * it for an installation access token scoped to the customer's installation.
 * Tokens are cached until shortly before expiry.
 *
 * Credentials (see CREDENTIALS.md):
 *   GITHUB_APP_ID            — the App's numeric ID
 *   GITHUB_APP_PRIVATE_KEY   — PEM private key (literal or base64-encoded)
 *   GITHUB_APP_INSTALLATION_ID — installation id for the customer org (v1: single tenant)
 */
export interface GitHubAppConfig {
  appId: string;
  privateKeyPem: string;
  /** owner (org/user) → installation id; '*' as default. */
  installations: Record<string, string>;
  baseUrl?: string;
}

export function githubAppConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig | undefined {
  const appId = env['GITHUB_APP_ID'];
  let key = env['GITHUB_APP_PRIVATE_KEY'];
  const installationId = env['GITHUB_APP_INSTALLATION_ID'];
  if (!appId || !key || !installationId) return undefined;
  if (!key.includes('BEGIN')) key = Buffer.from(key, 'base64').toString('utf8');
  return { appId, privateKeyPem: key, installations: { '*': installationId } };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signAppJwt(config: GitHubAppConfig, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // iat backdated 60s for clock drift; max validity GitHub allows is 10 minutes.
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: config.appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(config.privateKeyPem).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class GitHubAppTokenProvider {
  private readonly cache = new Map<string, CachedToken>();

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  installationIdFor(repo: RepoRef): string {
    const id = this.config.installations[repo.owner] ?? this.config.installations['*'];
    if (!id) throw new Error(`No GitHub App installation configured for ${repo.owner}`);
    return id;
  }

  async getInstallationToken(repo: RepoRef): Promise<string> {
    const installationId = this.installationIdFor(repo);
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt - 120_000 > Date.now()) return cached.token;

    const base = this.config.baseUrl ?? 'https://api.github.com';
    const res = await this.fetchImpl(`${base}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${signAppJwt(this.config)}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw new Error(`Installation token request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { token: string; expires_at: string };
    this.cache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });
    return data.token;
  }
}
