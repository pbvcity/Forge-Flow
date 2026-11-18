---
name: cleanup
description: Previews and removes what Forge Flow left behind and can prove is finished, such as merged worktrees and ff/* branches, old run records, and leftover run temp folders, and lists what only the user can decide. Use when the user asks to clean up, free space, or tidy branches and worktrees, or when ff status reports something to clean.
---

# cleanup

Follow `../../playbook/default.md` (relative to this skill's directory). Run everything yourself.

## 1. Preview

```
node <this skill's directory>/../../cli/ff.mjs wt clean
node <this skill's directory>/../../cli/ff.mjs cleanup
```

Both change nothing. `wt clean` covers managed worktrees; `cleanup` covers `ff/*` branches, `.ff` run, review, and council records past retention, and leftover run temp folders.

## 2. Apply

```
node <this skill's directory>/../../cli/ff.mjs wt clean --apply
node <this skill's directory>/../../cli/ff.mjs cleanup --apply
```

Apply without asking: they delete only what is proven merged or expired, and never a worktree with uncommitted work or a live run, or a worktree or record with a backup name. After a merge this is part of closing the work.

## 3. Report

Say what was removed and how much space was freed. List what they kept and why, such as branches outside `ff/`, stale `ff/failed/*` branches, or old `temp/` entries, as the user's decision; never delete those yourself without the user naming them.
