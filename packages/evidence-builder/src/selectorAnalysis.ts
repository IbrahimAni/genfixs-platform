import type { AppDiff } from '@genfixs/domain';

/**
 * Selector extraction and diff analysis. Deterministic and intentionally
 * conservative: when a diff contains anything beyond attribute-level selector
 * changes, it is NOT pure drift — ambiguity flows to the LLM stage and, below
 * confidence, to quarantine (spec §8 bias rule).
 */

export interface ExtractedSelector {
  kind: 'testid' | 'css' | 'role' | 'text';
  value: string;
}

const SELECTOR_PATTERNS: Array<{ kind: ExtractedSelector['kind']; regex: RegExp }> = [
  { kind: 'testid', regex: /getByTestId\(\s*['"`]([^'"`]+)['"`]\s*\)/g },
  { kind: 'testid', regex: /\[data-testid=["']?([^"'\]]+)["']?\]/g },
  { kind: 'css', regex: /locator\(\s*['"`]([^'"`]+)['"`]/g },
  { kind: 'role', regex: /getByRole\(\s*['"`]([^'"`]+)['"`]/g },
  { kind: 'text', regex: /getByText\(\s*['"`]([^'"`]+)['"`]/g },
];

export function extractSelectors(testSource: string): ExtractedSelector[] {
  const found: ExtractedSelector[] = [];
  const seen = new Set<string>();
  for (const { kind, regex } of SELECTOR_PATTERNS) {
    for (const match of testSource.matchAll(regex)) {
      const value = match[1]!;
      // locator('[data-testid=x]') is a testid selector, not a css one
      const inner = value.match(/^\[data-testid=["']?([^"'\]]+)["']?\]$/);
      const entry: ExtractedSelector = inner
        ? { kind: 'testid', value: inner[1]! }
        : { kind, value };
      const key = `${entry.kind}=${entry.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(entry);
      }
    }
  }
  return found;
}

export function serializeSelector(s: ExtractedSelector): string {
  return `${s.kind}=${s.value}`;
}

/** Attributes whose value changes are selector-level, not behavioral. */
const DRIFT_ATTRIBUTES = ['data-testid', 'data-test', 'id', 'class', 'aria-label', 'name'];

function normalizeDriftAttributes(line: string): string {
  let out = line;
  for (const attr of DRIFT_ATTRIBUTES) {
    out = out.replace(new RegExp(`${attr}=["'][^"']*["']`, 'g'), `${attr}=_`);
    out = out.replace(new RegExp(`${attr}=\\{[^}]*\\}`, 'g'), `${attr}=_`);
  }
  return out.trim();
}

interface PatchLines {
  removed: string[];
  added: string[];
}

export function splitPatch(patch: string): PatchLines {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  return { removed, added };
}

/**
 * True iff every changed line in the app diff differs only in the value of a
 * known drift attribute (testid/id/class/aria-label/name). Added or removed
 * files, or any non-attribute change, disqualify the diff.
 */
export function isPureSelectorDiff(diff: AppDiff): boolean {
  if (diff.files.length === 0) return false;
  for (const file of diff.files) {
    if (file.status !== 'modified') return false;
    if (!file.patch) return false;
    const { removed, added } = splitPatch(file.patch);
    if (removed.length !== added.length) return false;
    for (let i = 0; i < removed.length; i++) {
      const before = normalizeDriftAttributes(removed[i]!);
      const after = normalizeDriftAttributes(added[i]!);
      if (before !== after) return false;
      // The lines must actually differ pre-normalization, or the "change" is noise.
      if (removed[i]!.trim() === added[i]!.trim()) return false;
    }
  }
  return true;
}

export interface SelectorRename {
  oldSelector: string;
  newSelector: string;
}

/**
 * Detects a rename of a testid the failing test depends on: a removed line
 * carrying `data-testid="<used value>"` paired with an added line carrying a
 * different value in the same position.
 */
export function detectSelectorRename(
  diff: AppDiff,
  selectorsInTest: ExtractedSelector[],
): SelectorRename | undefined {
  const usedTestIds = new Set(
    selectorsInTest.filter((s) => s.kind === 'testid').map((s) => s.value),
  );
  if (usedTestIds.size === 0) return undefined;

  const testIdPattern = /data-testid=["']([^"']+)["']/;
  for (const file of diff.files) {
    if (!file.patch) continue;
    const { removed, added } = splitPatch(file.patch);
    for (let i = 0; i < Math.min(removed.length, added.length); i++) {
      const oldMatch = removed[i]!.match(testIdPattern);
      const newMatch = added[i]!.match(testIdPattern);
      if (!oldMatch || !newMatch) continue;
      if (oldMatch[1] !== newMatch[1] && usedTestIds.has(oldMatch[1]!)) {
        return { oldSelector: oldMatch[1]!, newSelector: newMatch[1]! };
      }
    }
  }
  return undefined;
}

/** App files plausibly linked to this test — structured substrate for the v2 graph (R15). */
export function findRelevantAppPaths(
  diff: AppDiff | undefined,
  testSource: string,
  selectors: ExtractedSelector[],
): string[] {
  if (!diff) return [];
  const relevant: string[] = [];
  const lowerSource = testSource.toLowerCase();
  for (const file of diff.files) {
    const baseName =
      file.path
        .split('/')
        .pop()
        ?.replace(/\.\w+$/, '')
        ?.toLowerCase() ?? '';
    const patchMentionsSelector = selectors.some((s) => file.patch?.includes(s.value));
    const sourceMentionsFile = baseName.length > 2 && lowerSource.includes(baseName);
    if (patchMentionsSelector || sourceMentionsFile) relevant.push(file.path);
  }
  return relevant;
}
