---
name: update
description: Updates Forge Flow on every host where it is installed by calling each host's own update command, then reports versions and any reload needed. Use when the user asks to update or upgrade Forge Flow, or to check for a new version.
---

# update

Follow `../../playbook/default.md` (relative to this skill's directory).

## 1. Run

```
node <this skill's directory>/../../cli/ff.mjs update
```

It finds the hosts with Forge Flow installed and runs each host's own update. One host failing does not stop the others. It fills in new config keys with defaults and leaves existing values alone.

If a run is in progress, mention it and continue. State files only gain fields, so old runs keep working.

## 2. Without the tool

If `ff update` is missing or fails, do it by hand for each host that has Forge Flow. Report a failure and move on to the next.

| Host | Commands | Takes effect |
|---|---|---|
| Claude Code | `claude plugin marketplace update`, then `claude plugin update ff@<marketplace>` | `/reload-plugins` or a new session |
| Codex | `codex plugin marketplace upgrade`, then `codex plugin add ff@<marketplace>` | Restart Codex |
| Pi | `pi update --extension <package source>` | `/reload` or a new session |

Leave other plugins and marketplaces alone. For other hosts, tell the user to use that host's update entry.

## 3. Report

For each host: version before, version after, and whether a reload or restart is needed. Bad releases are undone by installing an earlier tag, not by rollback code here. If a host fails, give its error and the command to retry.
