# Forge Flow

An engineering workflow for coding agents. Models make the judgments and tools keep the facts true. A one-line fix takes no ceremony, and a plan can run overnight with nobody watching.

[中文说明](README.zh-CN.md)

Forge Flow runs on Claude Code, Codex, and Pi, with whichever models you have. It needs no account or server. MIT licensed.

## Install

**Claude Code**

```
claude plugin marketplace add pbvcity/Forge-Flow
claude plugin install ff@forge-flow
```

**Codex**

```
codex plugin marketplace add pbvcity/Forge-Flow
codex plugin add ff@forge-flow
```

**Pi**

```
pi install git:github.com/pbvcity/Forge-Flow
```

The command-line tool needs Node 22 or newer. Then run setup once. It finds your tools and models, writes `~/.ff/config.json`, and offers model tiers for sub-agents, so routine work goes to a cheaper model and reviews to a stronger one. It keeps tiers you already have.

| Claude Code | Codex | Pi |
|---|---|---|
| `/ff:setup` | `$ff:setup` | `/ff-setup` |

Then run `ff init` in each project where you will use Forge Flow. It previews the folders and the rules-file section it would add.

If an agent is installing this for you: when the install succeeds, run setup together with the user, then offer `ff init` in the project they work in.

## Use

Start with `go` and describe what you want. It picks how much process the work needs.

