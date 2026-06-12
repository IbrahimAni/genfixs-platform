# GenFixs: Product Brief

_A living document. Version 0.1, first draft from the founding brainstorm._

GenFixs keeps a software team's automated test suite green, honest, and trustworthy without anyone having to babysit it, so teams never ship a bug hidden behind a passing test.

---

## 1. The north star (where this is going)

Most of the work a QA function does today is repetitive, reactive, and judgment-heavy in a way that machines can increasingly handle. The long-term goal of GenFixs is to take on much of that function: not just running tests, but deciding what to test, keeping the suite reliable, telling real regressions apart from noise, and reporting health to the people who need it.

That is the destination. It is earned, not claimed. We get there by first becoming indispensable at one narrow, painful job, proving we can be trusted, and expanding outward from there.

## 2. The problem we start with

Teams that automate testing all hit the same wall. Writing tests is no longer the hard part. The hard part is keeping the suite alive. Tests go flaky. They break every time the UI changes. Engineers spend hours triaging a wall of red failures to find the one that actually matters, and the rest of the time they ignore the suite or let it rot.

The pain is present-tense and universal: any team with a real Playwright or Cypress suite is living it right now. That is where we enter.

## 3. The wedge: the autonomous test-maintenance engineer (v1)

GenFixs v1 does one thing extremely well: it keeps an existing test suite healthy.

We do not ask the customer to rewrite anything or adopt a new framework. They connect their CI and their existing repo, and GenFixs goes to work on what is already there. Value shows up in the first week, with almost none of the risky machinery that a generate-from-scratch product would need up front.

### How it works

