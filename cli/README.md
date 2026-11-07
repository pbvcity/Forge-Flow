# ff CLI

Requires Node 22 or newer. No runtime dependencies. Commands use the current working directory as the worktree.

```
node cli/ff.mjs doctor
node cli/ff.mjs init
node cli/ff.mjs status
node cli/ff.mjs followups
node cli/ff.mjs run card.md
node cli/ff.mjs run --all
node cli/ff.mjs wait
node cli/ff.mjs archive
node cli/ff.mjs cleanup
node cli/ff.mjs wt list
node cli/ff.mjs review --base main --risk contract
node cli/ff.mjs audit --base HEAD
node cli/ff.mjs docs
node cli/ff.mjs council question.md
node cli/ff.mjs update --check
```

## Configuration

`~/.ff/config.json` merges with the project's `.ff/config.json`. Missing values use defaults, and unknown keys warn.

```json
{
  "roles": { "builder": "codex", "reviewer": "claude", "second": "", "fallback": "" },
  "executors": {
    "mine": { "cmd": "mytool --headless", "profile": "generic", "reviewArgs": ["--read-only"] }
  },
  "review": { "panel": [] },
  "paths": { "planning": "planning", "temp": "temp", "worktrees": "" },
  "cleanup": { "keep": 20, "days": 30 },
  "run": { "limitWaitMinutes": [5, 15, 30, 60, 60, 60, 60, 60, 60, 60] },
  "playbook": "~/.ff/my-rules.md"
}
```

- A role is an executor name, `pi:<vendor>/<model>:<effort>`, `opencode:<provider>/<model>`, or `host` (the current session, which cannot run unattended).
- `claude` and `codex` are built-in executors. Their commands are in `cli/lib/config.mjs`, and a config entry of the same name overrides them.
- `cmd` is an executable plus arguments, or an array. It is not a shell program. The prompt arrives on stdin and ends with the path of the report file. The executable must wait for its children.
- `idleMinutes` limits silence on stdout and stderr for that executor, including reviewers. Codex defaults to 10 minutes; Claude and `pi:` roles have no idle limit. Unset custom limits and zero disable it. Output resets the timer; the overall task timeout still applies.
- `profile` is `generic`, `gpt`, or `claude`, matching `playbook/executors/`.

OpenCode builders and reviewers receive a stored prompt through `--file`, with `--dir` set to the project root, and no stdin prompt. `doctor` lists `opencode models` and infers their families from model names before falling back to providers. Reviews use a process-local `ff-review` agent via `OPENCODE_CONFIG_CONTENT`, allowing only read, grep, glob, and list. This uses the OpenCode V1 config format and replaces any inherited inline config for that reviewer, without writing user configuration. No agent installation is required; an unavailable agent is reported as failed and its verdict discarded. Builders retain their configured permissions. See [setup](../skills/setup/SKILL.md).

Paths are relative to the working directory unless absolute. When `paths.temp` is unset, the first existing `temp`, `temp-ignore`, or `tmp` is used, otherwise `temp`. Empty `paths.worktrees` resolves to `../<main repository name>-worktree`, shared by linked worktrees.

`status [--plan <path>]` shows the selected plan and latest run. Plans use an explicit `--plan` first, then root `PLAN.md` if present, then `<planning>/PLAN.md`. Decisions and follow-ups prefer `<planning>/DECISIONS.md` and `<planning>/FOLLOWUPS.md`, fall back to existing root files, and use the planning folder for new files.

## Init

`init [--apply]` previews repository setup without writing files. With `--apply`, it creates `docs/`, the configured planning folder, and the detected or configured temp folder with `scripts/`, `logs/`, `scratch/`, `snapshots/`, `backups/`, and `worktree-archive/`. It creates no placeholder files.

It appends a temp ignore entry only when `git check-ignore` says one is needed, preserving existing lines and negations, and ensures ff runtime exclusions in the common git directory. It appends a `Files and folders` block to existing `AGENTS.md`, otherwise existing `CLAUDE.md`, otherwise a new `AGENTS.md`. An existing block is left alone; no second rules file is created. Repeated runs preserve existing content. `doctor` reports whether the block is present and the temp folder is ignored.

## Docs

`docs [--base <ref>]` lists documentation that may need updating, without editing files. The default base is the merge base with the origin default branch, or `HEAD~1` without a remote. It includes tracked changes and non-ignored untracked files.

