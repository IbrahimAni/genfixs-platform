import type { AppDiff } from '../evidence.js';
import type { IssueRef, PullRequestRef, RepoRef } from '../refs.js';
import type {
  CreateIssueInput,
  GitHubClient,
  OpenPullRequestInput,
} from '../ports/githubClient.js';

export interface FakePullRequest {
  ref: PullRequestRef;
  input: OpenPullRequestInput;
  autoMergeEnabled: boolean;
}

export interface FakeIssue {
  ref: IssueRef;
  input: CreateIssueInput;
}

export class InMemoryGitHubClient implements GitHubClient {
  readonly pullRequests: FakePullRequest[] = [];
  readonly issues: FakeIssue[] = [];
  /** `${owner}/${name}@${ref}:${path}` → content */
  readonly fileContents = new Map<string, string>();
  /** `${baseSha}..${headSha}` → diff */
  readonly diffs = new Map<string, AppDiff>();
  private prCounter = 1;
  private issueCounter = 1;

  seedFile(repo: RepoRef, path: string, ref: string, content: string): void {
    this.fileContents.set(`${repo.owner}/${repo.name}@${ref}:${path}`, content);
  }

  seedDiff(baseSha: string, headSha: string, diff: AppDiff): void {
    this.diffs.set(`${baseSha}..${headSha}`, diff);
  }

  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | undefined> {
    return this.fileContents.get(`${repo.owner}/${repo.name}@${ref}:${path}`);
  }

  async compareCommits(_repo: RepoRef, baseSha: string, headSha: string): Promise<AppDiff> {
    return this.diffs.get(`${baseSha}..${headSha}`) ?? { baseSha, headSha, files: [] };
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef> {
    const number = this.prCounter++;
    const ref: PullRequestRef = {
      repo: input.repo,
      number,
      url: `https://github.com/${input.repo.owner}/${input.repo.name}/pull/${number}`,
      branch: input.branch,
    };
    this.pullRequests.push({ ref, input, autoMergeEnabled: false });
    return ref;
  }

  async createIssue(input: CreateIssueInput): Promise<IssueRef> {
    const number = this.issueCounter++;
    const ref: IssueRef = {
      repo: input.repo,
      number,
      url: `https://github.com/${input.repo.owner}/${input.repo.name}/issues/${number}`,
    };
    this.issues.push({ ref, input });
    return ref;
  }

  async enableAutoMerge(pr: PullRequestRef): Promise<void> {
    const found = this.pullRequests.find(
      (p) => p.ref.number === pr.number && p.ref.repo.name === pr.repo.name,
    );
    if (!found) throw new Error(`No such PR #${pr.number}`);
    found.autoMergeEnabled = true;
  }
}
