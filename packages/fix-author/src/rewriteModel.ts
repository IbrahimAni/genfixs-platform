import type { Diagnosis, Project } from '@genfixs/domain';
import { splitPatch } from '@genfixs/evidence-builder';

export interface RewriteDraft {
  newTestSource: string;
  summary: string;
}

/**
 * The creative half of fix authoring (BEHAVIOR_CHANGE rewrites) sits behind a
 * port: a real LLM adapter in production, a deterministic fake locally. Its
 * output is a DRAFT — it must verify green in the sandbox and a human must
 * approve the PR before anything merges (R4).
 */
export interface RewriteModel {
  draftRewrite(project: Project, diagnosis: Diagnosis): Promise<RewriteDraft>;
}

/**
 * Deterministic fake (DECISIONS.md D7): extends the test with steps for UI
 * elements the app diff introduced. Crude next to a real model, but it
 * exercises the full author → verify → PR-for-approval path honestly.
 */
export class FakeRewriteModel implements RewriteModel {
  async draftRewrite(_project: Project, diagnosis: Diagnosis): Promise<RewriteDraft> {
    const { evidence } = diagnosis;
    const newTestIds: string[] = [];
    for (const file of evidence.appDiff?.files ?? []) {
      if (!file.patch) continue;
      const { added } = splitPatch(file.patch);
      for (const line of added) {
        for (const match of line.matchAll(/data-testid=["']([^"']+)["']/g)) {
          const id = match[1]!;
          if (!evidence.testSource.includes(id) && !newTestIds.includes(id)) newTestIds.push(id);
        }
      }
    }

    const newSteps = newTestIds
      .map((id) => `  await page.getByTestId('${id}').click();`)
      .join('\n');

    const lines = evidence.testSource.split('\n');
    // Insert the new flow steps before the first assertion, mirroring where
    // the extended flow sits in the app.
    const firstExpect = lines.findIndex((l) => l.includes('expect('));
    const insertAt = firstExpect === -1 ? lines.length - 1 : firstExpect;
    const updated = [...lines.slice(0, insertAt), newSteps, ...lines.slice(insertAt)]
      .filter((l) => l !== '')
      .join('\n');

    return {
      newTestSource: newTestIds.length > 0 ? updated : evidence.testSource,
      summary:
        newTestIds.length > 0
          ? `The app flow gained new step(s): ${newTestIds.join(', ')}. The test was updated to walk the extended flow before its assertions.`
          : 'The flow changed; the proposed test mirrors the new behavior.',
    };
  }
}
