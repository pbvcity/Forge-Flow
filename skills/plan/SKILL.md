---
name: plan
description: Turns a request into PLAN.md with tasks, runnable acceptance commands, and a separate list of what needs a person. Use when work spans several steps or tasks, or when the user asks for a plan or a task breakdown.
---

# plan

Follow `../../playbook/default.md` (relative to this skill's directory). Output: `PLAN.md` at the repository root. For several plans side by side, keep each in its own file and pass `--plan <path>` to the tool.

## 1. Understand

Read the code the work will touch. Then ask yourself:

- What would an expert do here that was not requested?
- What is the rawest source of truth for this: real data, the real API, the running system?
- Who or what will prove the result right?
- For data work: which decision does this drive, who acts on it, and how is it measured? If nobody can say, raise that first.

Answer from the repository where you can. Before starting, ask in one message about facts the repository cannot give and direction choices where a different answer would throw away much of the work, each with your recommendation. This is the time to ask. Once work starts, run on your own.

## 2. Cut

Before listing tasks, ask of each piece whether it needs to exist, and whether the repository, standard library, platform, or an existing dependency already does it. If a piece is uncertain, prefer a small prototype to more planning.

## 3. Write PLAN.md

```markdown
# <goal>

Risk: <tier>. <reason>.
Outcome: <what a user or system can observe when this is done>
Exit condition: `<command>`, or a sentence for an observer
Not doing: <what is out of scope, and optional items left out>

## Tasks

- [ ] T1 <outcome of this task>
  Accept: `<runnable command>`
  Files: <every path or glob this task writes>
  Shared: <port, database, or service it needs alone, if any>
  Depends: <task IDs, or none>
  Risk: <tier, when it differs from the plan>
  Executor: <optional executor name or pi:vendor/model:effort>

## Needs a person

- [ ] <action>. Why: <reason>. Steps: <exact steps>. Blocks: <task IDs, or nothing>.

## Direction choices

- [ ] <choice>. Options: <...>. Recommended: <...>. Work at stake: <...>. Blocks: <task IDs, or all>.
```

Record business details you choose in `DECISIONS.md`, not here, so they reach the list the user confirms.

Omit `Executor:` to use `roles.builder`. A task's `Executor:` overrides that default; unknown executors produce a plan note and hold only that task. `roles.fallback` is empty by default. When configured, it handles a task's second attempt only, or becomes the run's builder after a provider limit. Further limits use the existing wait schedule. Reports name the executor used.

- Each task has at least one `Accept:` command that exits non-zero on failure. Run it now if it can run, so you know it is well formed.
- Before writing an enum value, status, config key, or field name into a plan or doc, search its source of truth and use the name found there.
- If only a person can accept something (real device, real money, a look at the page), put it under "Needs a person" with exact steps.
- `Files:` decides what can run in parallel, so list every path the task writes. A task without `Files:`, a high-risk task, or one touching repository-wide files such as `package.json` runs serially. `Shared:` names a port, database, or service that two tasks cannot use at once.
- Put the plan in the planning folder, `planning/PLAN.md` by default, or `planning/<topic>/PLAN.md` for several at once, run with `--plan`. An existing root `PLAN.md` still works.
- Keep tasks to about 30 minutes each, since a process is stopped at 60. Split where write sets separate, and mark real dependencies only, so tasks can run independently.
- High tier: add tasks for real-environment acceptance, the kill switch or rollback, and the before/after comparison.
- Follow "Business decisions" in the playbook: choose details yourself, including prices and permissions. Only direction choices wait for an answer, and a ticked one no longer holds its tasks.

## 4. Check

For contract and high, have one reviewer read the plan using `../../playbook/review.md`. Fix what it finds, and stop after one round: plans have no run result to converge on.

For routine, reread it once as if you were the executor. Could you start without asking anything?

## 5. Hand on

Continue with the `build` skill, or `auto` if the user wants it run unattended. If an open direction choice blocks every task, put it to the user and stop. Otherwise go on with the tasks it does not block.