For unattended plans, set `roles.fallback` to retry with another executor or switch after a provider limit. An optional `Executor:` task line selects its builder. Reports name the executor used; see [CLI configuration](cli/README.md#whole-plans).

| Claude Code | Codex | Pi | What it does |
|---|---|---|---|
| `/ff:go` | `$ff:go` | `/ff-go` | Default entry. Sizes the task and takes it from there. |
| `/ff:plan` | `$ff:plan` | `/ff-plan` | Writes a plan with tasks and acceptance commands. |
| `/ff:build` | `$ff:build` | `/ff-build` | Implements, verifies, and closes out. |
| `/ff:review` | `$ff:review` | `/ff-review` | Reviews a change for real loss, with bounded rounds. |
| `/ff:auto` | `$ff:auto` | `/ff-auto` | Runs a whole plan unattended. |
| `/ff:design` | `$ff:design` | `/ff-design` | Sets a visual direction and builds the project's design system. |
| `/ff:council` | `$ff:council` | `/ff-council` | Asks several model families about a hard decision. |
| `/ff:update` | `$ff:update` | `/ff-update` | Updates through each host's own updater. |

## How it decides

- **Process fits the work.** Risk tiers decide how carefully work is verified. A micro change skips the workflow, and walking it is never the goal.
- **It stops at the real lines.** Going live, spending money, irreversible action on real data, a direction that could waste much of the work, and things only you have. Everything else moves on its own.
- **Business details are never silent.** In development, Forge Flow picks a marked provisional value, records it in `DECISIONS.md`, and keeps going. You confirm each one before anything goes live. An unanswered item holds only that item.
- **Failure is never reported as success.** The tool runs acceptance itself, and only the tool ticks a task.

## Unattended runs

`/ff:auto` runs a plan one task at a time, each in a clean process, on its own branch.

- Each passing task is a commit. A failed task's work is kept on a branch, and the next task starts clean.
- A stuck task goes to a clean lead process, which may narrow or split it. Every change to the plan is listed, and changed acceptance means the result needs your review.
- A provider limit pauses the run. It does not fail your tasks.
- No-output limits are per executor (`idleMinutes`): Codex defaults to 10 minutes; Claude and Pi are unlimited. A silent process is killed and retried once per attempt; a silent reviewer is failed without a verdict.
- Contract and high-risk tasks are reviewed. Routine tasks are not, so read those commits. Runs list tasks that finished without review.
- It never pushes, merges, or goes live. You get a report in the morning.

This needs a command-line builder. Setup configures `claude`, `codex`, a Pi model, or `opencode:<provider>/<model>`. OpenCode also supports read-only reviews; see [setup](skills/setup/SKILL.md). When a host starts from a desktop icon or an editor with a short PATH, ff also looks in common install folders such as npm, nvm, Volta, and `~/.local/bin`, after everything already on PATH. Set `FF_EXTRA_PATH=0` to use PATH as it is.

Use `ff wait [--timeout-min <n>]` as a host background task to wake the session when the latest run ends. It prints the status and summary path: exit 0 means complete, 1 means another ending or no run, and 3 means timeout. Without host background tasks, check `ff status` in a later session.

A run can be stopped with `ff stop`, which saves unfinished work on a branch. `ff wait` blocks until a run ends. `ff cleanup` previews and removes old run records.

## Notifications

Keep dated later checks in root `FOLLOWUPS.md`: `- [ ] YYYY-MM-DD What to check. Evidence: <command or where to look>`. `ff status` shows due items; `ff followups` lists all open items and reports malformed lines. Gather and report the evidence, then tick the item. With notifications enabled, SessionStart sends one due reminder per repository per local day. See [follow-ups](cli/README.md#follow-ups).

Forge Flow can tell you when work ends, by webhook, Telegram, or both. Nothing is sent until you configure it. Create `~/.ff/notify.env`:

```
FF_TELEGRAM_BOT_TOKEN=<bot token>
FF_TELEGRAM_CHAT_ID=<chat id>
FF_NOTIFY_WEBHOOK=<url>
FF_NOTIFY_MIN_MINUTES=5
FF_NOTIFY_LANG=en
```

Set either channel or both. `ff notify --test` sends a test message. `FF_NOTIFY_LANG` also takes `zh`.

Notices name the machine. A turn that ends with a question is sent as "waiting" rather than "done". If a run's controller dies, it is reported when a session next starts in that project. Each send attempt is logged to `~/.ff/notify-log.jsonl`, keeping the last 200 attempts with no message text or secrets.

| When | Claude Code | Codex | Pi |
|---|---|---|---|
| `ff run --all` ends, cannot start, or pauses on a provider limit | Yes | Yes | Yes |
| A turn that ran at least `FF_NOTIFY_MIN_MINUTES` finishes | Yes | Yes | Yes |
| A turn ends in an API failure | Yes | No | Yes |
| The prompt sits idle waiting for you | Yes | No | No |
| A permission dialog in the main session needs you | Yes | No | No |

Each turn sends at most one message, apart from permission dialogs, which each send one. Only a session you are using sends anything: sub-agents, headless runs such as `claude -p` or `codex exec`, and processes ff starts stay silent, and so do requests approved automatically. Text is cut short and known secret patterns are hidden. A failed send never affects the work. Codex runs plugin hooks only after you trust them once with `/hooks`.

## Protect the main branch

```
ff protect
```

Run it once in each repository. It installs a git `commit-msg` hook that refuses commits on `main`, `master`, and the origin default branch, in every worktree and from every tool. With a relative `core.hooksPath`, it covers only the worktree you ran it in, and it says so. Messages starting with `docs:` or `docs(`, and merge commits, still pass. `FF_ALLOW_MAIN=1 git commit ...` overrides it once.

Add a branch with `--branch <name>`. `--status` shows the state, and `--remove` takes it out. A local hook is a safety net, and `--no-verify` skips it. For a rule nobody can skip, also turn on branch protection on your git host.

## Project layout

```
ff init            # preview
ff init --apply    # create what is missing
```

`init` sets up `docs/`, a `planning/` folder for plans, decisions, and follow-ups, and a git-ignored `temp/` sorted into `scripts/`, `logs/`, `scratch/`, `snapshots/`, and `backups/`. It appends a short "Files and folders" section to `AGENTS.md`, and keeps names a project already uses, such as `temp-ignore/`. Worktrees live beside the repository in `../<repo>-worktree/`.

`ff docs` lists docs that may need an update for the files you changed. Mark a doc with `Covers: <glob>` near its top to link it to code.

`ff wt new <slug>` creates a worktree from the latest main branch, and `ff wt clean` removes merged ones, squash merges included, after archiving ignored files.

## Parallel runs

`ff run --all --lanes 2` runs tasks with disjoint `Files:` in separate worktrees at once, merges them back one at a time, reruns their acceptance after each merge, and sends conflicts to a serial pass. `--dry-run --lanes 2` previews the grouping. Tasks without `Files:`, high-risk tasks, and tasks touching repository-wide files run serially.

## Cleanup

Run `ff cleanup` to preview old run, review, and council records and merged local `ff/*` branches. Add `--apply` to delete them. Records keep the newest 20 per directory and must be older than 30 days; override with `--keep`, `--days`, or `cleanup: { keep, days }` in config. Active runs, backup names, and unmerged branches are kept. See [CLI cleanup](cli/README.md#cleanup).

## Models

| Families you have | How work divides |
|---|---|
| One | One model builds and a clean process reviews. Reports say there was no independent review. |
| Two | One builds and the other adds a second read. |
| Three or more | The same, with a third reader on high-risk work. |

A missing model downgrades the workflow and never blocks it. On Pi, one tool reaches many vendors, so a role is just a model name.

## Your rules

Project settings go in `.ff/config.json`, which overrides `~/.ff/config.json`. Your own rules go in `~/.ff/my-rules.md`. See [cli/README.md](cli/README.md) for the tool.

## Update

Run `/ff:update`, or use your host's own plugin update. Releases are tagged, so you can always pin an earlier one.

## License

[MIT](LICENSE)
