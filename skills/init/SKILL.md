---
name: init
description: Prepares the current project for Forge Flow by previewing and then adding the docs, planning, and git-ignored temp folders and the Files and folders and Notifications sections of the project rules. Use when the user asks to initialize or set up a project for Forge Flow, when ff doctor reports a rules section missing, or after an update that adds a rules section.
---

# init

Follow `../../playbook/default.md` (relative to this skill's directory). Run everything yourself; the user should not need another terminal.

## 1. Preview

```
node <this skill's directory>/../../cli/ff.mjs init
```

It changes nothing and lists what it would add: missing folders (`docs/`, the planning folder, the temp folder sorted by kind), the temp ignore line, runtime git excludes, and the `Files and folders` and `Notifications` sections of the rules file (`AGENTS.md`, or an existing `CLAUDE.md`). It keeps names the project already uses, such as `temp-ignore/`, and leaves existing sections alone, except a `Notifications` section that is an unedited older version ff wrote: that one it updates to the current text. An edited or translated section stays as it is; if `ff doctor` still reports the rule outdated, or the section lacks the current rules, show the user the difference and update it by hand on a yes.

## 2. Apply

Show the user the preview in a few lines: which folders, which file gets which section. Then apply when they agree:

```
node <this skill's directory>/../../cli/ff.mjs init --apply
```

Running it again later adds only what is missing, so it is safe in a project initialized by an older version.

## 3. Report

Say what was created or appended, then run `node <this skill's directory>/../../cli/ff.mjs doctor` and report its `Files and folders`, `Notifications rule`, and `Temp folder` lines. If the rules file is tracked by git, the appended sections are an uncommitted change: commit them through the project's normal flow.
