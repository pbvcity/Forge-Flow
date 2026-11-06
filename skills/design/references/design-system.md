# Project design system

Models keep a product consistent only if the project itself holds the rules. This sets up rules that live in the repository, plus a project skill that loads them whenever someone touches the UI. Everything here is plain files in the project, and it keeps working without Forge Flow.

The first pass is always the same five things: a tokens file, the shared components the screens use, `design/README.md` with `rules.md`, a showcase, and the project skill. Topics and everything else grow with real pages. A rules tree nobody reads is worse than none.

## The one rule that holds it together

Values live in source. Documents explain and route, and skills hold method. A value copied into a second place goes stale, and then models follow the stale copy.

| Kind | Lives in | Others do |
|---|---|---|
| Token values | One tokens file | Link to it, never repeat it |
| Component behavior | Component source and tests | Describe usage only |
| Rules and reasons | `design/` | Skill routes to them |
| Method | Project skill | Holds no values |
| Why a direction won | `DESIGN.md` or `DECISIONS.md` | Facts in `design/` win once built |

## 1. Tokens

Use the platform's natural form, such as CSS variables, a theme file, or a Swift or Kotlin constants file, with one prefix for the project. Keep the layers in that one file.

- **Primitive:** the raw scale, as in `--x-green-700`. Pages never touch these.
- **Semantic:** the meaning, as in `--x-color-primary` or `--x-text-muted`. This is what code uses. Dark mode and themes change this layer.
- **Component:** only where a component really needs its own value.

Cover color, type scale, spacing, radius, shadow, and motion, with `motion.md` for durations and easing. A styling framework maps names to these variables and holds no values itself.

Fewer is better. Each extra step on a scale is a choice someone has to make on every screen. Check contrast on semantic pairs when you define them.

## 2. Components

List what the screens need before building: buttons, fields, cards, navigation, feedback, empty and loading states. Keep an existing library if the project has one, and wrap it rather than fight it.

- Separate display components from ones that fetch data, so the shared ones stay reusable.
- Each element class has one component and one way of looking. On finding a second way, merge them.
- Each interactive component has all its states: default, hover, pressed, focus-visible, selected, disabled, loading, error, empty.

## 3. Rules

```
design/
  README.md      Direction, who is the authority for what, and a routing table
  rules.md       The short must-list, read every time
  topics/        Read only what the task touches
    color.md, typography.md, layout.md, forms.md, navigation.md, feedback.md, motion.md, ...
```

Use the project's docs folder if it has one. Start with `README.md` and `rules.md`, and add a topic when there is something real to say.

`rules.md` stays short enough to read every time. Mark each rule **must** (breaking it is a defect) or **prefer** (a default that can be changed). Must-rules are the kind that can be checked: token-only values, one way per element class, complete states, contrast, touch targets, keyboard reach, reduced motion, and copy the product must always get right.

A topic has the same parts each time: when it applies, the rules, why, good and bad examples, and how to check. Each check is something a search, the DOM, or a screenshot can answer, so a reviewer can use it without reading the whole system.

## 4. Showcase

One internal page or story file shows every token and component in every state, excluded from production and search. It is the fastest way to see drift, and a person can judge it in minutes. Update it whenever a shared component changes.

## 5. The project skill

Create it when the tokens and `rules.md` exist. A project with rules that nothing loads drifts anyway.

Write the skill once, at `.agents/skills/<project>-ui/SKILL.md`, which Codex and Pi read. For Claude Code, add `.claude/skills/<project>-ui/SKILL.md` with the same frontmatter and one line: follow `../../../.agents/skills/<project>-ui/SKILL.md`.

If the host refuses to write that folder, which unattended modes often do, say so in the report with the exact file to add.

Fill this in from the real project. Keep the method and leave out values.

```markdown
---
name: <project>-ui
description: Use when changing <project>'s pages, components, styles, layout, or interface copy (<real paths>). Not for backend, deployment, or <other surfaces>.
---

# <project> interface

This holds method and routing. Values and rules live in the sources below.

## Read, in order, only what the task needs
1. <design/README.md>: direction, authorities, routing.
2. <design/rules.md>: every time.
3. The topic for this task.
4. <tokens file>, <component folders>, <showcase page>.

## Two kinds of change
| Kind | Examples | Do |
|---|---|---|
| Page | Layout, composing components, copy | Use existing tokens and components. Touch only the target page. |
| System | Tokens, shared components, rules | Say what changes, why, and what else it reaches. Keep it apart from page work. Update the rules and the showcase. List it in the report. |

Missing a token or component on a page is a system change. Never write a one-off style to get past it.

## Before finishing
- Run the checks from the topics you read.
- Report raw values: <exact search for raw colors and arbitrary values>. Report, do not block. The count should not rise.
- Look at the changed pages and the showcase at <real widths>.
- For a system change, have a clean read-only reviewer check the diff against the topic's checks.
- Say what you changed, what you saw rendered, and what you did not check.

## Project traps
<framework versions, build commands, things that have burned this project>
```

## 6. Keeping it alive

- When the same correction comes up a second time, or the user states a lasting rule, write it into `rules.md` or a topic, in the same change. A one-off experiment stays out.
- Changing an existing rule or direction is the user's to confirm before going live. Record it in `DECISIONS.md`, and note why.
- If the skill misled someone, or points at something that moved, fix the skill in the same change. Improve the existing skill rather than adding another.
- Split a topic or add a skill only when a real task needed it.
- Keep old rule documents out of the way, in a `legacy` folder that says it is no longer the basis for anything.

## Existing projects

Look before changing anything. Collect the values and components in use, and name the two or three ways each thing is done. Then record the real system as it is, pick the winners, and move toward them page by page. Do not repaint a working product in one sweep, and do not invent a brand the project does not have.
