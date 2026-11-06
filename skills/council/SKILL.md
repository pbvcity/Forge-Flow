---
name: council
description: Puts one hard decision to several model families at once and reaches a decision with reasons. Advice only, never a review pass. Use when the user asks for a council or second opinions, or when a decision is expensive to reverse and you cannot judge the options yourself.
---

# council

Follow `../../playbook/default.md` (relative to this skill's directory).

## 1. Is it worth it?

Use it only when all three hold:

- The decision is expensive to reverse: architecture, a data model, a public contract, a direction.
- You cannot tell which option is right on your own.
- A test, a small prototype, or the rules cannot settle it.

Otherwise decide, or build the prototype. To check finished work, use the `review` skill. A council costs several models and proves nothing about the code.

## 2. Frame it

Write a short file: the decision, the options, the facts and constraints, and the paths worth reading. Give your own leaning only if you want it attacked. State facts plainly, because a slanted question gets an agreeable answer.

## 3. Ask

```
node <this skill's directory>/../../cli/ff.mjs council <file> [--members <a,b,c>]
```

Each member works alone and read-only, and sees nobody else's answer. Members default to `review.panel`, then `roles.reviewer` and `roles.second`.

Different models, not different personas. A second copy of one model shares its blind spots, so say so if only one family answered.

If the tool is missing or fails, or members are `host`, use read-only host sub-agents with the same file. If you have only yourself, argue the strongest case against your leaning, and say that no independent view was available.

## 4. Decide

Read the answers in full, then decide. You own the decision, and counting votes is not deciding. Weigh evidence, not confidence. Where members disagree, find the fact that separates them, and check it. One round is enough. If a fact is still missing, go and get it instead of asking again.

## 5. Report

Give the decision, the reasons, what you rejected and why, and what would change your mind. Keep it short, without pasting answers. Record business outcomes in `DECISIONS.md`. If it is a direction choice the user should own, bring it to them with your recommendation before starting.
