# Pack: frontend and visual work

Read when a change touches what users see. Reading the code does not tell you how it looks.

## First

If the project has its own UI skill or design rules, they come first. A product with several screens and no rules should get them: use the `design` skill.

## See it

- Look at the real render at a desktop width and a phone width. Use a browser tool if you have one.
- With no way to see it, write `not seen rendered` in the report. Do not imply a pass.
- Look at every page you changed, not one sample. Shared styles reach further than the diff suggests.
- Check the production build as well as the dev server. Bundling, strict compilation, and server rendering fail only there.

## Check

- [ ] No horizontal scroll at 360px wide.
- [ ] Empty, loading, error, and very-long-text states all render.
- [ ] Real data shapes work: long names, missing images, zero items.
- [ ] Keyboard reaches every control, and focus is visible.
- [ ] Text contrast is at least 4.5:1, and touch targets are at least 44px.
- [ ] Motion respects `prefers-reduced-motion`.
- [ ] Images declare dimensions, so the layout does not jump.
- [ ] Unexpected errors land on an error page. A blank page or a soft 200 can be indexed as duplicate content.
- [ ] Test records are excluded from sitemaps and listings.
- [ ] Users never see internal markers, enum names, or raw error strings.
- [ ] The console shows no new errors on the changed pages.

## Build

- Use the project's tokens and existing components. Page code holds no raw colors or one-off spacing.
- If a shared component is missing, report it. Do not assemble a lookalike from something else.
- Follow the design system first, then taste. A consistent plain page beats a clever inconsistent one.
- Keep the copy in the user's voice. Short labels, one action per button, errors that say what to do next.
- Quote button and field names exactly in instructions and reports.

## Avoid

- Regex tests on stylesheets, or snapshots of whole pages. They fail on normal changes.
- Motion that blocks input or delays content.
- Mechanical sweeps across pages without looking at each result.
