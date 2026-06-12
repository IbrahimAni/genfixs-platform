import type { SelectorRename } from './healAuthor.js';

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * The structural guard behind R3's "assertions are untouched" acceptance and
 * DECISIONS.md D10. A heal is admissible only if the edit is EXACTLY the
 * claimed selector rename: same line count, and substituting the new selector
 * back to the old one must reproduce the original file byte-for-byte.
 *
 * This is enforcement, not review: a buggy or compromised author that slips
 * any other change — an assertion value, a flow step, a deleted line — fails
 * the reverse-substitution check and the heal is rejected before verification.
 */
export function assertLocatorOnlyEdit(
  original: string,
  edited: string,
  rename: SelectorRename,
): GuardResult {
  const originalLines = original.split('\n');
  const editedLines = edited.split('\n');

  if (originalLines.length !== editedLines.length) {
    return {
      ok: false,
      reason: `Edit changes line count (${originalLines.length} → ${editedLines.length}); a locator heal must not add or remove lines`,
    };
  }

  let changedLines = 0;
  for (let i = 0; i < originalLines.length; i++) {
    const before = originalLines[i]!;
    const after = editedLines[i]!;
    if (before === after) continue;
    changedLines++;

    const reverted = after.split(rename.newSelector).join(rename.oldSelector);
    if (reverted !== before) {
      return {
        ok: false,
        reason: `Line ${i + 1} contains changes beyond the selector rename: ${JSON.stringify(after.trim())}`,
      };
    }
  }

  if (changedLines === 0) {
    return { ok: false, reason: 'Edit changes nothing' };
  }
  return { ok: true };
}