Add `Covers: cli/**, scripts/*.mjs` within the first 20 lines of a Markdown file under `docs/`. Multiple lines are supported; root-relative globs accept `*`, `**`, and `?`. An unchanged covering doc is printed as `update?  <doc>  for <file>`. Uncovered non-doc paths are counted, with up to 20 listed. Without coverage declarations, changed paths are grouped by top-level folder. Errors are diagnostic only: exit status is always 0. `audit` appends the same update hints without changing its exit status.

## One card

`run <card file> [--timeout-min <n>] [--force]` starts the builder once and then runs the card's `Accept:` commands itself. `Accept: <command>` works on each line, as does one command per line under a bare `Accept:`. Results are in `.ff/runs/<id>/`. Exit 0 means acceptance passed, or the card had none and the run is `unverified`.

## Whole plans

`wait [--timeout-min <n>]` waits for the latest run selected at startup, polling its record and controller about every 5 seconds. There is no timeout by default. It prints the final status and summary path. Exit 0 means complete (`done`), 1 means any other ending, a dead controller, or no run, and 3 means timeout. A timeout does not stop the run. Use it as a host background task to wake the session for closing; without host background tasks, use `status` in a later session.

`run --all [--plan <path>] [--only <T1,T2>] [--timeout-min <n>] [--foreground] [--force] [--dry-run]` runs a plan in the background. The format is in `skills/plan/SKILL.md`. `status` shows where it is, and it needs no host timer.

`run --all --dry-run` previews the current plan: completed tasks, tasks that would run now, and held tasks with their open direction choice, unmet dependencies, or need for a person. Dependencies count as met only when already ticked; the preview does not assume future success. It supports `--plan`, starts no child processes, and writes no run state, locks, branches, or worktrees. No headless builder is required. A successful preview exits 0 even when tasks are held; it does not verify executor availability or run acceptance commands.

Tasks run one at a time in a clean process. PLAN.md is reread before each one, so editing it changes course.

`--only T1,T2` runs and reports only the named tasks. Dependencies are still checked against the full plan; omitted prerequisites are not run automatically. Lead replanning is disabled so it cannot introduce tasks outside the selection. Acceptance, retries, review, and the plan exit condition keep their usual behavior.

`run --all --dry-run --lanes <n>` also previews up to `n` lanes and a serial tail with reasons. Tasks can declare `Files: src/a/**, lib/b.mjs` (commas or spaces, optional backticks) and `Shared: database, port:3000` (comma-separated resource names). Open tasks connected by dependencies, overlapping static file/glob prefixes, or the same shared resource stay together. File comparisons ignore case on Windows. Tasks with no files, high risk, or repository-wide files (root files, manifests, lock files, the plan, or decisions) and tasks connected to them stay in the serial tail.

`run --all --lanes <n>` runs those lanes in separate worktrees with detached child controllers. `run.maxLanes` defaults to 2, with a hard cap of 3. Optional `run.laneSetup` runs a command in each new tree; `run.laneCopy` copies exact relative file paths from the parent. Setup failures go to the serial tail. The parent merges finished lanes one at a time, reruns acceptance, and sends conflicts or integration failures to the serial tail. Clean merged trees are removed, with run evidence archived under the parent run's `lanes/<letter>/runs/`. The summary includes attempts, duration, merge results, and writes outside declared files. `status` lists each lane and its child status. `stop` forwards requests and waits without merging further; children stop their own executors. After a parent crash, repeat `run --all --lanes <n>` to adopt existing children and merge completed lanes without starting duplicate workers; the plan is also re-checked against its snapshot, so a tick left by a process that outlived the parent is undone. A plain `run --all` on such an interrupted run is refused with a pointer to `--lanes` (`--force` runs serially instead). Otherwise, execution without `--lanes` remains serial.

An optional `Executor: codex` (or another configured executor name or `pi:` role) on a task overrides the run's builder. Unknown executors produce a plan note and hold that task, including in dry runs. `roles.fallback` defaults to empty. When set, it runs second attempts only; after a provider limit on a different executor, it becomes the run's default builder. Explicit task overrides still apply. Further limits on the fallback use the wait schedule. Worker prompts use the selected executor's profile, and task reports and summaries name it. `doctor` shows the fallback setting.

