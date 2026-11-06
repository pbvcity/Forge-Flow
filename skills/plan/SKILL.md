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
  Files: <main files>
  Depends: <task IDs, or none>
  Risk: <tier, when it differs from the plan>

## Needs a person

- [ ] <action>. Why: <reason>. Steps: <exact steps>. Blocks: <task IDs, or nothing>.

## Direction choices

- [ ] <choice>. Options: <...>. Recommended: <...>. Work at stake: <...>. Blocks: <task IDs, or all>.
```

Record business details you choose in `DECISIONS.md`, not here, so they reach the list the user confirms.

- Each task has at least one `Accept:` command that exits non-zero on failure. Run it now if it can run, so you know it is well formed.
- If only a person can accept something (real device, real money, a look at the page), put it under "Needs a person" with exact steps.
- Keep tasks to about 30 minutes each, since a process is stopped at 60. Split where write sets separate, and mark real dependencies only, so tasks can run independently.
- High tier: add tasks for real-environment acceptance, the kill switch or rollback, and the before/after comparison.
- Follow "Business decisions" in the playbook: choose details yourself, including prices and permissions. Only direction choices wait for an answer, and a ticked one no longer holds its tasks.

## 4. Check

For contract and high, have one reviewer read the plan using `../../playbook/review.md`. Fix what it finds, and stop after one round: plans have no run result to converge on.

For routine, reread it once as if you were the executor. Could you start without asking anything?

## 5. Hand on

Continue with the `build` skill, or `auto` if the user wants it run unattended. If an open direction choice blocks every task, put it to the user and stop. Otherwise go on with the tasks it does not block.
