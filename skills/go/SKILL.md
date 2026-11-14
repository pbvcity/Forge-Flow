---
name: go
description: Default Forge Flow entry point. Classifies a request by risk tier and picks the lightest path, doing micro changes directly. Use when the user runs ff go, asks for the Forge Flow workflow, or asks Forge Flow to start a piece of work.
---

# go

If the request is plainly micro (docs, copy, a small style change, an existing setting) and touches nothing others depend on, skip everything below. A bug fix, a logic change, or a changed error code or API value is never micro, however small the diff. For a micro change: make the edit, run the related check, read your diff, and report in a few lines.

Otherwise, follow `../../playbook/default.md` (relative to this skill's directory). Read only its "Always" and "Risk tiers" sections now, and the rest as stages come up.

## 1. Orient

Read `PLAN.md` if present. If `PLAN.md`, `.ff/`, or `FOLLOWUPS.md` exists, run:

```
node <this skill's directory>/../../cli/ff.mjs status
```

If the tool is missing or fails, use `PLAN.md` and `git log` instead and continue. Pick up unfinished work rather than starting over when the request continues it.

When `ff status` lists due follow-ups, handle them first unless the user asked for something else: gather the evidence yourself, report what it shows, and tick the item in `FOLLOWUPS.md`. Use `node <this skill's directory>/../../cli/ff.mjs followups` to list all open checks and malformed lines. Keep a check open when its evidence still needs a real external dependency.

## 2. Classify

Read enough of the code to know what the change reaches. Decide the tier by loss type, not by size, and state it:

`Risk: <tier>. <one-line reason>.`

The user can change it with a sentence. Raise it later, and say so, if you find a higher loss. If the subject calls for a pack in `../../playbook/packs/`, read it.

If the request is ambiguous, resolve it from the repository. Ask, before starting, only when a wrong guess would throw away much of the work and the repository cannot answer. Other open details are decisions to record.

## 3. Route

Take the lightest path that fits:

| Request | Path |
|---|---|
| A question | Answer. Change nothing. |
| micro | Do it now, run the related check, report. No plan file, no review. |
| routine | Implement with the `build` skill, using only the parts that help. No `PLAN.md` or `REVIEW.md`. Get a clean review when the playbook says it is worth it, and put the result in your report. |
| contract, high | `plan` if there are several steps, then `build`, then always `review`. |
| Several tasks, or the user wants it run unattended | `plan`, then `auto`. |
| Review of existing changes | `review`. |

For a micro change:

1. Make the smallest edit that does what was asked, and look at nearby code for the same wording or value.
2. Run the related test or check, and read your own diff.
3. Report in a few lines: what changed, what you ran, anything unverified.

## 4. Check before you report

If you changed or removed any existing test, you are not finished until this has run. It takes a second, and reading your own diff does not replace it. If it reports a weakened test, restore the test or say why the behavior changed.

```
node <this skill's directory>/../../cli/ff.mjs audit --base <commit you started from>
```

If the tool is missing or fails, quote the error and read the diff for the same things.

For contract and high, you are also not finished until this has run. Do it once the change passes its tests, however small the diff. Reading your own diff does not count.

```
node <this skill's directory>/../../cli/ff.mjs review --base <commit you started from> --risk <tier>
```

Read each reviewer's output in full, fix what is real, rerun only the tests those fixes touch, and say in your report who reviewed and what they found. If the command exits 2 or 3, use a read-only sub-agent with the diff and `../../playbook/review.md`. You may report without a review only after both really failed, and you quote the errors. Skipping it by choice is not allowed.

## 5. Key points

Know these even if you open nothing else. For more than a small change in one of these subjects, read its pack in `../../playbook/packs/`.

- **Writing code:** Ask first whether it needs to exist, then whether the repository, standard library, platform, or an existing dependency already does it. Never cut validation at trust boundaries, error handling that prevents data loss, security, or accessibility.
- **Tests and CI** (`ci-and-tests`): Fit the evidence to the work; a test file is only one kind. Logic and state: unit tests, with boundaries and the failure paths that matter. APIs and jobs: a test through the real entry point. Queries: a real database when the project has one. UI: the real render, with tests only for logic and key flows. Config and deploy: start it for real. Refactors: existing tests unchanged and passing. Scripts: a run on real or sample input. Prompts and skills: real sample runs. Docs and copy: links and your diff. A fixed bug gets a test that fails without the fix whenever a test can express it. Add a lasting test only where the behavior could break unnoticed and matters. Mock only real external boundaries. Choose checks from the changed files. In a fix round, rerun only the tests the fix touches. Run the full suite once at the end, push once, read the result. Reuse builds and caches. Never skip tests or loosen assertions to get green. A flaky test is a bug. Passing acceptance by a trick is a failure: if the task cannot be done as written, say so and hold it. When a project has run for over a week, a merge check takes about an hour, or a problem shows up only in the full run for the second time, review the test process itself once: see "When to review the test process" in the pack.
- **Failures:** In a run, a task's first failure goes to the reviewer for a read-only diagnosis, then back to the same builder with the advice. An unclear cause gets a consult only when `roles.consult` is set, at most 2 per run. `roles.fallback` steps in only after a provider limit. At most 3 attempts per task; then the task is parked and a lead on the reviewer's model replans. In a session, have the read-only `ff-diagnose` sub-agent (`ff:ff-diagnose` in Claude Code, `ff_diagnose` in Codex) name the cause before the same executor retries.
- **Needs your look:** The user does not read summary files. Every `## Needs your look` item in a run's `summary.md`, and every finding you reject or defer without high confidence, goes into your final report verbatim with its task id, as its own short list.
- **Docs:** Before every commit, run `node <this skill's directory>/../../cli/ff.mjs docs` and put the documents your change made wrong into the same commit. Docs declare what they cover with a `Covers:` line.
- **Concurrency:** State can change across any `await`. Take the balance, stock, or order state before the wait, and recheck after it. Ask what a cancel or a second caller does in that gap.
- **UI** (`frontend-visual`): The project's own UI skill and rules come first. Use only its tokens and components. Look at the real render at desktop and phone widths, or write `not seen rendered`. Build every state: empty, loading, error, long text.
- **Data** (`data-migration`): Back up and confirm it restores. Count the real rows read-only first. Try it on a copy. Expand, migrate, contract. Delete only exact, listed targets.
- **Money** (`payments`): The server recomputes every amount. Store integer minor units. Verify callbacks and make them idempotent. A refund cannot exceed what remains. When state is unclear, do not charge twice. Run one real small cycle before going live.
- **Read-only agents:** For an independent read or a failure diagnosis, use the plugin's read-only agents instead of a general sub-agent: `ff:ff-review` and `ff:ff-diagnose` on Claude Code, `ff_review` and `ff_diagnose` on Codex (synced by `ff`; read-only by instruction only). Give them the diff or patch path and the evidence.
- **Windows** (`windows`): Set UTF-8 explicitly, and read back non-ASCII writes. Use absolute paths. Close stdin for headless tools. Kill whole process trees. `bash` may be the WSL launcher.
- **Cleanup:** After a PR merges, run `ff wt clean --apply` and `ff cleanup --apply` without asking: they delete only what is proven merged or expired. Items they list but do not delete (branches outside `ff/`, stale `ff/failed/*`, old `temp/` entries) are the user's call. `ff status` says when there is something to clean.

## 6. Keep going

Moving from one skill to the next is not a stop. Continue until the work is done or a stop from "When to stop" applies. For a stop, give the user what they need to decide, and finish everything that does not depend on it.
