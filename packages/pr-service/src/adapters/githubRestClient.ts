import type {
  AppDiff,
  CreateIssueInput,
  FileDiff,
  GitHubClient,
  IssueRef,
  OpenPullRequestInput,
  PullRequestRef,
  RepoRef,
} from '@genfixs/domain';

/**
 * Real GitHub adapter over the REST API, authenticated as a GitHub App
 * installation (least-privilege: contents:rw, pull_requests:rw, issues:rw).
 * The fake (InMemoryGitHubClient) is the default in dev/test/demo; this
 * adapter is wired in via configuration when installation credentials exist.
 */
export class GitHubRestClient implements GitHubClient {
  constructor(
    private readonly getInstallationToken: (repo: RepoRef) => Promise<string>,
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  private async request<T>(
    repo: RepoRef,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getInstallationToken(repo);
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | undefined> {
    try {
      const data = await this.request<{ content: string; encoding: string }>(
        repo,
        'GET',
        `/repos/${repo.owner}/${repo.name}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch {
      return undefined;
    }
  }

  async compareCommits(repo: RepoRef, baseSha: string, headSha: string): Promise<AppDiff> {
    const data = await this.request<{
      files?: Array<{ filename: string; status: string; patch?: string }>;
    }>(repo, 'GET', `/repos/${repo.owner}/${repo.name}/compare/${baseSha}...${headSha}`);
    const files: FileDiff[] = (data.files ?? []).map((f) => ({
      path: f.filename,
      status:
        f.status === 'added'
          ? 'added'
          : f.status === 'removed'
            ? 'removed'
            : f.status === 'renamed'
              ? 'renamed'
              : 'modified',
      ...(f.patch !== undefined ? { patch: f.patch } : {}),
    }));
    return { baseSha, headSha, files };
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    const { repo } = input;
    const base = `/repos/${repo.owner}/${repo.name}`;

    const baseRef = await this.request<{ object: { sha: string } }>(
      repo,
      'GET',
      `${base}/git/ref/heads/${input.baseBranch}`,
    );
    await this.request(repo, 'POST', `${base}/git/refs`, {
      ref: `refs/heads/${input.branch}`,
      sha: baseRef.object.sha,
    });

    for (const [path, content] of Object.entries(input.files)) {
      const existing = await this.request<{ sha?: string }>(
        repo,
        'GET',
        `${base}/contents/${path}?ref=${encodeURIComponent(input.branch)}`,
      ).catch(() => ({ sha: undefined }));
      await this.request(repo, 'PUT', `${base}/contents/${path}`, {
        message: `${input.title}\n\n[genfixs]`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: input.branch,
        ...(existing.sha ? { sha: existing.sha } : {}),
      });
    }

    const pr = await this.request<{ number: number; html_url: string }>(
      repo,
      'POST',
      `${base}/pulls`,
      { title: input.title, body: input.body, head: input.branch, base: input.baseBranch },
    );
    return { repo, number: pr.number, url: pr.html_url, branch: input.branch };
  }

  async createIssue(input: CreateIssueInput): Promise<IssueRef> {
    const { repo } = input;
    const issue = await this.request<{ number: number; html_url: string }>(
      repo,
      'POST',
      `/repos/${repo.owner}/${repo.name}/issues`,
      { title: input.title, body: input.body, labels: input.labels },
    );
    return { repo, number: issue.number, url: issue.html_url };
  }

  async enableAutoMerge(pr: PullRequestRef): Promise<void> {
    // Auto-merge via GraphQL (REST has no endpoint); honors branch protection.
    const token = await this.getInstallationToken(pr.repo);
    const idRes = await this.request<{ node_id: string }>(
      pr.repo,
      'GET',
      `/repos/${pr.repo.owner}/${pr.repo.name}/pulls/${pr.number}`,
    );
    const res = await fetch(`${this.baseUrl.replace('api.', 'api.')}/graphql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { clientMutationId } }`,
        variables: { id: idRes.node_id },
      }),
    });
    if (!res.ok) throw new Error(`enableAutoMerge failed: ${res.status}`);
  }
}
