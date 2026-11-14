# ff CLI

Requires Node 22 or newer. No runtime dependencies. Commands use the current working directory as the worktree.

```
node cli/ff.mjs doctor
node cli/ff.mjs agents --apply
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

`~/.ff/config.json` merges with the project's `.ff/config.json`. Missing values use defaults, and unknown keys warn. Roles and builder executors retain project overrides. Review and council executors use only built-in defaults merged with `~/.ff/config.json`; project `executors` never change their commands, arguments, or other settings. Put custom reviewer executors in the user config, as in the example below.

```json
{
  "roles": { "builder": "codex", "reviewer": "claude", "second": "", "fallback": "", "consult": "" },
  "executors": {
    "mine": { "cmd": "mytool --headless", "profile": "generic", "reviewArgs": ["--read-only"] }
  },
  "review": { "panel": [] },
  "paths": { "planning": "planning", "temp": "temp", "worktrees": "" },
  "cleanup": { "keep": 20, "days": 30 },
  "run": { "limitWaitMinutes": [5, 15, 30, 60, 60, 60, 60, 60, 60, 60] },
  "agents": { "sync": true },
  "playbook": "~/.ff/my-rules.md"
}
```

`agents.sync` (default `true`) lets `run`, `review`, and `doctor` write the Codex agent files described under [Agents](#agents). Set it to `false` to keep the automatic sync off; `agents --apply` still works by hand.

- A role is an executor name, `pi:<vendor>/<model>:<effort>`, `opencode:<provider>/<model>`, or `host` (the current session, which cannot run unattended).
- `claude` and `codex` are built-in executors. Their commands are in `cli/lib/config.mjs`. A user config entry of the same name overrides them everywhere; a project entry overrides them only for builders.
- `cmd` is an executable plus arguments, or an array. It is not a shell program. The prompt arrives on stdin and ends with the path of the report file. The executable must wait for its children.
- `idleMinutes` limits silence on stdout and stderr for that executor, including reviewers. Codex defaults to 10 minutes; Claude and `pi:` roles have no idle limit. Unset custom limits and zero disable it. Output resets the timer; the overall task timeout still applies.
- `profile` is `generic`, `gpt`, or `claude`, matching `playbook/executors/`.

Project `executors` produce one warning per config read explaining this boundary. A review or council member defined only in the project is recorded as `absent`, with instructions to move its executor to `~/.ff/config.json`. `doctor` lists project executor names and notes that review and council ignore those definitions. Lane child controllers receive the user executor table through `FF_LANE_CONFIG` alongside the merged builder configuration.

ff does not take review or council commands and arguments from repository configuration. Its automatic Claude reviewer arguments include `--restricted --strict-mcp-config`, which load no user, project, or local `.claude/settings*.json` (so no repository hooks, allow rules, or bypass modes) and no MCP servers; see Review below. User-configured `reviewArgs` still take priority. OpenCode, Pi, Codex, and other reviewer tools may still load repository project configuration, plugins, or extensions themselves, so inspect the repository for these files before reviewing untrusted code. This does not make `ff run` safe in an untrusted repository: builders still use project executors, and the plan's `Accept:` commands are executed.

OpenCode builders and reviewers receive a stored prompt through `--file`, with `--dir` set to the project root, and no stdin prompt. `doctor` lists `opencode models` and infers their families from model names before falling back to providers. Reviews use a process-local `ff-review` agent via `OPENCODE_CONFIG_CONTENT`, allowing only read, grep, glob, and list. This uses the OpenCode V1 config format and replaces any inherited inline config for that reviewer, without writing user configuration. No agent installation is required; an unavailable agent is reported as failed and its verdict discarded. Builders retain their configured permissions. See [setup](../skills/setup/SKILL.md).

Paths are relative to the working directory unless absolute. When `paths.temp` is unset, the first existing `temp`, `temp-ignore`, or `tmp` is used, otherwise `temp`. Empty `paths.worktrees` resolves to `../<main repository name>-worktree`, shared by linked worktrees.

`status [--plan <path>]` shows the selected plan and latest run. If an explicit `--plan` differs from the latest run's plan, it prints that run's plan path and does not use its task or lane states for the selected plan. Equivalent relative and absolute paths still match. Plans use an explicit `--plan` first, then the latest run's plan when recorded, then root `PLAN.md` if present, then `<planning>/PLAN.md`. Decisions and follow-ups prefer `<planning>/DECISIONS.md` and `<planning>/FOLLOWUPS.md`, fall back to existing root files, and use the planning folder for new files.

When there is something to clean, `status` ends with one line such as `Cleanup: 2 merged worktrees, 3 merged ff/* branches, 1 failed branch older than 30 days. Run ff wt clean and ff cleanup to see them.` It counts clean managed worktrees and `ff/*` branches whose tip is in the default branch, `ff/failed/*` branches with no commit in 30 days, and `.ff` records beyond retention. It uses local git only, never fetches or calls `gh`, checks all `ff/*` branches with one `git for-each-ref --merged`, and any error in the count is skipped silently.

## Agents

The Claude Code plugin ships two read-only sub-agents from `agents/`, loaded as `ff:ff-review` and `ff:ff-diagnose`. Codex cannot load agents from a plugin, so `agents [--apply]` writes the same two as `~/.codex/agents/ff_review.toml` and `ff_diagnose.toml` (`CODEX_HOME` is honored). Each file has `name`, `description`, and `developer_instructions` built from the matching playbook file (`playbook/review.md` or `playbook/diagnose.md`), the read-only rule, and the output format. The first line is `# Managed by Forge Flow <version>. Remove this line to keep your own edits.`

Without `--apply` the command previews. `run`, `run --all`, `review`, and `doctor` sync at their start as if `--apply` were given, and print one line per file they write; a sync failure is one warning and never changes the command's result. Nothing happens when `~/.codex` does not exist. A missing file is created; a file with the marker and a different version or content is rewritten; a file without the marker is yours and is left alone, with one notice. Writes are atomic, go only into `~/.codex/agents/`, and skip a linked `~/.codex` or `agents` directory or file. A missing playbook file produces an agent without that section and a warning.

A Codex agent inherits the session's permissions, so its read-only rule is an instruction, not an enforcement. A review that must be enforced read-only still goes through `review`, which adds read-only arguments for built-in executors. `doctor` shows each file as `synced`, `outdated`, `user-owned`, or `missing`, or that Codex is not installed.

## Init

`init [--apply]` previews repository setup without writing files. With `--apply`, it creates `docs/`, the configured planning folder, and the detected or configured temp folder with `scripts/`, `logs/`, `scratch/`, `snapshots/`, `backups/`, and `worktree-archive/`. It creates no placeholder files.

It appends a temp ignore entry only when `git check-ignore` says one is needed, preserving existing lines and negations, and ensures ff runtime exclusions in the common git directory. It appends a `Files and folders` block to existing `AGENTS.md`, otherwise existing `CLAUDE.md`, otherwise a new `AGENTS.md`. The block reminds agents to reread the plan and run `ff status` after compaction or resume. An existing block is left alone; no second rules file is created. Repeated runs preserve existing content. `doctor` reports whether the block is present and the temp folder is ignored.

## Docs

`docs [--base <ref>]` lists documentation that may need updating, without editing files. The default base is the merge base with the origin default branch, or `HEAD~1` without a remote. It includes tracked changes and non-ignored untracked files.

Add `Covers: cli/**, scripts/*.mjs` within the first 20 lines of a Markdown file under `docs/`. Multiple lines are supported; root-relative globs accept `*`, `**`, and `?`. An unchanged covering doc is printed as `update?  <doc>  for <file>`. Uncovered non-doc paths are counted, with up to 20 listed. Without coverage declarations, changed paths are grouped by top-level folder, followed by a one-line suggestion to add a `Covers:` line with an example. Errors are diagnostic only: exit status is always 0. `audit` appends the same update hints without changing its exit status.

`run --all` uses the same check before it commits a passed task: each task card asks the worker to update any doc under `docs/` its change makes out of date, and if a covering doc was left untouched the task row carries `docs may need an update: <doc>`. This is a hint only; the commit still happens, and projects without `Covers:` lines get no hint. Each row is checked when its task commits, so an earlier row can still name a doc that a later task updated; read the doc as it stands at the end of the run before acting on the hint.

## One card

`run <card file> [--timeout-min <n>] [--force]` starts the builder once and then runs the card's `Accept:` commands itself. `Accept: <command>` works on each line, as does one command per line under a bare `Accept:`. Results are in `.ff/runs/<id>/`. Exit 0 means acceptance passed, or the card had none and the run is `unverified`.

## Whole plans

`wait [--timeout-min <n>]` waits for the latest run selected at startup, polling its record and controller about every 5 seconds. There is no timeout by default. It prints the final status and summary path. Exit 0 means complete (`done`), 1 means any other ending, a dead controller, or no run, and 3 means timeout. A timeout does not stop the run. Use it as a host background task to wake the session for closing; without host background tasks, use `status` in a later session.

While waiting, it registers its PID and start time in `.ff/runs/<id>/watchers/<pid>.json`, removing the file on return, timeout or error, and attempting cleanup on SIGINT/SIGTERM. A confirmed live waiter suppresses `run-done` ("Run finished" / 「后台运行完成」). `run-failed` ("Run did not finish" / 「后台运行未完成」) and `run-paused` ("Run paused" / 「后台运行已暂停」) still notify. Dead or unknown watcher PIDs do not suppress completion.

`run --all [--plan <path>] [--only <T1,T2>] [--timeout-min <n>] [--foreground] [--force] [--dry-run]` runs a plan in the background. The format is in `skills/plan/SKILL.md`. `status` shows where it is, and it needs no host timer.

`run --all --dry-run` previews the current plan: completed tasks, tasks that would run now, and held tasks with their open direction choice, unmet dependencies, or need for a person. Dependencies count as met only when already ticked; the preview does not assume future success. It supports `--plan`, starts no child processes, and writes no run state, locks, branches, or worktrees. No headless builder is required. A successful preview exits 0 even when tasks are held; it does not verify executor availability or run acceptance commands.

Tasks run one at a time in a clean process. PLAN.md is reread before each one, so editing it changes course.

Plan-level and task-level `Risk:` fields accept only `micro`, `routine`, `contract`, or `high` (case-insensitive), optionally followed by `. <reason>`. Unknown values are treated as `high` and add a plan note; they do not hold tasks, but the note prevents the run from being marked complete. Rewrite unknown values before rerunning. An omitted task risk inherits the plan risk, which defaults to `routine` when omitted.

`--only T1,T2` runs and reports only the named tasks. Dependencies are still checked against the full plan; omitted prerequisites are not run automatically. Lead replanning is disabled so it cannot introduce tasks outside the selection. Acceptance, retries, review, and the plan exit condition keep their usual behavior.

`run --all --dry-run --lanes <n>` also previews up to `n` lanes and a serial tail with reasons. Tasks can declare `Files: src/a/**, lib/b.mjs` (commas or spaces, optional backticks) and `Shared: database, port:3000` (comma-separated resource names). Open tasks connected by dependencies, overlapping static file/glob prefixes, or the same shared resource stay together. File comparisons ignore case on Windows. Tasks with no files, high risk, or repository-wide files (root files, manifests, lock files, the plan, or decisions) and tasks connected to them stay in the serial tail.

`run --all --lanes <n>` runs those lanes in separate worktrees with detached child controllers. `run.maxLanes` defaults to 2, with a hard cap of 3. Optional `run.laneSetup` runs a command in each new tree; `run.laneCopy` copies exact relative file paths from the parent. Setup failures go to the serial tail. The parent merges finished lanes one at a time, reruns acceptance, and sends conflicts or integration failures to the serial tail. Clean merged trees are removed, with run evidence archived under the parent run's `lanes/<letter>/runs/`. The summary includes attempts, duration, merge results, and writes outside declared files. `status` lists each lane and its child status. `stop` forwards requests and waits without merging further; children stop their own executors. After a parent crash, repeat `run --all --lanes <n>` to adopt existing children and merge completed lanes without starting duplicate workers; the plan is also re-checked against its snapshot, so a tick left by a process that outlived the parent is undone. A plain `run --all` on such an interrupted run is refused with a pointer to `--lanes` (`--force` runs serially instead). Otherwise, execution without `--lanes` remains serial.

An optional `Executor: codex` (or another configured executor name or `pi:` role) on a task overrides the run's builder. Unknown executors produce a plan note and hold that task, including in dry runs. `roles.fallback` defaults to empty. It handles provider limits only: after a limit on a different executor, it becomes the run's default builder. It never takes over a retry; retries go to the same builder with a diagnosis. Explicit task overrides still apply. Further limits on the fallback use the wait schedule. Worker prompts use the selected executor's profile, and task reports and summaries name it. `doctor` shows the fallback setting.

- **Truth.** The tool ticks a task, and only after its own run of the task's acceptance commands passes. After every process it undoes new ticks, restores the exit condition, restores the plan if it was damaged or a hold or risk tier was lowered, and lists any other change. If tasks were removed or acceptance changed, the result is `needs review`, not complete. Unparsed task lines also prevent complete.
- **Isolation.** Work on `main`, `master`, or the origin default gets a new `ff/run-*` branch. Uncommitted work is committed there first as a checkpoint. Each passing task is one commit. These are working commits, without hooks or signing, so run your checks before closing the branch. A task that stops has its work kept on `ff/failed/...`, and the tree returns to the last saved checkpoint, keeping PLAN.md and DECISIONS.md. That checkpoint may contain merged lane code that failed acceptance after merging. Such tasks keep the pre-merge and merge commits in `run.json`; if they remain unfinished after serial retries, the summary names them, cites the merge, and identifies the pre-merge commit to reset to. Resetting also drops the rest of that lane merge and every later commit. If the work cannot be saved, the tree is left alone and the run stops. A process that leaves the run branch has its work parked and counts as failed. The run needs a git identity.
- **Retries.** A task gets at most three attempts per pass through the ladder below. After the first failure (acceptance, review FAIL, or a second idle timeout; not BLOCKED or a provider limit), a read-only `roles.reviewer` process diagnoses it with `playbook/diagnose.md`: the task card, the evidence, and the attempt's file inventory and the path of its full patch, always saved beside the prompt (no diff is inlined). The last `DIAGNOSIS:` line decides, tolerating bold markup, leading whitespace and trailing punctuation; no readable line counts as UNCLEAR. SLIP: the same builder retries with the evidence and the diagnosed fix in its card. ENVIRONMENT: the task is held with the diagnosed reason. SPEC: the work is parked and the lead replans at once. If the diagnosis is unavailable (reviewer is `host`, no executor, process failure, or timeout), the retry proceeds with the evidence alone and the task row says `diagnosis unavailable`. The redacted diagnosis is saved to `.ff/runs/<id>/<task>-diagnosis-<attempt>.md` and the task row names its result, such as `diagnosed: slip (<path>)`.
- **Consult.** Optional `roles.consult` (empty by default; resolved like a reviewer from built-in and `~/.ff/config.json` executors, `pi:` and `opencode:` forms included) runs the same read-only diagnosis with the lead's diagnosis as extra input, at most twice per run, when the lead said UNCLEAR or when a retry made after a SLIP diagnosis failed again. Its conclusion is handled the same way; a SLIP gives the same builder one more attempt with the consult's fix: the second attempt after an UNCLEAR diagnosis, the third after a SLIP retry that failed. An UNCLEAR path therefore ends after two attempts, and only SLIP, failed retry, consult SLIP reaches a third. The two-consult cap counts the whole run, lane children included: each consult claims a numbered file under the parent run's `.ff/runs/<id>/consults/`. The record goes to `.ff/runs/<id>/<task>-consult-<attempt>.md`. Without a consult, with the consults used up, or with an unavailable consult, the task is parked and the lead replans. Task rows show the ladder, such as `diagnosed: slip (...); consulted: slip (...); 3 attempts` or `diagnosed: unclear (...); consulted: slip (...); 2 attempts`. `doctor` shows the consult setting and whether its tool is available. An idle timeout kills the process tree and retries the same attempt once without spending it. A second idle timeout counts as a failed attempt with evidence that the process went silent. `BLOCKED: <reason>` from a worker holds that task at once.
- **Review.** Each contract or high task is reviewed against its own diff when reviewers can run headless. A FAIL counts as a failed attempt unless `roles.reviewer` gave a usable PASS and rejects the other members' FAIL findings in a fresh read-only adjudication. A lead FAIL, or a lead without a usable PASS, keeps the usual failed attempt. The lead gives each finding block or reject, a confidence (`high` or `low`), and a reason, then a `## For the user` section listing, one line each, findings it rejected with low confidence and findings it did not block but thinks are worth checking, or `None.`. The last `ADJUDICATION:` line supplies the conclusion, allowing bold markup, leading whitespace, trailing punctuation, and closing prose on later lines. Adjudication BLOCK, failure, timeout, or an unparseable conclusion also counts as a failed attempt, with the adjudication and original findings redacted and passed to the retry. Saved adjudication files include failure diagnostics. REJECT permits the usual commit, labels the task `second-family FAIL rejected by lead`, and saves the decision to `.ff/runs/<id>/<task>-adjudication.md`; `summary.md` lists the lead's `For the user` lines per task, with the adjudication path, under `## Needs your look` right after the status lines; high-confidence rejections the lead did not list stay only in the adjudication file. A missing or unreadable `For the user` section, or `None.` there while the adjudication rejects a finding with low confidence, lists every rejected finding there, with a note. The notification gives the count, such as `2 review items need your look (T1).`, and the `auto` and `build` skills copy each item into the session's final report. Manual `ff review` keeps its exit codes and does not adjudicate. Task rows show usable PASS results out of the dispatched reviewers, such as `reviewed 1/2 (second: absent)`, and name each member without a usable conclusion and its status. Lower tiers and unavailable reviewers are stated in the report. Files a reviewer says it did not read show as `not read: <n> files (<member>)` on the task row. Weakened tests are flagged.
- **Provider limits.** An executor that exits non-zero with a limit message switches to a configured different fallback, or pauses on the `run.limitWaitMinutes` schedule, without using an attempt. When the schedule runs out, the run stops, and `run --all` resumes it.
- **Stuck tasks.** When the ladder ends without a pass (a SPEC diagnosis, an unclear failure with no consult, or a failed last attempt), a clean lead process may narrow or split the task in the plan, at most three times a run. The lead runs on `roles.reviewer`'s executor with write access, falling back to the builder when the reviewer cannot run headless; `lead-<task>/executor.txt` names it. Its card lists the diagnosis and consult record paths. Only its plan and decisions edits are kept; changes are committed and reported. When the lead edits the plan, the stuck task and every task it changed or added start the ladder again with fresh attempts, so one task can run up to six attempts in a run; the lead reviews each task at most once.
- **Exit condition.** In backticks it is a command, run once every task is done. A prose condition does not change a successful run's `done` status, exit code 0, or `done` notification type. The summary says `Status: complete; the exit condition needs a person to check.` and includes the original condition; the notification says all tasks passed and asks you to confirm that condition.
- **Report.** `.ff/runs/<id>/summary.md` lists each task, plan changes, and every open item in `DECISIONS.md`. A run never pushes, merges, or goes live.
- **Timing hints.** Each acceptance command records its `durationMs`, and the exit condition its own. The summary adds advisory lines that never change the status or exit code: when every task passed its own acceptance but the exit condition failed, it says so and suggests moving that check earlier; when a task's acceptance took over 10 minutes or the exit condition over 30, it lists them under `Slow checks:` and points to "When to review the test process" in the `ci-and-tests` pack. `FF_SLOW_ACCEPT_MINUTES` and `FF_SLOW_EXIT_MINUTES` override the thresholds, mainly for tests.

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

Run events have distinct titles from session completion:

| Event | English title | Chinese title |
|---|---|---|
| `run-done` | Run finished | 后台运行完成 |
| `run-failed` | Run did not finish | 后台运行未完成 |
| `run-paused` | Run paused | 后台运行已暂停 |

If a session is waiting through `ff wait`, a confirmed live watcher for that run suppresses `run-done`; failure and pause notices still send. Dead or unknown watcher PIDs are ignored. An interrupted run detected at session start uses `run-failed`. Session hook events and titles, including `done` ("Finished" / 「任务完成」), are unchanged.

Turn hooks mark a notice before sending so overlapping Stop and idle_prompt events do not send twice. If every channel fails, the previous marker is restored so a later idle_prompt can retry; an intervening turn or notice keeps its newer state. One successful channel keeps the turn reported.

## Protect

`protect [--branch <name>]...` installs a `commit-msg` hook in the path git reports, so `core.hooksPath` and worktrees work. It refuses to replace a hook it did not write. `protect --status` and `protect --remove` do what they say. `FF_ALLOW_MAIN=1` overrides it for one commit.

## Archive

`archive [--plan <path>] [--force]` moves `PLAN.md` into `<planning>/done/PLAN-YYYY-MM-DD.md`, creating the directory. The date is UTC. Existing archives are preserved by adding `-2`, `-3`, and so on before `.md`.

Unticked tasks in the plan's `Tasks` section prevent archiving, with a message explaining `--force`. Task parsing uses the same plan format as `run --all`. `--force` archives unfinished plans too. `--plan <path>` selects another plan, relative to the current working directory or absolute; the destination remains the current worktree's `<planning>/done/`.

## Cleanup

`cleanup [--apply] [--keep <n>] [--days <n>]` previews old entries in `.ff/runs`, `.ff/reviews`, and `.ff/councils`. In each directory it keeps the newest 20 entries by modification time and only removes entries older than 30 days. Configure `cleanup: { keep, days }` or override either value with a non-negative integer flag. `--apply` performs the deletions and reports entry counts, branch counts, and file bytes freed.

Live runs and surviving executors are preserved. Names containing `backup`, `bak`, or `备份`, including nested names, protect the whole entry. Linked entries and linked cleanup directories are skipped with diagnostics; paths outside the three directories are never deleted. A failed item does not stop other items.

Local `ff/*` branches use the same merged proof as `wt clean` below, including squash merges. With `--apply`, checked-out branches are kept and other proven branches are deleted with `git update-ref -d` against the proven tip, so a changed tip is not deleted. Unproven branches, including `ff/failed/*`, are listed and kept.

Three kinds of items are listed only, in preview and with `--apply`, and never deleted: local branches outside `ff/` whose tip is already in the default branch, judged by local ancestry only with no `gh` call (excluding the default branch and branches checked out in a worktree); `ff/failed/*` branches whose last commit is older than 30 days, with that date; and entries under the temp folder with no change in 30 days, with their size. A temp entry is a second-level folder such as `temp/scripts/<task>` or `temp/worktree-archive/<slug>`, or a top-level folder without subfolders. `backups/` and any path with a backup name are never listed. The closing line counts listed items separately.

## Worktrees

`wt new <slug> [--from <ref>]` fetches configured remotes, then creates `<worktreeRoot>/<slug>` on a new branch named `<slug>`. It starts from the origin default branch, falling back to local `main` or `master`, or the explicit `--from` ref. An existing path or branch is refused. The new path is printed. `paths.worktrees` controls the root; the default is shared across linked worktrees.

`wt list` lists every worktree with its branch, head, dirty/clean state and merged proof. `*` marks paths under the configured worktree root.

`wt clean [--apply]` previews by default. It only removes worktrees under that root, excluding the main and current worktrees. Tracked changes, non-ignored untracked files, and live processes in `.ff/runs/**/run.json` keep a worktree. A merged PR with an exact matching head SHA proves a squash merge; otherwise ancestry against the origin default (or local default) proves a merge. Without a remote, identical trees also count. Missing or failed `gh` queries are reported and Git proofs still run. A worktree on a detached HEAD has no branch and no PR, so only ancestry of the default branch proves it; the same cleanliness, process, and path rules apply, and no branch is deleted for it. A worktree with an operation in progress (rebase, merge, cherry-pick, revert, or bisect) is kept, and so is a detached worktree whose HEAD reflog holds commits no ref reaches; the `Kept` line says which. Status checks use `git --no-optional-locks status`, so they never take another worktree's index lock.

Before removal, ignored files move to `<temp>/worktree-archive/<slug>/`, preserving relative paths. Backup names (`backup`, `bak`, `备份`), secrets (`.env`, `.env.*`, `*.pem`, `*.key`, `credentials*`), linked paths and archive collisions are listed and left in place, keeping that worktree. Removal uses `git worktree remove` without force, deletes the branch only at the proven tip, then prunes worktree metadata. Each kept worktree has a reason; a failed item does not stop the others.

## Review

`review --base <ref> --risk micro|routine|contract|high [--panel] [--round <n>] [--plan <path>] [--findings <file>] [--brief <file>] [--timeout-min <n>]` starts one read-only process per reviewer, over the tracked and untracked change.

Micro has no reviewers. Routine uses `roles.reviewer`. Contract and high add `roles.second` if it is set. `review.panel` replaces the list at those tiers, or at any tier with `--panel`.

For fix rounds, the lead passes its adjudicated findings with `--findings <file>`. The file is resolved from the working directory, redacted and bounded by the existing 24 KiB context limit, then included in a separate prompt section. Reviewers must verify each finding is fixed and also check for new problems introduced by the fix diff. A missing file reports an error and exits 2. Findings are never looked up automatically from previous reviews. The lead chooses the reviewer through configuration; the CLI does not automatically select the finder.

`--brief <file>` is the lead's brief for the reviewers: purpose, what changed, interfaces touched, and what to look at first. It is resolved, redacted, and bounded like `--findings`, and a missing file also exits 2. The lead writes one for contract and high reviews.

Read-only comes from user-configured `reviewArgs`, or automatically for `codex`, `claude`, `pi:`, and `opencode:` roles. Other executors must enforce it themselves, and ff warns. Secrets are redacted from the prompt and the stored outputs. The same read-only process serves reviews, adjudication, diagnosis, consult, and council.

- **Claude** reviewers get `--restricted --tools Read,Grep,Glob,Bash --permission-mode dontAsk --strict-mcp-config`. They can run read-only shell commands such as `git log`, `git show`, `git blame`, `git diff`, and `cat`: Claude Code's built-in read-only command set runs without rules, and `dontAsk` denies anything that would need approval, including writes, output redirection, and compound commands with any writing part. `--restricted` (Claude Code 2.1.248 or later) loads no user, project, or local settings, so no allow rule or bypass mode can widen this. From the executor's own command ff keeps only `-p`/`--print`, `--verbose`, `--no-session-persistence`, `--include-partial-messages`, `--model`, `--effort`, `--fallback-model`, `--output-format`, `--input-format`, `--append-system-prompt`, and `--max-budget-usd`; everything else is dropped, including tool grants such as the built-in builder command's `--allowedTools ... Bash`, permission modes, plugins, agents, MCP config, positionals, and anything after a `--`. Because `--restricted` also ignores your settings file, ff reads `$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json` and then each `--settings` file or JSON the executor command gave, and passes on only `env`, `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `gcpAuthRefresh`, and `proxyAuthHelper` (later sources win; `env` merges per key) in one generated settings file, so Bedrock, Vertex, proxy, and helper-based logins and a `claude --settings glm.json` second family reach the same provider. That file is written with mode 0600 to a temporary directory for the one run and removed afterwards, so its values are not in the command line or `summary.json`. `permissions`, `hooks`, `defaultMode`, plugins, MCP servers, and status lines are never passed. An executor `--settings` that cannot be read makes the member absent with the reason, instead of silently reviewing on another provider. `model` and `effortLevel` from the same sources become `--model` and `--effort` unless the command names them; the review table shows that model. If Claude Code rejects `--restricted` as an unknown option, the member is rerun once with file tools only (`--tools Read,Grep,Glob --permission-mode plan --setting-sources user --strict-mcp-config`) and noted `claude has no --restricted; reviewed with read-only file tools only`.
- **Codex** reviewers run in its `--sandbox read-only` and may use shell commands inside it.
- **Pi** reviewers get `--no-extensions -e <ff>/cli/pi/git-read.ts --tools read,grep,find,ls,git_read`, after the provider, model, and thinking flags. `--no-extensions` turns off discovered and package extensions, including ff's own; the explicit `-e` loads only the `git_read` tool, which lives outside the package's auto-loaded `extensions/` folder, so ordinary Pi sessions never get it. `git_read` takes git arguments as an array and runs git without a shell, in the session's directory. It allows the subcommands `log`, `show`, `blame`, `diff`, `ls-files`, `grep`, `rev-parse`, and `cat-file -p|-t|-s`, and only listed options for each; anything else is refused, including `--output`/`-o`, `--ext-diff`, `--textconv`, `-c`, `-C`, `--exec`, `--upload-pack`, `--no-index`, `--open-files-in-pager`/`-O`, and `--show-signature`. Short options with attached text are refused unless git reads that text as the option's value, because git bundles short options. A value given to a value-taking option (`-S`, `-L`, `-e`, ...) is refused when it looks like a refused option, and `--format`/`--pretty` strings with a `%G` placeholder (signature verification) are refused. Every run adds `--no-pager`, `--no-ext-diff` and `--no-textconv` where they apply, `GIT_OPTIONAL_LOCKS=0`, `GIT_NO_LAZY_FETCH=1` (Git 2.44+), the empty tree of the repository's hash (SHA-1 or SHA-256) as `GIT_ATTR_SOURCE` (Git 2.40+), and, through `GIT_CONFIG_COUNT`, settings that turn off `core.fsmonitor` and `log.showSignature`, point `gpg.program`, `gpg.openpgp.program`, `gpg.x509.program`, and `gpg.ssh.program` at a program name that does not exist, and empty every configured clean, smudge, or process filter. These cover the known ways a read starts a program from repository config; they are not a sandbox. Reading the filter list and the hash format is bounded by a 10-second timeout and the tool's abort signal; if the filter list cannot be read, git is not run. Output is capped at 256 KiB with a note saying it was truncated.
- **OpenCode** reviewers keep file tools only (read, grep, glob, list).

