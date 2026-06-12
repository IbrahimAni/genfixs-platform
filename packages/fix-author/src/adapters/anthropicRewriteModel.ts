import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Diagnosis, Project } from '@genfixs/domain';
import { z } from 'zod/v4';
import type { RewriteDraft, RewriteModel } from '../rewriteModel.js';

const RewriteOutputSchema = z.object({
  newTestSource: z.string(),
  summary: z.string(),
});

export const REWRITE_SYSTEM_PROMPT = `You are the fix author of GenFixs, an autonomous test-maintenance product. The app's behavior changed intentionally and an existing Playwright test asserts the OLD behavior. Draft the updated test that exercises the NEW flow.

Hard rules:
- Preserve the test's protected intent: it must still verify the same user-facing outcome, extended to the new flow. Never weaken or remove assertions to make the test pass — if the app's output looks WRONG rather than changed, refuse by returning the original source unchanged and saying so in the summary.
- Match the repo's existing style exactly: same locator strategy, helper usage, naming, quoting, indentation. The diff should read like the original author wrote it.
- Minimal change: touch only what the new flow requires.
- Your output is a DRAFT. It will be verified in a sandbox and a human must approve it; write the summary for that human (what changed in the app, what you changed in the test, in plain language).

Return the complete new file content in newTestSource.`;

export interface AnthropicRewriteOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Real rewrite author over the Claude API (spec §10.6; §12: large models are
 * reserved for authoring). Output must still verify green in the sandbox and
 * pass human review before merging — the model drafts; it never decides.
 *
 * Credential: ANTHROPIC_API_KEY (see CREDENTIALS.md).
 */
export class AnthropicRewriteModel implements RewriteModel {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicRewriteOptions = {}) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.model = options.model ?? process.env['GENFIXS_AUTHOR_MODEL'] ?? 'claude-opus-4-8';
  }

  async draftRewrite(_project: Project, diagnosis: Diagnosis): Promise<RewriteDraft> {
    const { evidence } = diagnosis;
    const diff = evidence.appDiff
      ? evidence.appDiff.files
          .map((f) => `--- ${f.path} (${f.status}) ---\n${f.patch ?? ''}`)
          .join('\n')
      : '(no diff available)';

    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      system: REWRITE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Current test source
\`\`\`ts
${evidence.testSource}
\`\`\`

## Why it fails
${evidence.failure.errorMessage}

## Diagnosis rationale
${diagnosis.rationale}

## App change (last green -> failing commit)
${diff}`,
        },
      ],
      output_config: { format: zodOutputFormat(RewriteOutputSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      // Refusal or schema failure: return the original unchanged; verification
      // will fail and the orchestrator will quarantine instead of surfacing.
      return {
        newTestSource: evidence.testSource,
        summary: `Rewrite model returned no parseable output (stop_reason: ${response.stop_reason}); no draft produced.`,
      };
    }
    return parsed;
  }
}
