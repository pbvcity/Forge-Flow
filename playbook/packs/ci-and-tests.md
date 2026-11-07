# Pack: CI and test planning

Read when setting up or changing CI, choosing what to run before a push, or adding a slow or flaky test. The point is fast feedback at the lowest cost that still catches real problems.

## Evidence by kind of work

Ask what would show this works, and take the cheapest evidence that would catch the likely failure. A test file is one kind of evidence. Add a lasting test only where the behavior could break unnoticed and that matters. A throwaway script or a look at one page does not need one.

| Work | What fits | Usually not worth it |
|---|---|---|
| Logic, calculation, state | Unit tests with boundaries and failure paths | Tests that repeat the implementation |
| APIs, jobs, webhooks | A test through the real entry point, with error responses | Mocking the subject |
| Queries and migrations | A real database or a copy, with before and after counts | Mock-only runs |
| Third-party services | Sandbox or recorded real responses, then one real small cycle | Doubles written from memory |
| UI and visual | The real render at desktop and phone widths, all states. Tests for logic and key flows | Pixel snapshots, tests of styling |
| Config, env, deploy, CI | A real start through the entry point, flag on and off, dry run or lint | Tests that read the config back |
| Refactors | Existing tests unchanged and passing. If coverage is poor, pin the behavior first | New tests for the new structure |
| Scripts and one-off work | A run on real or sample input, dry run before writing | A test file for code that will be deleted |
| Prompts, skills, model output | Several real sample runs, judged on the outcome | Exact text matches |
| Performance, concurrency | Before and after measurements, concurrent callers on the real path | Assertions on load-dependent timing |
| Docs and copy | Link check and reading the diff | Everything else |
| Spikes and prototypes | Say it is throwaway, then show it once | Anything lasting, until it is kept |

A fixed bug gets a test that fails without the fix whenever a test can express it. When none can, record how you reproduced it and how it now behaves. Report the evidence you used in a line.

## Choosing what to run

- CI is the last check, not a debugger. Run the smallest sufficient set locally first, then push once.
- Choose from the changed files: `git diff --name-only origin/<main>...HEAD`. When a change spans areas, take the union.
- Keep the mapping from path to checks in one written table or script, with a test of its own if it is a script. Keep local choices and CI scopes on the same map.
- Shared code runs the checks of everything that depends on it. A package change also runs its consumers.
- Docs only: check links and whitespace, and read the diff for stray code.
- In a fix round, rerun only the tests the fix touches. The full suite waits for the merge point.

## Test layers

| Layer | When | Budget |
|---|---|---|
| Unit | Every change, for what you touched | Seconds to a minute |
| Integration | When the change reaches them, chosen by the diff | A fix loop stays near 10 minutes |
| Whole suite | At the merge point | Whatever it takes, once |
| Slow or real-environment | When their code or dependencies changed since the last green run, and before a release | Scheduled, never on every push |

Say which layers you ran and which you skipped.

## CI layout

- A job first detects scope from paths, then jobs run by scope. Docs-only changes skip installs and heavy jobs.
- One run per PR: `concurrency` keyed by PR number with `cancel-in-progress: true`, so a new push replaces the old run.
- Required checks keep stable names. A job skipped by scope must still report success. If scope detection itself fails, the required check fails, so nothing is skipped silently.
- Do not repeat the whole suite after merging the same diff unless you have a reason. Offer a manual trigger with a scope, such as `workflow_dispatch`.
- Reuse builds. Key dependency caches on the lockfile, share built artifacts between jobs, and use the build tool's remote cache if it has one. Rebuilding what did not change is the most common waste.
- Pin the versions of the runtime and the tools, and keep them in step with production.
- Lint workflow files when they change, and parse scripts locally first.

## Shared resources

Parallel jobs that share a database, cache, port, or temp directory will collide in ways that look like flakes. Give each job its own, and write down who owns which. Runners inside containers often cannot use service containers or job containers, so check before relying on them.

## When CI misbehaves

- Read the failed log before rerunning anything.
- Stuck in the queue: first look for a superseded run holding the slot, and cancel it. Rerun once. Do not push empty commits to trigger it.
- Never skip tests, loosen assertions, or bypass a required check to get green.
- Finished means you read the result. A push is not done until then.

## Flaky and slow tests

- A flaky test is a bug in the test or the code. Find the cause. Retries only hide it, and a timeout that passes on a quiet machine fails under load.
- Tests own their environment: temp directories, home, and ports. Nothing depends on the machine or on another test's order.
- A check true only at one moment, such as a commit or a date, stays out of the regular suite.
- Keep reverse proofs, where you remove a fix to see a test fail, as one-time evidence. A mutation chain does not belong in the daily suite.
- Evidence goes in as small text receipts. Screenshots and full logs stay out of git.
