import type { AuthoredFix, Diagnosis, Project } from '@genfixs/domain';
import { assertLocatorOnlyEdit } from './assertionGuard.js';
import { applySelectorHeal } from './healAuthor.js';
import type { RewriteModel } from './rewriteModel.js';

export interface FixAuthorDeps {
  rewriteModel: RewriteModel;
  /** Repo formatting config (e.g. .prettierrc contents), when the repo has one (R8). */
  getFormatConfig?(project: Project): Promise<string | undefined>;
}

/**
 * Drafts heals and rewrites (spec §10.6). Heals pass the structural
 * assertion guard or are rejected outright; the orchestrator turns rejections
 * into quarantines, never PRs.
 */
export class FixAuthor {
  constructor(private readonly deps: FixAuthorDeps) {}

  async authorHeal(
    project: Project,
    diagnosis: Diagnosis,
  ): Promise<{ fix: AuthoredFix } | { rejected: string }> {
    if (diagnosis.classification !== 'BENIGN_DRIFT') {
      // Belt and braces: the orchestrator only routes BENIGN_DRIFT here, but
      // the author independently refuses to "heal" anything else.
      return { rejected: `Refusing to heal a ${diagnosis.classification} diagnosis` };
    }
    const rename = diagnosis.suggestedSelectorFix;
    if (!rename) {
      return { rejected: 'No selector fix was identified; nothing safe to author' };
    }

    const source = diagnosis.evidence.testSource;
    const edit = applySelectorHeal(source, rename);
    if ('rejected' in edit) return edit;

    const guard = assertLocatorOnlyEdit(source, edit.content, rename);
    if (!guard.ok) return { rejected: guard.reason };

    const testFile = extractTestFile(diagnosis);
    return {
      fix: {
        kind: 'heal',
        testFile,
        testTitle: extractTestTitle(diagnosis),
        files: { [testFile]: edit.content },
        summary: `Locator drift: \`${rename.oldSelector}\` was renamed to \`${rename.newSelector}\` in the app. Updated ${edit.replacements} reference(s) in the test. Assertions and flow are untouched.`,
      },
    };
  }

  async authorRewrite(project: Project, diagnosis: Diagnosis): Promise<{ fix: AuthoredFix }> {
    const draft = await this.deps.rewriteModel.draftRewrite(project, diagnosis);
    const testFile = extractTestFile(diagnosis);
    const formatted = await this.applyRepoFormatting(project, draft.newTestSource);

    return {
      fix: {
        kind: 'rewrite',
        testFile,
        testTitle: extractTestTitle(diagnosis),
        files: { [testFile]: formatted },
        summary: draft.summary,
        evidenceSummary: summarizeAppChange(diagnosis),
      },
    };
  }

  private async applyRepoFormatting(project: Project, content: string): Promise<string> {
    const config = await this.deps.getFormatConfig?.(project);
    if (!config) return content;
    try {
      const prettier = await import('prettier');
      return await prettier.format(content, {
        ...(JSON.parse(config) as Record<string, unknown>),
        parser: 'typescript',
      });
    } catch {
      // Formatting is best-effort; an unformattable draft still goes to review.
      return content;
    }
  }
}

function extractTestFile(diagnosis: Diagnosis): string {
  const fromStack = diagnosis.evidence.failure.stackTrace.match(/([\w./-]+\.spec\.[tj]s)/);
  return fromStack?.[1] ?? `tests/${diagnosis.testId}.spec.ts`;
}

function extractTestTitle(diagnosis: Diagnosis): string {
  const fromSource = diagnosis.evidence.testSource.match(/test\(\s*['"`]([^'"`]+)['"`]/);
  return fromSource?.[1] ?? diagnosis.testId;
}

/** Diff-level evidence for the approving human (R4): what changed, where. */
export function summarizeAppChange(diagnosis: Diagnosis): string {
  const diff = diagnosis.evidence.appDiff;
  if (!diff) return 'No app diff available.';
  const fileLines = diff.files
    .map((f) => `- \`${f.path}\` (${f.status})${f.patch ? `\n\n\`\`\`diff\n${f.patch}\n\`\`\`` : ''}`)
    .join('\n');
  return `App change between \`${diff.baseSha}\` and \`${diff.headSha}\`:\n\n${fileLines}`;
}
