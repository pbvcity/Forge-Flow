---
name: setup
description: Detects installed coding tools and available models, then writes ~/.ff/config.json, asking only who leads reviews. Use right after installing Forge Flow, when the user asks to configure it, or when models or tools have changed.
---

# setup

Follow `../../playbook/default.md` (relative to this skill's directory).

## 1. Detect

```
node <this skill's directory>/../../cli/ff.mjs doctor
```

If the tool is missing or fails, detect by hand. Read versions and model lists only. Do not open credential files or print secrets.

- Single-model hosts: check for CLIs with `claude --version`, `codex --version`, `grok --version`, and `opencode --version`. Each CLI is usually one model family, and a second family means calling its CLI.
- Multi-model hosts: read `pi --list-models` and group by vendor. Another family needs only a different `--model` argument, so default the reviewer to a different family from the builder.

Judge family from the model name, and fall back to vendor if unclear. Two tiers from one vendor count as one family, because they share blind spots.

## 2. Ask one thing

Who leads reviews? The default is the current model, since it holds the full context. If the user is away, use the default and say so.

## 3. Assign roles

`roles.builder` runs unattended work, so it must be a headless command, not `host`. Use `claude` or `codex` when that CLI is installed, or a `pi:` role. Work inside a session still happens in that session.

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
- Reviewers run read-only. `claude`, `codex`, and `pi:` roles get this automatically. Other executors need `reviewArgs`.
- Credentials never go in this file.

Create `~/.ff/my-rules.md` only if the user has rules to add. Do not overwrite one.

## 5. Report

List the tools found, the role assignment, and any downgrade. Mention that third-party marketplaces may not auto-update, so the `update` skill exists for that.
