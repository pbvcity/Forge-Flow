---
name: design
description: Sets a visual direction, builds the project's own design system of tokens, components, rules, and a project skill that keeps later work consistent, and supplies motion recipes. Use when the user asks for UI, visual, brand, motion, or game-feel work, when a product with several screens has no design rules yet, or when how something looks is the point of the change. For a small fix inside an existing system, use that project's own skill.
---

# design

Follow `../../playbook/default.md` (relative to this skill's directory). Read `../../playbook/packs/frontend-visual.md` now: it holds what to check once things render.

## 1. Look at what exists

Read the project's tokens, components, and real screens, and look at them rendered if you can. An existing design system or brand wins over taste and over anything in this skill.

Then decide how much this project needs:

| The project | Do |
|---|---|
| Has rules and a project skill | Use that skill. This one adds only direction and motion. |
| Has a look but no written rules, and will keep growing | Write down the real system: step 5. |
| Is new, and will have several screens | Direction first, then build the system: steps 3 to 5. |
| Is one page or a throwaway | A one-page DESIGN.md is enough: steps 3 and 4. |

If the look is already decided, skip step 3.

## 2. Find the intent

Answer in a sentence each: who is this for, what should they feel, and what is the one thing this screen must get done? Take the answers from the request and the repository where you can.

## 3. Offer directions

When the look is open, as with a new product, a brand, or a large redesign, give two or three directions that really differ.

Before proposing, open references: at least two per direction, with your browser or web fetch tool, following `references/references.md`. Writing directions from memory is what makes every product look the same. Only when no tool can load a page, write `references not opened` with the error. Then use `references/styles.md` so the directions differ on at least two axes. Each direction has:

- The idea in one sentence, and who it suits.
- What it gives up.
- References you opened, and what you took from each. Say so if you have none. Never invent a link, a screenshot, or a source.

For a large redesign, render each direction as one static screen, such as a single HTML page, and show the screenshots side by side. People choose far better from a picture than from a paragraph. The samples help the choice and are not the build.

Recommend one. A direction is a choice that can waste much of the work, so ask before building. If the user is away, take your recommendation, record it in `DECISIONS.md`, and carry on: a look can be changed in development, and it is confirmed before going live.

Avoid the generic defaults models reach for: the same purple gradient, the same three feature cards, centered everything. Make a choice someone could disagree with.

## 4. Write DESIGN.md

One page, kept next to the plan. Leave out what does not apply.

```markdown
# <surface>

Intent: <who, feeling, the one job>
Target: <what this must beat, such as a named reference or the current page, and what would count as not good enough>
Direction: <chosen, and why the others lost; for a mix, which leads and what each adds>
Tokens: <color, type, spacing, radius; names from the project where they exist>
Layout: <grid, widths, what collapses on a phone>
States: <empty, loading, error, long text>
Motion: <personality; element class -> recipe>
Icons: <one family, its license>
References: <links you opened, the date, what you took from each, and a license note when reusing code, fonts, images, or icons>
Not doing: <what was left out>
```

## 5. Build the project's system

Follow `references/design-system.md`: tokens, components, rules, a showcase, and a project skill that loads them for every later UI change. This is what keeps the product consistent after today's work is finished, so do it before building screens. The first pass has five parts, listed at the top of that file. Topics grow with real pages.

## 6. Motion

Read `references/motion.md` when anything moves, and `references/atomic-motion.md` for interface details such as hover, menus, and toggles.

- Name easing and duration from the tables. "Smooth" and "premium" tell a builder nothing.
- One recipe per element class across the whole product. Consistency matters more than any single animation.
- New products adopt the recipes by default. A product with its own motion style keeps it, and the recipes do not get mixed in.

## 7. Build and see it

Build shared parts first, then screens. Then follow the frontend pack: look at the real render, on every changed page, at desktop and phone widths, and judge it as its "Judge the look" section says.

Motion cannot be judged from a screenshot, the DOM, or a keyframe. Record a few seconds or capture a frame sequence, and check it against the rubric in `references/motion.md`. If you cannot, write `motion not seen` in the report.

When the user corrects the look and it reads as a lasting rule, write it into the project's rules in the same change.
