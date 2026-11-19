---
name: init
description: Prepares the current project for Forge Flow by previewing and then adding the docs, planning, and git-ignored temp folders and the Files and folders and Notifications sections of the project rules, and aligns project and user rules files with the current Forge Flow rules after an update. Use when the user asks to initialize or set up a project for Forge Flow, when ff doctor reports a rules section missing or a rules version behind, when a session note says Forge Flow's rules changed, or after an update.
---

# init

Follow `../../playbook/default.md` (relative to this skill's directory). Run everything yourself; the user should not need another terminal.

## 1. Preview

```
node <this skill's directory>/../../cli/ff.mjs init
```

It changes nothing and lists what it would add: missing folders (`docs/`, the planning folder, the temp folder sorted by kind), the temp ignore line, runtime git excludes, and the `Files and folders` and `Notifications` sections of the rules file (`AGENTS.md`, or an existing `CLAUDE.md`). It keeps names the project already uses, such as `temp-ignore/`, and never rewrites an existing section. Its last lines name rules files that need aligning (step 3).

## 2. Apply

Show the user the preview in a few lines: which folders, which file gets which section. Then apply when they agree:

```
node <this skill's directory>/../../cli/ff.mjs init --apply
```

Running it again later adds only what is missing, so it is safe in a project initialized by an older version.

## 3. Align rules

Forge Flow's rules live in rules files: `Files and folders` and `Notifications` in the project's `AGENTS.md` or `CLAUDE.md`, and the `Delegation` section from setup in `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, or `~/.pi/agent/AGENTS.md`. Each file carries one `<!-- forge-flow rules N -->` line saying which version of the rules it was aligned with; a file with Forge Flow rules but no such line is at version 1.

```
node <this skill's directory>/../../cli/ff.mjs init --rules
```

It lists each file with Forge Flow rules, its version, and the later changes that apply to it; when a file is behind, it also prints the current project sections in English. For each file with changes listed:

1. Read the file. Find the content that carries Forge Flow's rules, in whatever language and wording it uses now; it may be translated or adapted to the project.
2. Compare its meaning with the changes listed and with the current sections. Note only rules that are missing or say something different; wording is not a difference.
3. Propose the edits: the file, the lines as they are, and the lines as you would write them, in the file's own language and style. Keep what the user added for their project. Do not add sections the user removed.
4. Apply only what the user agrees to. Then record the file as aligned, also when they keep it as it is, so later sessions stop asking:

```
node <this skill's directory>/../../cli/ff.mjs init --rules --mark <file>
```

Never change a user rules file outside the Forge Flow sections, and never mark a file the user has not decided on.

## 4. Report

Say what was created, appended, or aligned, then run `node <this skill's directory>/../../cli/ff.mjs doctor` and report its `Files and folders`, `Notifications rule`, `Rules version`, and `Temp folder` lines. If a rules file is tracked by git, the changes are uncommitted: commit them through the project's normal flow. Start a new session to work under the aligned files.
