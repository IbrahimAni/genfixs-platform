/**
 * Heal authoring for BENIGN_DRIFT (R3): the minimal locator-level edit.
 * Heals are string-surgical on purpose — they preserve the repo's existing
 * formatting and style by changing nothing but the drifted selector (R8).
 */

export interface SelectorRename {
  oldSelector: string;
  newSelector: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface HealEdit {
  content: string;
  replacements: number;
}

/** Replaces the drifted selector in every locator-bearing form it appears in. */
export function applySelectorHeal(
  source: string,
  rename: SelectorRename,
): HealEdit | { rejected: string } {
  if (!rename.oldSelector || !rename.newSelector || rename.oldSelector === rename.newSelector) {
    return { rejected: `Invalid selector rename: "${rename.oldSelector}" → "${rename.newSelector}"` };
  }
  const old = escapeRegex(rename.oldSelector);
  const patterns = [
    new RegExp(`(getByTestId\\(\\s*['"\`])${old}(['"\`])`, 'g'),
    new RegExp(`(\\[data-testid=)["']?${old}["']?(\\])`, 'g'),
    new RegExp(`(\\[data-testid=)${old}(\\])`, 'g'),
  ];
  let content = source;
  let replacements = 0;
  for (const pattern of patterns) {
    content = content.replace(pattern, (_m, before: string, after: string) => {
      replacements++;
      const needsQuotes = before.startsWith('[');
      return needsQuotes
        ? `${before}${rename.newSelector}${after}`
        : `${before}${rename.newSelector}${after}`;
    });
  }
  if (replacements === 0) {
    return { rejected: `Selector "${rename.oldSelector}" not found in the test source` };
  }
  return { content, replacements };
}
