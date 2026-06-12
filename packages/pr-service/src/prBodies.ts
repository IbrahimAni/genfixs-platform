import type { AuthoredFix, Diagnosis, RegressionReport } from '@genfixs/domain';

/**
 * Structured PR/issue bodies (spec §10.8): classification, evidence, what
 * changed, why it is safe. The PR body is GenFixs's proof of work.
 */

export function healPrBody(diagnosis: Diagnosis, fix: AuthoredFix): string {
  return `## GenFixs auto-heal: benign locator drift

**Classification:** \`BENIGN_DRIFT\` (confidence ${(diagnosis.confidence * 100).toFixed(0)}%, ${diagnosis.source})

### What drifted
${fix.summary}

### Why this is safe
${diagnosis.rationale}

- Only locator/selector-level changes; assertions and flow are untouched (verified structurally).
- The healed test ran green against the current app build before this PR was opened.

### Evidence
- Failing error: \`${diagnosis.evidence.failure.errorMessage}\`
- Test: \`${fix.testFile}\` › ${fix.testTitle}

---
*Authored by GenFixs. Heal silently, fail loudly: this PR exists because the change was pure drift; anything ambiguous is quarantined instead.*`;
}

export function rewritePrBody(diagnosis: Diagnosis, fix: AuthoredFix): string {
  return `## GenFixs proposed rewrite: the app's behavior changed

> **Is this intended?** This PR requires your confirmation that the new behavior is deliberate. It will not merge without human approval.

**Classification:** \`BEHAVIOR_CHANGE\` (confidence ${(diagnosis.confidence * 100).toFixed(0)}%)

### What changed in the app
${fix.evidenceSummary ?? 'See diff evidence below.'}

### What the proposed test does
${fix.summary}

### Evidence
- Failing error: \`${diagnosis.evidence.failure.errorMessage}\`
- Test: \`${fix.testFile}\` › ${fix.testTitle}
- The rewritten test verified green against the current app build.

---
*Authored by GenFixs. If the behavior change is NOT intended, close this PR and treat the original failure as a regression.*`;
}

export function regressionIssueBody(report: RegressionReport): string {
  return `## GenFixs regression report

A test failed for the right reason: the test's logic is sound and the app's output is wrong. **The test has not been modified and will stay red until this is resolved.**

### Failing assertion
\`\`\`
${report.failingAssertion}
\`\`\`

### Suspect app change
${report.suspectAppChange}

### Reproduction
${report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

**Severity hint:** ${report.severityHint}

---
*Reported by GenFixs. A false green is worse than a false red: GenFixs never edits a test to match broken behavior.*`;
}