- **Truth.** The tool ticks a task, and only after its own run of the task's acceptance commands passes. After every process it undoes new ticks, restores the exit condition, restores the plan if it was damaged or a hold or risk tier was lowered, and lists any other change. If tasks were removed or acceptance changed, the result is `needs review`, not complete. Unparsed task lines also prevent complete.
- **Isolation.** Work on `main`, `master`, or the origin default gets a new `ff/run-*` branch. Uncommitted work is committed there first as a checkpoint. Each passing task is one commit. These are working commits, without hooks or signing, so run your checks before closing the branch. A task that stops has its work kept on `ff/failed/...`, and the tree returns to the last good commit, keeping PLAN.md and DECISIONS.md. If the work cannot be saved, the tree is left alone and the run stops. A process that leaves the run branch has its work parked and counts as failed. The run needs a git identity.
- **Retries.** A task gets two attempts, and the second sees the evidence. An idle timeout kills the process tree and retries the same attempt once without spending it. A second idle timeout counts as a failed attempt with evidence that the process went silent. `BLOCKED: <reason>` from a worker holds that task at once.
- **Review.** Each contract or high task is reviewed against its own diff when reviewers can run headless. A FAIL counts as a failed attempt. Lower tiers and unavailable reviewers are stated in the report. Weakened tests are flagged.
- **Provider limits.** An executor that exits non-zero with a limit message switches to a configured different fallback, or pauses on the `run.limitWaitMinutes` schedule, without using an attempt. When the schedule runs out, the run stops, and `run --all` resumes it.
- **Stuck tasks.** After two failures a clean lead process may narrow or split the task in the plan, at most three times a run. Changes are committed and reported. 
- **Exit condition.** In backticks it is a command, run once every task is done. In prose it is reported as needing an observer.
- **Report.** `.ff/runs/<id>/summary.md` lists each task, plan changes, and every open item in `DECISIONS.md`. A run never pushes, merges, or goes live.

If the controller dies, `run --all` resumes from the last commit: the plan is checked against its snapshot, work in progress is checkpointed, and that task runs again. A live executor from the old run is refused until stopped or `--force` is given. A task that timed out without a confirmed kill stops the run for the same reason.

## Stop

`stop [--timeout-sec <n>]` asks the live background run in this worktree to end. The controller kills its own processes, saves unfinished work on an `ff/failed/...` branch, returns to the run branch, marks the run `stopped`, and frees the worktree. `stop` waits up to 120 seconds and reports the result. A task already committed stays. `stop` never kills a process itself, so a stale pid cannot hit an unrelated process. If the controller is gone, it says so and leaves any surviving process to you.

## Follow-ups

Keep later checks in `<planning>/FOLLOWUPS.md` (existing root `FOLLOWUPS.md` remains supported), one item per line:

```markdown
- [ ] 2026-11-14 Check refund failures since the release. Evidence: `<command>` or where to look.
```

`followups` lists all open items in date order, due ones first, and reports malformed list lines without discarding valid items. `status` lists only items due today or earlier. Dates use the machine's local calendar day. Use a valid `YYYY-MM-DD`, a check description, and nonempty `Evidence:`; tick `[x]` after gathering and reporting evidence. Headings, prose, and fenced examples are ignored. There are no other item states.

When notifications are configured, the shared `SessionStart` hook checks the session's `cwd` and sends the due count and first three items, within the notification text limit. It stays silent on stdout and respects `FF_CHILD`. A repository gets at most one notice per local day across sessions, with deduplication under `~/.ff/notify-state/`. If all channels fail, the next session can retry. The commands work without hooks.

## Notify

`notify` shows which channels are on, and `notify --test` sends a test message. Settings live in `~/.ff/notify.env`, and environment variables override them: `FF_NOTIFY_WEBHOOK`, `FF_TELEGRAM_BOT_TOKEN`, `FF_TELEGRAM_CHAT_ID`, `FF_NOTIFY_MIN_MINUTES` (default 5), and `FF_NOTIFY_LANG` (`en` or `zh`).

`run --all` notifies by itself when a run ends, cannot start, or first pauses on a provider limit. Hosts notify through `hooks/` and `extensions/`. Processes started by `ff` carry `FF_CHILD=1` and stay silent. Hook state lives in `~/.ff/notify-state/`, and entries older than seven days are removed.

## Protect

