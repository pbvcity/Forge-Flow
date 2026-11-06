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

The command-line tool needs Node 22 or newer. Then run setup once. It finds your tools and models and writes `~/.ff/config.json`.

| Claude Code | Codex | Pi |
|---|---|---|
| `/ff:setup` | `$ff:setup` | `/ff-setup` |

## Use

Start with `go` and describe what you want. It picks how much process the work needs.

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
- Contract and high-risk tasks are reviewed. Routine tasks are not, so read those commits.
- It never pushes, merges, or goes live. You get a report in the morning.

This needs a command-line builder. Setup configures `claude`, `codex`, or a Pi model.

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
