import type { AppDiff } from '../evidence.js';
import type { IssueRef, PullRequestRef, RepoRef } from '../refs.js';

export interface OpenPullRequestInput {
  repo: RepoRef;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  /** path → new content */
  files: Record<string, string>;
}

export interface CreateIssueInput {
  repo: RepoRef;
  title: string;
  body: string;
  labels: string[];
}

/**
 * Least-privilege GitHub App surface (R1, spec §10.8). This is the entire write
 * surface GenFixs has against a customer repo: branches+PRs+issues, never direct
 * pushes to protected branches, never merges outside enableAutoMerge.
 */
export interface GitHubClient {
  getFileContent(repo: RepoRef, path: string, ref: string): Promise<string | undefined>;
  compareCommits(repo: RepoRef, baseSha: string, headSha: string): Promise<AppDiff>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequestRef>;
  createIssue(input: CreateIssueInput): Promise<IssueRef>;
  /** Auto-merge respects branch protection; merges only when checks pass. */
  enableAutoMerge(pr: PullRequestRef): Promise<void>;
}