1. The customer connects their CI pipeline and their existing test repository.
2. GenFixs watches test runs. When a test breaks, it diagnoses why.
3. It sorts every break into one of three buckets:
   - **Benign drift** (a renamed testid, a moved button, a changed locator, with the test's intent unchanged): GenFixs authors the fix and opens a pull request that is already green. Eligible for auto-merge. Zero engineer time.
   - **Behavioral or flow change** (the app now does something different): GenFixs authors the proposed updated test, attaches the app change as evidence, and asks an engineer to confirm the new behavior is intended before anything merges. A thirty-second yes or no, not a rewrite.
   - **Ambiguous** (cannot be classified with confidence): GenFixs does not touch the test. It quarantines it and escalates with a root-cause hypothesis.
4. GenFixs reports suite health to stakeholders.

### What comes right after v1, still inside the wedge

Once GenFixs is trusted to maintain, it earns the right to create. Grounded in the team's product specs and Jira tickets, it proposes brand new tests on demand. It writes the test case first, and an engineer triggers generation, either in bulk or one at a time. Generation is always behind an explicit human trigger, which keeps both cost and the review checkpoint under control.

## 4. The principles that cannot be broken

These are the non-negotiables. They are what separate a tool teams trust from a tool teams quietly switch off.

**Heal silently, fail loudly.** The worst thing a QA product can ever do is make a failing test pass to hide a real bug. A false green is far more dangerous than a false red, because nobody investigates green. GenFixs only ever auto-fixes when the change is pure drift and the test's intent is preserved. When behavior changed, it surfaces the failure. When in doubt, it never heals.

**Author, do not just notify.** The expensive part of maintenance is writing the fix: reading the new flow, finding the new locators, updating assertions, getting it green. Judging whether a fix is correct takes a senior engineer seconds. So GenFixs always authors the fix, even for behavioral changes, and the human's job collapses to approval. "A human handles it" must always mean "a human approves what the agent wrote," never "the human writes it from scratch." That distinction is the entire value of the product.

**Ground everything in intent.** Product specs and acceptance criteria are the source of truth. They are not only used to generate new tests, they are what lets GenFixs safely heal old ones, because you have to know what a test was protecting to know whether a fix preserves its meaning. Slack and Jira activity are treated as tripwires, signals that an area is in motion and should be re-checked, not as specifications themselves.

**Be honest about flakiness.** GenFixs auto-heals locator drift. It does not pretend to fix flakiness caused by race conditions, shared state, timing, or network nondeterminism, because that is often the app having a real problem, not the test having a bug. For those, GenFixs quarantines the test and hands the engineer a root-cause hypothesis.

## 5. Why GenFixs is different

Almost every tool in this space races to generate tests. GenFixs plants its flag somewhere harder, stickier, and far less crowded: keeping tests honest. Generation is increasingly a commodity, since an automation engineer can wire up a model and Playwright in a week. Trustworthy maintenance is the job nobody has solved, and it is the job that makes a suite worth keeping.

## 6. Who buys it

The champion is the QA lead or QA manager. We enter as a force-multiplier that makes their team faster and their suite reliable, which makes them an ally rather than someone we are threatening. The eventual move up to replacing much of the function happens later and quietly, as the suite proves itself and headcount simply is not backfilled. We never lead with "fire your QA team."

## 7. How value is delivered

Every fix reaches the customer as a pull request into their own repository. The repo stays the single source of truth, the engineer keeps the review checkpoint they will demand, and the PR description doubles as GenFixs's proof of work. Our true unit of value is a clean, correct, CI-passing pull request, every time.

## 8. Architecture leanings (high level, to be detailed)

- The agent uses a DOM-driven browser stack (Playwright paired with a model, or a Playwright abstraction such as Stagehand), running on managed browser infrastructure or self-hosted. Vision-based control is reserved for cases where the DOM is opaque, since DOM-driven approaches are meaningfully more reliable.
- The agent explores with Playwright and emits Playwright tests. The same primitive goes in and comes out.
- Tests live in the customer's repo and run in the customer's CI. This is also the key cost decision: the customer bears execution compute, which keeps our variable cost contained to exploration, fix authoring, and maintenance analysis.
- Authenticated apps are handled with persistent sessions: the customer provides one test account per role and authenticates once, rather than a human sitting in the loop on every run.

## 9. Economics and pricing thinking

Storage is not the cost concern. Compute is. Because tests run in the customer's CI, our variable spend is mostly fix authoring and analysis, which is far more predictable than running suites ourselves. The pricing model splits along that line: a steady subscription for "keep my suite healthy," and opt-in credits for the heavy, variable work like bulk generation. We avoid surprise invoices on purpose, because we are selling peace of mind, and a peace-of-mind product that sends a shock bill defeats itself. Exact numbers come after we have measured real per-customer compute.

## 10. Roadmap shape

- **v1 (the wedge):** maintain existing suites. Connect CI, diagnose breaks, auto-fix benign drift, propose fixes for behavioral changes, quarantine the rest, report health.
- **v2:** generate new tests grounded in specs and Jira. Introduce the feature graph for impact analysis: when a component changes, show which features connect to it and therefore which tests must run or are at risk. This blast-radius view is where the node graph genuinely earns its place.
- **v3 and beyond (the destination):** take on much of the QA function. Broaden test types toward api, security, and performance. Add the stakeholder observatory. Support the fuller multi-role workflow.

## 11. The node graph: deliberately later

The vision of mapping every feature and how they interconnect, like neurons, is powerful, but it is a v2 weapon, not a v1 foundation. Of the three things v1 cares about, auto-healing locators, diagnosing flakiness, and detecting flow changes, the full graph is load-bearing for none of them, and a lighter flow model covers the one case that needs structure. The graph becomes the core exactly when we move to impact analysis. We build the value engine first and the impressive map second.

## 12. The riskiest bet and how to test it cheaply

The entire business rests on one number: the share of real test breaks that GenFixs can safely auto-fix with zero human time and zero false greens. A large share means a category-defining product. A small share means a glorified notifier.

We can measure this before building the platform, using data that already exists for free. Public projects with test suites have git histories full of exactly this pattern: a change broke a test, a later commit fixed it, and the fix diff reveals whether it was a simple locator rename or a real behavioral rewrite. Replaying that history across a handful of projects and classifying each break gives us the addressable auto-fix rate. It is a few days of work and it de-risks the core bet. Worth running before committing to the architecture.

## 13. Open questions to resolve next

- What fraction of real breaks are confidently auto-mergeable? (The core number above.)
- What exact signal distinguishes benign drift from behavioral change? This classifier is the technical heart of the product.
- Which framework do we support first? (Playwright is the leading candidate.)
- What is the real per-customer monthly compute cost, and what does that imply for pricing tiers?
