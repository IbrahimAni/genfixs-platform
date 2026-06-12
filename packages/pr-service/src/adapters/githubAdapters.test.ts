import { createServer, type Server } from 'node:http';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { RepoRef } from '@genfixs/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitHubRestClient } from './githubRestClient.js';
import { GitHubAppTokenProvider, signAppJwt, type GitHubAppConfig } from './githubAppAuth.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const config: GitHubAppConfig = {
  appId: '12345',
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  installations: { '*': '777' },
};

const repo: RepoRef = {
  provider: 'github',
  owner: 'acme',
  name: 'shop-e2e',
  defaultBranch: 'main',
};

describe('GitHub App JWT', () => {
  it('produces a verifiable RS256 JWT with app id as issuer and <10min validity', () => {
    const jwt = signAppJwt(config, 1_750_000_000);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('GitHubAppTokenProvider', () => {
  it('exchanges the JWT for an installation token and caches it until expiry', async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async (url, init) => {
      calls++;
      expect(String(url)).toContain('/app/installations/777/access_tokens');
      const auth = (init?.headers as Record<string, string>)['authorization'];
      expect(auth).toMatch(/^Bearer ey/);
      return new Response(
        JSON.stringify({
          token: 'ghs_installation_token',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 201 },
      );
    };
    const provider = new GitHubAppTokenProvider(config, fakeFetch);
    expect(await provider.getInstallationToken(repo)).toBe('ghs_installation_token');
    expect(await provider.getInstallationToken(repo)).toBe('ghs_installation_token');
    expect(calls).toBe(1); // cached
  });
});

/**
 * Integration test of the real REST adapter against a local stub of the
 * GitHub API: verifies auth headers, request shapes, and response mapping —
 * everything except GitHub itself, which needs credentials (CREDENTIALS.md).
 */
describe('GitHubRestClient against a local GitHub API stub', () => {
  let server: Server;
  let baseUrl: string;
  const seen: Array<{ method: string; url: string; body?: unknown }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        seen.push({ method: req.method!, url: req.url!, body });
        if (req.headers.authorization !== 'Bearer test-token') {
          res.writeHead(401).end(JSON.stringify({ message: 'bad credentials' }));
          return;
        }
        const respond = (status: number, data: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        const url = req.url!;
        if (url.includes('/contents/tests/checkout.spec.ts'))
          return respond(200, {
            content: Buffer.from('// test source').toString('base64'),
            encoding: 'base64',
          });
        if (url.includes('/compare/'))
          return respond(200, {
            files: [{ filename: 'src/Checkout.tsx', status: 'modified', patch: '-a\n+b' }],
          });
        if (url.includes('/git/ref/heads/main'))
          return respond(200, { object: { sha: 'basesha' } });
        if (url.endsWith('/git/refs')) return respond(201, { ref: 'refs/heads/x' });
        if (url.includes('/contents/') && req.method === 'GET')
          return respond(404, { message: 'not found' });
        if (url.includes('/contents/') && req.method === 'PUT')
          return respond(201, { content: { sha: 'newsha' } });
        if (url.endsWith('/pulls') && req.method === 'POST')
          return respond(201, { number: 42, html_url: 'https://github.com/acme/shop-e2e/pull/42' });
        if (url.endsWith('/issues') && req.method === 'POST')
          return respond(201, { number: 9, html_url: 'https://github.com/acme/shop-e2e/issues/9' });
        respond(404, { message: `unstubbed: ${req.method} ${url}` });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  function client() {
    return new GitHubRestClient(async () => 'test-token', baseUrl);
  }

  it('reads file content', async () => {
    expect(await client().getFileContent(repo, 'tests/checkout.spec.ts', 'head1')).toBe(
      '// test source',
    );
  });

  it('maps compare responses into AppDiff', async () => {
    const diff = await client().compareCommits(repo, 'green1', 'head1');
    expect(diff.files).toEqual([{ path: 'src/Checkout.tsx', status: 'modified', patch: '-a\n+b' }]);
  });

  it('opens a PR via branch + contents + pulls', async () => {
    const pr = await client().openPullRequest({
      repo,
      branch: 'genfixs/heal/test1',
      baseBranch: 'main',
      title: 'fix(test): heal',
      body: 'body',
      files: { 'tests/checkout.spec.ts': '// healed' },
    });
    expect(pr.number).toBe(42);
    const createRef = seen.find((s) => s.url.endsWith('/git/refs'));
    expect(createRef?.body).toMatchObject({ ref: 'refs/heads/genfixs/heal/test1', sha: 'basesha' });
    const createPr = seen.find((s) => s.url.endsWith('/pulls'));
    expect(createPr?.body).toMatchObject({ head: 'genfixs/heal/test1', base: 'main' });
  });

  it('creates issues', async () => {
    const issue = await client().createIssue({
      repo,
      title: 'Suspected regression',
      body: 'details',
      labels: ['genfixs'],
    });
    expect(issue.number).toBe(9);
  });
});