`protect [--branch <name>]...` installs a `commit-msg` hook in the path git reports, so `core.hooksPath` and worktrees work. It refuses to replace a hook it did not write. `protect --status` and `protect --remove` do what they say. `FF_ALLOW_MAIN=1` overrides it for one commit.

## Archive

`archive [--plan <path>] [--force]` moves `PLAN.md` into `<planning>/done/PLAN-YYYY-MM-DD.md`, creating the directory. The date is UTC. Existing archives are preserved by adding `-2`, `-3`, and so on before `.md`.

Unticked tasks in the plan's `Tasks` section prevent archiving, with a message explaining `--force`. Task parsing uses the same plan format as `run --all`. `--force` archives unfinished plans too. `--plan <path>` selects another plan, relative to the current working directory or absolute; the destination remains the current worktree's `<planning>/done/`.

## Cleanup

`cleanup [--apply] [--keep <n>] [--days <n>]` previews old entries in `.ff/runs`, `.ff/reviews`, and `.ff/councils`. In each directory it keeps the newest 20 entries by modification time and only removes entries older than 30 days. Configure `cleanup: { keep, days }` or override either value with a non-negative integer flag. `--apply` performs the deletions and reports entry counts, branch counts, and file bytes freed.

Live runs and surviving executors are preserved. Names containing `backup`, `bak`, or `备份`, including nested names, protect the whole entry. Linked entries and linked cleanup directories are skipped with diagnostics; paths outside the three directories are never deleted. A failed item does not stop other items.

Local `ff/*` branches use the same merged proof as `wt clean` below, including squash merges. With `--apply`, checked-out branches are kept and other proven branches are deleted with `git update-ref -d` against the proven tip, so a changed tip is not deleted. Unproven branches, including `ff/failed/*`, are listed and kept.

## Worktrees

`wt new <slug> [--from <ref>]` fetches configured remotes, then creates `<worktreeRoot>/<slug>` on a new branch named `<slug>`. It starts from the origin default branch, falling back to local `main` or `master`, or the explicit `--from` ref. An existing path or branch is refused. The new path is printed. `paths.worktrees` controls the root; the default is shared across linked worktrees.

`wt list` lists every worktree with its branch, head, dirty/clean state and merged proof. `*` marks paths under the configured worktree root.

`wt clean [--apply]` previews by default. It only removes worktrees under that root, excluding the main and current worktrees. Tracked changes, non-ignored untracked files, and live processes in `.ff/runs/**/run.json` keep a worktree. A merged PR with an exact matching head SHA proves a squash merge; otherwise ancestry against the origin default (or local default) proves a merge. Without a remote, identical trees also count. Missing or failed `gh` queries are reported and Git proofs still run.

Before removal, ignored files move to `<temp>/worktree-archive/<slug>/`, preserving relative paths. Backup names (`backup`, `bak`, `备份`), secrets (`.env`, `.env.*`, `*.pem`, `*.key`, `credentials*`), linked paths and archive collisions are listed and left in place, keeping that worktree. Removal uses `git worktree remove` without force, deletes the branch only at the proven tip, then prunes worktree metadata. Each kept worktree has a reason; a failed item does not stop the others.

## Review

`review --base <ref> --risk micro|routine|contract|high [--panel] [--round <n>] [--plan <path>] [--timeout-min <n>]` starts one read-only process per reviewer, over the tracked and untracked diff.

Micro has no reviewers. Routine uses `roles.reviewer`. Contract and high add `roles.second` if it is set. `review.panel` replaces the list at those tiers, or at any tier with `--panel`.

Read-only comes from `reviewArgs`, or automatically for `codex`, `claude`, and `pi:` roles. Other executors must enforce it themselves, and ff warns. Secrets are redacted from the prompt and the stored outputs. Reviewers see the first 96 KiB of a diff, and larger ones are reported as partly reviewed.

An idle timeout marks the reviewer `failed` and keeps a FAIL it already printed; a PASS does not count. Known sandbox crash signatures in stdout or stderr do the same, with the reason recorded; signatures already in the prompt are ignored to avoid treating prompt echoes as crashes. The verdict is the last `VERDICT:` line. A PASS beside a BLOCKER or HIGH line, a failed process, or truncated output is not a pass. Exit 1 means a reviewer said FAIL, 2 means no usable verdict, 3 means the review needs a host sub-agent. Outputs are in `.ff/reviews/<id>/`.

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
