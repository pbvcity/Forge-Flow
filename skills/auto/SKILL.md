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

For each task it starts a clean process, runs acceptance itself, and commits on a run branch. A failed task is parked on a branch and the rest carry on. A stuck task goes to a clean lead process, which may narrow or split it. A provider limit pauses the run. Contract and high tasks are reviewed. It never pushes or goes live.

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

Read the commits. Routine tasks are not reviewed by the run, so the lead decides whether they need it, and any "tests weakened" flag needs a look.

When a plan is finished, `ff archive` moves it to `plans/done/`.

Leave one summary for the user: what got done, every open item in `DECISIONS.md` for them to confirm one by one, what needs them (with steps), what they may want changed, and the state of the exit condition.
