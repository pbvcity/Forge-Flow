# ff CLI

Requires Node 22 or newer. No runtime dependencies. Commands use the current working directory as the worktree.

```
node cli/ff.mjs doctor
node cli/ff.mjs status
node cli/ff.mjs run card.md
node cli/ff.mjs run --all
node cli/ff.mjs archive
node cli/ff.mjs review --base main --risk contract
node cli/ff.mjs audit --base HEAD
node cli/ff.mjs council question.md
node cli/ff.mjs update --check
```

## Configuration

`~/.ff/config.json` merges with the project's `.ff/config.json`. Missing values use defaults, and unknown keys warn.

```json
{
  "roles": { "builder": "codex", "reviewer": "claude", "second": "" },
  "executors": {
    "mine": { "cmd": "mytool --headless", "profile": "generic", "reviewArgs": ["--read-only"] }
  },
  "review": { "panel": [] },
  "run": { "limitWaitMinutes": [5, 15, 30, 60, 60, 60, 60, 60, 60, 60] },
  "playbook": "~/.ff/my-rules.md"
}
```

- A role is an executor name, `pi:<vendor>/<model>:<effort>`, or `host` (the current session, which cannot run unattended).
- `claude` and `codex` are built-in executors. Their commands are in `cli/lib/config.mjs`, and a config entry of the same name overrides them.
- `cmd` is an executable plus arguments, or an array. It is not a shell program. The prompt arrives on stdin and ends with the path of the report file. The executable must wait for its children.
- `profile` is `generic`, `gpt`, or `claude`, matching `playbook/executors/`.

## One card

`run <card file> [--timeout-min <n>] [--force]` starts the builder once and then runs the card's `Accept:` commands itself. `Accept: <command>` works on each line, as does one command per line under a bare `Accept:`. Results are in `.ff/runs/<id>/`. Exit 0 means acceptance passed, or the card had none and the run is `unverified`.

## Whole plans

`run --all [--plan <path>] [--timeout-min <n>] [--foreground] [--force] [--dry-run]` runs a plan in the background. The format is in `skills/plan/SKILL.md`. `status` shows where it is, and it needs no host timer.

`run --all --dry-run` previews the current plan: completed tasks, tasks that would run now, and held tasks with their open direction choice, unmet dependencies, or need for a person. Dependencies count as met only when already ticked; the preview does not assume future success. It supports `--plan`, starts no child processes, and writes no run state, locks, branches, or worktrees. No headless builder is required. A successful preview exits 0 even when tasks are held; it does not verify executor availability or run acceptance commands.

Tasks run one at a time in a clean process. PLAN.md is reread before each one, so editing it changes course.

- **Truth.** The tool ticks a task, and only after its own run of the task's acceptance commands passes. After every process it undoes new ticks, restores the exit condition, restores the plan if it was damaged or a hold or risk tier was lowered, and lists any other change. If tasks were removed or acceptance changed, the result is `needs review`, not complete. Unparsed task lines also prevent complete.
- **Isolation.** Work on `main`, `master`, or the origin default gets a new `ff/run-*` branch. Uncommitted work is committed there first as a checkpoint. Each passing task is one commit. These are working commits, without hooks or signing, so run your checks before closing the branch. A task that stops has its work kept on `ff/failed/...`, and the tree returns to the last good commit, keeping PLAN.md and DECISIONS.md. If the work cannot be saved, the tree is left alone and the run stops. A process that leaves the run branch has its work parked and counts as failed. The run needs a git identity.
- **Retries.** A task gets two attempts, and the second sees the evidence. `BLOCKED: <reason>` from a worker holds that task at once.
- **Review.** Each contract or high task is reviewed against its own diff when reviewers can run headless. A FAIL counts as a failed attempt. Lower tiers and unavailable reviewers are stated in the report. Weakened tests are flagged.
- **Provider limits.** An executor that exits non-zero with a limit message pauses the run on the `run.limitWaitMinutes` schedule without using an attempt. When the schedule runs out, the run stops, and `run --all` resumes it.
- **Stuck tasks.** After two failures a clean lead process may narrow or split the task in the plan, at most three times a run. Changes are committed and reported. 
- **Exit condition.** In backticks it is a command, run once every task is done. In prose it is reported as needing an observer.
- **Report.** `.ff/runs/<id>/summary.md` lists each task, plan changes, and every open item in `DECISIONS.md`. A run never pushes, merges, or goes live.

If the controller dies, `run --all` resumes from the last commit: the plan is checked against its snapshot, work in progress is checkpointed, and that task runs again. A live executor from the old run is refused until stopped or `--force` is given. A task that timed out without a confirmed kill stops the run for the same reason.

## Archive

`archive [--plan <path>] [--force]` moves `PLAN.md` into `plans/done/PLAN-YYYY-MM-DD.md`, creating the directory. The date is UTC. Existing archives are preserved by adding `-2`, `-3`, and so on before `.md`.

Unticked tasks in the plan's `Tasks` section prevent archiving, with a message explaining `--force`. Task parsing uses the same plan format as `run --all`. `--force` archives unfinished plans too. `--plan <path>` selects another plan, relative to the current working directory or absolute; the destination remains the current worktree's `plans/done/`.

## Review

`review --base <ref> --risk micro|routine|contract|high [--panel] [--round <n>] [--plan <path>] [--timeout-min <n>]` starts one read-only process per reviewer, over the tracked and untracked diff.

Micro has no reviewers. Routine uses `roles.reviewer`. Contract and high add `roles.second` if it is set. `review.panel` replaces the list at those tiers, or at any tier with `--panel`.

Read-only comes from `reviewArgs`, or automatically for `codex`, `claude`, and `pi:` roles. Other executors must enforce it themselves, and ff warns. Secrets are redacted from the prompt and the stored outputs. Reviewers see the first 96 KiB of a diff, and larger ones are reported as partly reviewed.

The verdict is the last `VERDICT:` line. A PASS beside a BLOCKER or HIGH line, a failed process, or truncated output is not a pass. Exit 1 means a reviewer said FAIL, 2 means no usable verdict, 3 means the review needs a host sub-agent. Outputs are in `.ff/reviews/<id>/`.

## Audit

`audit --base <ref>` lists new guards, config, state, and test changes as hints for a person or model to weigh. It exits 1 only when a test loses an assertion or gains a skip with no replacement in that file.

## Council

`council <question file> [--members <a,b,c>] [--timeout-min <n>]` puts a question to each member in a separate read-only process, at the same time, so none sees another's answer. Members default to `review.panel`, then `roles.reviewer` and `roles.second`. Answers are in `.ff/councils/<id>/`. It gives advice, never a verdict. Exit 0 means at least one answered, 2 means none did, and 3 means no headless member is configured.

## Updates

`update [--check]` calls each host's own updater where Forge Flow is installed. One host failing does not stop the others.

- Claude Code: `claude plugin marketplace update forge-flow`, then `claude plugin update ff@forge-flow`.
- Codex: `codex plugin marketplace upgrade`, then `codex plugin add ff@forge-flow --json`.
- Pi: `pi update --extensions`.

`--check` changes nothing. It shows this copy's version, the latest tag at `update.repo`, and which hosts have it.
