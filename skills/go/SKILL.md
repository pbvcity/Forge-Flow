---
name: go
description: Default Forge Flow entry point. Classifies a request by risk tier and picks the lightest path, doing micro changes directly. Use when the user runs ff go, asks for the Forge Flow workflow, or asks Forge Flow to start a piece of work.
---

# go

If the request is plainly micro (docs, copy, a small style change, an existing setting) and touches nothing others depend on, skip everything below: make the edit, run the related check, read your diff, and report in a few lines.

Otherwise, follow `../../playbook/default.md` (relative to this skill's directory). Read only its "Always" and "Risk tiers" sections now, and the rest as stages come up.

## 1. Orient

If `PLAN.md` or `.ff/` exists, read the plan and run:

```
node <this skill's directory>/../../cli/ff.mjs status
```

If the tool is missing or fails, use `PLAN.md` and `git log` instead and continue. Pick up unfinished work rather than starting over when the request continues it.

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

## 4. Review before you report

For contract and high, you are not finished until this has run. Do it once the change passes its tests, however small the diff. Reading your own diff does not count.

```
node <this skill's directory>/../../cli/ff.mjs review --base <commit you started from> --risk <tier>
```

Read each reviewer's output in full, fix what is real, rerun the tests, and say in your report who reviewed and what they found. If the command exits 2 or 3, use a read-only sub-agent with the diff and `../../playbook/review.md`. You may report without a review only after both really failed, and you quote the errors. Skipping it by choice is not allowed.

## 5. Keep going

Moving from one skill to the next is not a stop. Continue until the work is done or a stop from "When to stop" applies. For a stop, give the user what they need to decide, and finish everything that does not depend on it.
