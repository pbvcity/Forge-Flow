---
name: auto
description: Runs a whole PLAN.md unattended, one clean process per task, and picks up from ff status in any new session. Use when the user wants a plan carried through without supervision, overnight, or across sessions, or asks to resume such a run.
---

# auto

Follow `../../playbook/default.md` (relative to this skill's directory). Read its "Long tasks" and "Failures" sections now.

## 1. Check the plan

`PLAN.md` needs an exit condition that can be decided, and an `Accept:` command per task. If it is missing or lacks these, run the `plan` skill first. Do not ask whether to begin.

Tasks blocked by "Needs a person" or an open direction choice wait. Everything else goes ahead, and business details do not block.

## 2. Run

```
node <this skill's directory>/../../cli/ff.mjs run --all
```

It starts in the background and returns at once, so it does not depend on host timers or wake-ups. It needs a headless builder. If `roles.builder` is `host`, run the `setup` skill, or use step 4.

After starting the run, if the host supports background tasks, start `node <this skill's directory>/../../cli/ff.mjs wait` as a host background task. When it returns, read the final status and summary and perform step 6. Exit 0 means complete, 1 means another ending (or no run), and 3 means the optional `--timeout-min <n>` expired; on timeout, use `ff status` and wait again while the run is live. If the host has no background tasks, end the turn and use `ff status` in a later session.

For each task it starts a clean process, runs acceptance itself, and commits on a run branch. A failed task is parked on a branch and the rest carry on. A stuck task goes to a clean lead process, which may narrow or split it. A provider limit pauses the run. Contract and high tasks are reviewed. It never pushes or goes live.

When several tasks declare disjoint `Files:`, run them in parallel:

```
node <this skill's directory>/../../cli/ff.mjs run --all --dry-run --lanes 2
node <this skill's directory>/../../cli/ff.mjs run --all --lanes 2
```

The first shows the grouping and why any task stays serial. Each lane gets its own worktree, and the tool merges lanes back one at a time, reruns their acceptance after merging, and removes the worktrees. A conflict moves those tasks to a serial pass at the end. Two lanes is the default; more costs more and rarely pays.

## 3. Pick up

In any new session, on any host:

```
node <this skill's directory>/../../cli/ff.mjs status
```

Then read `PLAN.md` and `git log`, and check open PRs and worktrees before starting anything. If a run is live, leave its worktree alone; editing `PLAN.md` is how to change course mid-run. If it ended, read `.ff/runs/<id>/summary.md`. Decide what to do about failed and held tasks, edit the plan if needed, and run again: done tasks are skipped and failed tasks get a fresh try.

## 4. Without the tool

If `ff run` is missing or fails, do not block. Work through the tasks here, in order:

1. Take the next task whose dependencies are done.
2. Use a clean host sub-agent with a work card, or do it in this session if the host has none.
3. Rerun its `Accept:` command yourself.
4. Tick it in `PLAN.md`, and add one line under a `## Log` heading: task, result, time.

## 5. On failure, without the tool

- Environment flake: retry once, unchanged.
- Tool problem: fix it once.
- Product defect: fix once. When the same premise has failed twice, stop that task, record the premise and the evidence in `PLAN.md`, and go on with tasks that do not depend on it.
- Unsafe action or a stop from "When to stop": skip that task, record it, continue with the rest.

## 6. Finish

The tool tests a command exit condition when every task is done. A prose one needs you or another observer. Passing all tasks does not replace it. Never relax it to finish. If it fails, say what is missing, and continue if work remains that you can do.

Read `.ff/runs/<id>/summary.md`, the commits, and the diff. Routine tasks are not reviewed by the run, so the lead decides whether they need it, and any "tests weakened" flag needs a look.

Run the project's checks before closing the branch: run commits skipped git hooks, so passing task acceptance alone is not enough. Fix failures and rerun the affected checks, then follow [build step 5](../build/SKILL.md#5-verify-and-close) under the project's rules: push the work branch, open a PR, and read the CI result before calling it finished. Follow that step's no-remote path when applicable. The tool itself still never pushes or merges.

Going live and open items in `DECISIONS.md` follow the playbook: continue development, record provisional business decisions, and wait for confirmation of each open item the release carries before going live.

When a plan is finished, `ff archive` moves it to `<planning folder>/done/`.

Leave one summary for the user: what got done, every open item in `DECISIONS.md` for them to confirm one by one, what needs them (with steps), what they may want changed, and the state of the exit condition.