Prompts for reviews, adjudication, and diagnosis say that read-only git commands (log, show, blame, diff) or the `git_read` tool may be used, whichever the tools provide, give the base ref, and note that uncommitted and untracked changes are only in the patch file.

Reviewers get a brief, not the diff. Before any reviewer starts, ff writes the redacted full change, tracked and non-ignored untracked, to `.ff/reviews/<id>/diff.patch`, with the complete file inventory at the top. The prompt carries the task scope or plan, the optional `--brief`, a sorted inventory (one line per file: added, deleted, renamed, copied, modified, or type changed, with `+added -removed` lines; at most 200 lines, then `and N more files`), the absolute patch path, and the note that the working tree is readable. No diff is inlined, whatever the size. Reviewers read the hunks they need from the patch and the surrounding code from the files. The patch is capped at 16 MiB: tracked content beyond that keeps a prefix with an omission notice, and an untracked file over 1 MiB, or past the cap, is listed by path only for the reviewer to read from the working tree. Binary files appear as Git's binary notice and are not counted. No unredacted patch is written.

Before its verdict, each reviewer writes `Not read:` with the changed files it did not read, or `Not read: none`. The list is stored per member in `summary.json` as `notRead` with `notReadCount`, printed after the result table, and shown on `run --all` task rows as `not read: <n> files (<member>)`. A partial gap is an annotation only. A member whose list covers every changed file, or says `all`, `everything`, or the like, has read nothing: `summary.json` marks it `notReadAll`, its PASS becomes `unknown` with a warning (a FAIL stays a FAIL), and exit codes follow, so a review with no other usable PASS exits 2. In `run --all` the task row says `not read: all <n> files (<member>)`, and the member is listed under `## Needs your look` and counted in the notification.

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
