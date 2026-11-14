---
name: review
description: Reviews a change for real loss, with an optional parallel panel in the first round, lead adjudication, and bounded fix rounds. Use when the user asks for a review, after building at routine tier or above, or when a diff, branch, or PR needs an independent read.
---

# review

Follow `../../playbook/review.md` (relative to this skill's directory): it holds the finding format, severity caps, rounds, and stop conditions. General rules are in `../../playbook/default.md`.

## 1. Scope

Settle the range (`base..HEAD`, a PR, or a path), the risk tier, and the acceptance criteria. Read `REVIEW.md` for known-accepted items and pass them on.

| Tier | Reviewers |
|---|---|
| micro | Check your own diff. No file needed. |
| routine | The lead decides. One clean reviewer when it helps. |
| contract, high | A clean reviewer, however small the diff, plus a second family if configured. A panel in round one if `review.panel` is configured. |

`--panel` opens a panel at any tier when the user asks for one.

## 2. Run

```
node <this skill's directory>/../../cli/ff.mjs review --base <ref> --risk <tier> [--panel] [--brief <file>]
```

Reviewers get a brief, not the diff: the tool writes the full redacted patch to `.ff/reviews/<id>/diff.patch` and gives them a file inventory, the patch path, and the working tree to read. Claude reviewers can also run read-only git commands (log, show, blame, diff) under `--restricted` and `dontAsk`; Codex reviewers work in its read-only sandbox; Pi reviewers read git through ff's `git_read` tool, with other extensions off; OpenCode reviewers read files only. For contract and high, write a short brief first (in `temp/` or `.ff/`) and pass it with `--brief`: the purpose, what changed, the interfaces touched, and what to look at first. Each reviewer ends with `Not read:` and the files it skipped; treat a skipped file that matters as unreviewed.

The tool records who ran, on which model, and the raw output. An unparseable result does not count as a pass.

If the tool is missing or fails, do not block. Use a read-only host sub-agent per reviewer, with the brief, the file list, the range or a patch file path to read, the acceptance criteria, and the reviewer prompt at the end of `review.md`, in parallel with results kept apart for a panel. On Claude Code use the plugin's `ff:ff-review` agent (read-only, loads `review.md` itself); on Codex use the `ff_review` agent that `ff` syncs into `~/.codex/agents/` (read-only by instruction only, so for a review that must be enforced read-only use `ff review`); on other hosts use whatever read-only sub-agent the host offers. With no sub-agents, review in this session, and write `no independent review` on the card. A member who is absent is noted, and the rest go on.

The lead is `roles.reviewer` in `~/.ff/config.json`, and `host` or an unset value means the current model.

## 3. Decide

When reviewers disagree widely, the requirement is probably unclear: go back to the acceptance criteria instead of averaging or adding rounds. The lead reads the raw findings, applies the caps, and decides each one: block, fix now, defer, or reject with evidence. Other reviewers have no vote, and each of their findings gets a response. Do not rewrite their text. Check each finding against the source before acting. When you reject or defer a finding without high confidence, list it in your report to the user under a "Needs your look" item: what the issue is, where (`file:line` if known), and why you are unsure.

## 4. Write REVIEW.md

For contract and high, or when an accepted finding must not be raised again. Otherwise the report is enough. Append a dated section, keeping earlier ones:

```markdown
## <date> <range>, <tier>, round <n>

Reviewers: <who, which model, who was absent>
Verdict: PASS or FAIL. FAIL while any BLOCKER or HIGH is open.

### Findings
| Severity | Family | Where | Decision | Why |

### Can be deleted
### Dropped
<count>

### Residual risk
<card from review.md, for contract and high>

### Known accepted
```

## 5. Fix

Unless the user asked for review only, fix what the lead accepted, and delete what "Can be deleted" lists when the lead agrees. Use a fix card that says: smallest fix, no other protection. Check the same pattern elsewhere for confirmed bugs. Do not sweep for hypothetical bypasses.

Round 2 onward: one reviewer reads the fix diff only. The lead supplies its adjudicated findings explicitly with `--findings <path>` so the reviewer checks each fix and any new problems introduced by the fix diff.

```
node <this skill's directory>/../../cli/ff.mjs review --base <ref> --risk <tier> --round <n> --findings <path>
```

Stop on the conditions in `review.md`. High tier has at most 3 rounds. The second appearance of a family ends patching for that family. At the limit, decide. Report the verdict and where `REVIEW.md` is, then continue with whatever the calling skill had left.
