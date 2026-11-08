---
name: setup
description: Detects installed coding tools and available models, writes ~/.ff/config.json, and offers session model tiers for sub-agents. Use right after installing Forge Flow, when the user asks to configure it, or when models or tools have changed.
---

# setup

Follow `../../playbook/default.md` (relative to this skill's directory).

## 1. Detect

```
node <this skill's directory>/../../cli/ff.mjs doctor
```

If the tool is missing or fails, detect by hand. Read versions and model lists only. Do not open credential files or print secrets.

- Single-model hosts: check for CLIs with `claude --version`, `codex --version`, `grok --version`, and `opencode --version`. Each CLI is usually one model family, and a second family means calling its CLI.
- Multi-model hosts: read `pi --list-models` and `opencode models` and group by vendor. Another family needs only a different `--model` argument, so default the reviewer to a different family from the builder.

Judge family from the model name, and fall back to vendor if unclear. Two tiers from one vendor count as one family, because they share blind spots.

## 2. Ask one thing

Who leads reviews? The default is the current model, since it holds the full context. If the user is away, use the default and say so.

## 3. Assign roles

`roles.builder` runs unattended work, so it must be a headless command, not `host`. Use `claude` or `codex` when that CLI is installed, or a `pi:` or `opencode:` role. Work inside a session still happens in that session.

| Families | Builder | `reviewer` | `second` | Reports say |
|---|---|---|---|---|
| 1 | That family's CLI | The same CLI, as a clean process | Empty | `no independent-family review` |
| 2 | User's choice, default current model | The other family | Empty | Who led |
| 3 or more | As above | One other family | A third family | Who led |

The lead reads every reviewer and decides. Missing models downgrade the workflow and never block it.

## 4. Write the file

Write `~/.ff/config.json`. A project may override it in `.ff/config.json`. If the file exists, add missing keys and leave the user's values alone.

```json
{
  "roles": { "builder": "claude", "reviewer": "codex", "second": "" },
  "executors": {
    "<name>": { "cmd": "<headless command>", "profile": "generic" }
  },
  "review": { "panel": [] },
  "playbook": "~/.ff/my-rules.md"
}
```

- `claude` and `codex` are built in, so they need no `executors` entry. Add one only for another tool, such as `grok -p`, and use its help to confirm flags. It must read the prompt from stdin and be able to write files without asking.
- `profile` is `generic`, `gpt`, or `claude`, matching `../../playbook/executors/`.
- On a multi-model host, a role can name a model directly: `pi:<vendor>/<model>:<effort>`.
- OpenCode roles use `opencode:<provider>/<model>` for builders, reviewers, and council advisers. Prompts stay in the run/review/council directory and travel through `--file`; `--dir` is the project root. The message asks the model to read through EOF using offsets when truncated and follow the file's final instructions. No real model is called during detection.
- OpenCode reviews and council advisers select `ff-review`, defined for that child process through `OPENCODE_CONFIG_CONTENT` (OpenCode V1 agent configuration). Its permissions deny every tool except read, grep, glob, and list. No agent installation or user-config write is needed. This replaces inline config for that child process; ordinary user/project files still load. An unavailable agent marks the reviewer or adviser failed, with no review verdict. Builders keep their existing OpenCode permissions. See the [OpenCode configuration source](https://github.com/anomalyco/opencode/blob/v1.2.27/packages/opencode/src/config/config.ts) for the V1 format.
- Reviewers run read-only. `claude`, `codex`, `pi:`, and `opencode:` roles get this automatically. Other executors need `reviewArgs`.
- Credentials never go in this file.

Create `~/.ff/my-rules.md` only if the user has rules to add. Do not overwrite one.

## 5. Prepare the repository

Run `node <this skill's directory>/../../cli/ff.mjs init` to preview the folders, ignore lines, and rules-file block it would add, then `init --apply` if they fit. It only adds what is missing, keeps existing names such as `temp-ignore/`, and never rewrites a rules file.

## 6. Offer session model tiers

Sub-agents cost less and finish sooner on a model that fits the job. This is for work inside a session; `roles` above cover unattended runs.

Check what the user already has. Read file names and `model` or effort lines only.

- Claude Code: `~/.claude/agents/*.md` with a `model:` line, and a delegation section in `~/.claude/CLAUDE.md`.
- Codex: `~/.codex/agents/*.toml` with `model` or `model_reasoning_effort`, and `~/.codex/AGENTS.md`.
- Pi has no sub-agents of its own, so only the delegation section applies, in `~/.pi/agent/AGENTS.md`.

If tiers exist, report them and change nothing. Otherwise ask one question: lean toward lower cost, or toward quality? Then show the files and write them once the user agrees. Write only files that do not exist. Add the delegation section to the end of a rules file, and never rewrite what is there.

| Tier | Use for | Claude Code, lower cost | Claude Code, quality | Codex effort, lower cost | Codex effort, quality |
|---|---|---|---|---|---|
| `ff-light` | Counts, file checks, list comparisons, format conversion, simple searches | `haiku`, `low` | `sonnet`, `low` | `low` | `medium` |
| `ff-standard` | Routine implementation, doc sync, summaries, reconciling sources | `sonnet`, `medium` | `sonnet`, `high` | `medium` | `high` |
| `ff-deep` | Reviews of contract or high-risk changes, root causes, specs | `opus`, `high` | `opus`, `xhigh` | `high` | `xhigh` |

Claude Code, `~/.claude/agents/ff-light.md`, and the same for the other two:

```markdown
---
name: ff-light
description: <the "Use for" cell>. Cheapest tier.
model: haiku
effort: low
---

Do only what the prompt asks, in the paths it names. Do not commit or push unless asked. Never print credentials. End with the result and the paths you changed.
```

Codex, `~/.codex/agents/ff-light.toml`. Keep the user's model and set only the effort, unless the user names a smaller model for light work:

```toml
name = "ff_light"
description = "<the Use for cell>. Cheapest tier."
model_reasoning_effort = "low"
developer_instructions = """
Do only what the prompt asks, in the paths it names. Do not commit or push unless asked. Never print credentials. End with the result and the paths you changed.
"""
```

The delegation section, in the user's language:

```markdown
## Delegation

- Keep planning, decisions, and the final check of results in this session.
- Mechanical checks and lookups go to ff-light, routine work to ff-standard, and reviews of contract or high-risk changes, root causes, and specs to ff-deep. When unsure, use ff-standard.
- A sub-agent's report is a claim. Read the diff and the output.
```

On Codex the names are `ff_light`, `ff_standard`, and `ff_deep`. On Pi, drop the tier names and keep the first and last lines.

## 7. Offer notifications and branch protection

If the user wants to hear when long work ends, show them the settings in the README's "Notifications" section. They fill in `~/.ff/notify.env` themselves, because it holds credentials. Then run `ff notify --test`.

If this repository should not take direct commits on its main branch, run `ff protect` here. It applies to one repository, so run it in each one that needs it.

## 8. Report

List the tools found, the role assignment, the session tiers found or added, and any downgrade. Mention that third-party marketplaces may not auto-update, so the `update` skill exists for that.
