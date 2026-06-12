import { createHash } from 'node:crypto';

/**
 * Stable test identity across runs (spec §9: "file + title hash"; DECISIONS.md D1).
 * Refactor-resilient identity (content hashing, annotations) is an open question
 * deferred past v1 (spec §17).
 */
export function computeTestId(file: string, fullTitle: string): string {
  return createHash('sha256').update(`${file}::${fullTitle}`).digest('hex').slice(0, 24);
}
