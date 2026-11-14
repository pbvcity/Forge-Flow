---
name: build
description: Implements a plan or a clear task, verifies it against acceptance commands, and closes it out. Dispatches work through ff run or host sub-agents when configured. Use when there is a PLAN.md to carry out, or a clear change to implement at routine tier or above.
---

# build

Follow `../../playbook/default.md` (relative to this skill's directory). Read "Verification" and "Checks" now, "Failures" when something fails, and "Business decisions" when a detail is left open. Read `../../playbook/packs/` files that fit the subject.

## 1. Start

Read `PLAN.md` if there is one, and run:

```
node <this skill's directory>/../../cli/ff.mjs status
```

If the tool is missing or fails, use `PLAN.md` and `git log`. Skip tasks already done. Never commit directly to the main branch. If the repository has a remote, branch from the latest main.

## 2. Do each task

Use the reuse ladder before writing code: does this need to exist, does the repository do it, the standard library, the platform, an existing dependency, one line? Then write the smallest version.

- Choose the evidence that fits the work, using the key points in `go`. Not every change needs a new test.
- Contract and high, where a test can express the behavior: write the failing test first and watch it fail. A new test that passes at once proves nothing.
- A shortcut with a known limit gets a comment: `shortcut: <the limit>, <when to upgrade>`.
- If you find a bug outside the task, fix it if the fix is small and clear. Otherwise note it.
- Run the task's `Accept:` commands and tick the task in `PLAN.md` only on real passing output.
- In a fix round, rerun only the tests the fix touches. Run the full suite once at the end.

## 3. Dispatch when it helps

Work in the current session by default. Dispatch when the configured builder differs from you, or when independent tasks can run in parallel. Check `roles.builder` in `~/.ff/config.json`.

Write a work card from "Work cards" in the playbook, and add `../../playbook/executors/<profile>.md`, using `generic`, `gpt`, or `claude`.

```
node <this skill's directory>/../../cli/ff.mjs run <card file>
```

If `ff run` is missing or fails, use a host sub-agent with the same card. If the host has none, do the task here. Note which one happened. Do not block on the tool.

For read-only reads of a result, the plugin ships two agents: `ff:ff-review` and `ff:ff-diagnose` on Claude Code, and `ff_review` and `ff_diagnose` on Codex (synced by `ff` into `~/.codex/agents/`, read-only by instruction only). Give them the diff or patch path and the evidence, never a request to change files.

The exit code is not the result. After any dispatch, read the real diff and rerun acceptance yourself.

If a dispatched task fails, do not retry blind. Have the read-only `ff-diagnose` sub-agent (`ff:ff-diagnose` in Claude Code, `ff_diagnose` in Codex; elsewhere a read-only sub-agent with the same inputs) read the card, the acceptance output, and the diff and name the cause. Then dispatch the same executor again with that diagnosis on the card. Change executor only after a provider limit. At most 3 attempts; then hold the task and say why.

## 4. Audit

```
node <this skill's directory>/../../cli/ff.mjs audit --base <ref>
```

It lists new checks, config, states, and weakened tests. Treat the list as hints, and for each new check ask what loss it prevents and what a misfire costs. Delete what has no answer. A weakened test blocks: restore it or explain why the behavior changed.

If the tool is missing, read the diff for the same things yourself.

## 5. Verify and close

Meet the verification row for the tier. Then:

1. Update docs that the change made wrong: `node <this skill's directory>/../../cli/ff.mjs docs` lists candidates from the changed files. Do small follow-ups now. On contract or high work, put each dated "Next look" into the repository's `FOLLOWUPS.md` as `- [ ] YYYY-MM-DD What to check. Evidence: <command or where to look>`. Later checks stay open until their evidence is gathered and reported.
2. Hand to the `review` skill for contract and high. For routine, the lead decides as "Risk tiers" describes.
3. After a branch merges, run `ff wt clean --apply` and `ff cleanup --apply` without asking: they delete only worktrees, `ff/*` branches, and old records proven merged or expired. Items they list but keep (branches outside `ff/`, stale `ff/failed/*`, old `temp/` entries) are the user's decision.
4. If the repository has a remote, close through its normal flow: work branch, commit, PR, CI. Read the CI result before calling it finished. Without a remote, leave the changes in the working tree unless the user asked for commits, and say so.
5. End your report with what changed, what you ran with real results, what you skipped or left unchecked, the remaining risk, and every open item in `DECISIONS.md` for the user to confirm one by one. Going live waits until the user has confirmed the items the release carries. If a run's `.ff/runs/<id>/summary.md` has a `## Needs your look` section, copy every item from it into the report verbatim, each with its task id, as its own short list; never only point to `summary.md`.
