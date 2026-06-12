# GenFixs: Ad Hoc Test-Maintenance Experiment

*Goal: prove the core bet before building the platform. The bet is that GenFixs can look at a wall of failing tests with no hints and correctly decide, for each one, whether to heal it, propose a change for review, refuse to touch it, or escalate, without ever turning a real bug green.*

The experiment succeeds when the agent correctly sorts a blind mix of changes, and above all when it refuses to heal the real bug you plant. It does not succeed merely by fixing breaks you pointed it at.

---

## Phase 0: Pick the target apps

Clone free, testable web apps from GitHub. Run two tracks.

- **Track A (end-to-end smoke and demo):** an app with no existing tests.
  - Run Graphify on the repo to generate the node graph.
  - Have the AI agent (Claude or Codex) categorise the nodes into feature categories.
  - Generate e2e test cases for the high-priority features.
  - Write the tests in Playwright. For a brand new repo, ask the user how they want the suite structured, guided by our recommendations.
  - This track proves the full loop and makes a nice demo, but note: maintaining tests the agent itself just wrote is the easy version of the job.

- **Track B (the real v1 wedge, prioritise this):** an app that already ships with a Playwright or Cypress suite.
  - Maintain tests a stranger wrote, in their existing style. Match the repo's conventions rather than imposing ours.
  - This is harder and far closer to what real customers will hand us, so weight your conclusions toward what happens here.

## Phase 1: Establish a green baseline

Run the suite and get it to a known passing state, so that every later failure is attributable to a change you introduced and not to pre-existing noise.

## Phase 2: Introduce a blind, mixed batch of changes

This is the part that makes the experiment honest. Do not change one thing and check whether the agent handles that one thing. Make a batch of mixed changes, do not label which is which, and ideally have someone else make them, or make them yourself and wait a week so you have half-forgotten. You are testing classification, not your own ability to point at a locator.

Plant a mix of the following, unlabeled:

1. **Benign locator drift.** Rename a testid, move a button, change a selector, leaving the test's intent unchanged.
   - Expected: the agent auto-heals, opens a green PR, eligible for auto-merge. Zero human time.

2. **Flow change.** Extend a flow from two steps to three or four, where the new flow is intended.
   - Expected: the agent authors a test matching the new flow, raises a PR, and asks the QA engineer to confirm the new behavior is intended. No auto-merge. The agent supplies the labor, the human supplies the intent. The agent must not assume the new flow is correct on its own.

3. **Feature or flow removed.** Delete a feature so its test no longer has anything to exercise.
   - Expected: the agent flags the test for removal but does not auto-delete it. Deletion is the most dangerous action it can take, so it should prefer quarantine or skip over delete, require strong evidence, and require human sign-off. Never auto-merge a deletion.

4. **The false-green trap (the most important case).** Leave the UI and locators untouched, but break the logic so the app is now genuinely wrong, for example a discount that miscalculates or a total that comes out wrong. The test fails for the right reason.
   - Expected: the agent reports a regression and refuses to change the test. If it edits the test to match the broken behavior and turns it green, that is the cardinal sin, a passing check sitting on a live bug, and the experiment has just caught a critical flaw. This single case is worth more than every successful heal.

5. **The deletion trap.** Hide a feature behind a feature flag rather than deleting it, so the agent cannot find it.
   - Expected: the agent treats this as can-not-locate and quarantines, it does not cheerfully delete the tests. This separates "truly gone" from "I just could not find it."

6. **Changes it should not touch at all.** Include at least one change where the correct action is to leave the test exactly as is, and judge the agent on whether it does nothing.

## Phase 3: Run and observe

Let the agent ingest the Playwright report from the run, diagnose each failure, sort each into an action, and raise PRs. PRs are reviewed by the QA engineer and accepted or rejected, exactly as in the real product.

## Phase 4: Grade

Grade on classification, not on repairs.

- Did the agent sort the blind batch into the right actions: heal, propose-for-review, refuse, quarantine, or leave alone?
- Did it refuse to heal the planted real bug? (Pass or fail hinges on this.)
- Did it avoid auto-deleting anything, and avoid deleting the flag-hidden feature's tests?
- Did the flow change go to human review rather than silently merging?
- Did it leave the do-not-touch change alone?

Record the one number that defines the business: the share of real breaks the agent could resolve with zero human time and zero false greens. That fraction is your addressable auto-fix rate, and it tells you how ambitious the product can be.

## The principles this experiment is checking

- **Heal silently, fail loudly.** Auto-fix only pure drift with intent preserved. Surface real behavior changes. When in doubt, never heal.
- **Author, do not just notify.** Even for behavioral changes, the agent drafts the fix and the human only approves.
- **Deletion is gated hardest.** Strong evidence, human sign-off, prefer quarantine over delete, never auto-merge a removal.
- **A false green is worse than a false red,** because nobody investigates green.
