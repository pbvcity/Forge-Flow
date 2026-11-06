# Atomic motion recipes

Sub-second, element-level changes such as hover, press, focus, toggle, and open and close. Page transitions and hero sequences are out of scope. Most interfaces feel unfinished because one block animates and the next does not, or one hover takes a second and another 200ms. These recipes keep a whole product consistent. Easing and duration names come from `motion.md`.

## Rules

- New products adopt these by default. A product with its own conventions keeps them, and recipes are not mixed in.
- One recipe per element class across the whole product. Every button hover is the same.
- Interaction feedback stays at `short4` (200ms) or under, and a hover never exceeds 300ms. Containers such as modals and drawers use `medium1-medium2`. Only full-screen transitions and loops run longer.
- Entrances decelerate, exits accelerate, and an exit is never slower than its entrance. Attention has already moved on.
- Transforms may overshoot slightly. Color, opacity, and shadow never do.
- Things used hundreds of times a session, such as a command palette, a context menu, or later tooltips in a group, may use no motion on purpose. That is the `instant` recipe, not an omission.
- Animate `transform` and `opacity` first, with color, border, and shadow as accents. Never `transition: all`, and never animate `width`, `height`, `top`, `left`, or `margin`. `container-resize` is the one exception.
- Blur comes in three steps: `blur1` 2px, `blur2` 3px, `blur3` 8px. It always pairs with an opacity change, on enter, exit, and swap. It is the strongest single lever for a refined feel.
- Stagger step `stagger1` is 35ms, applied as `--index` times the step. A whole sequence stays within 500ms.
- Multi-stage sequences phase through `animation-delay` or two-class switching, and each phase uses named tokens.
- Open and close recipes declare both directions. The exit takes the next shorter duration with an accelerate curve unless the recipe says otherwise.
- Scale entrances start at 0.95 or higher, never `scale(0)`.
- Dropdowns and popovers align to their trigger and reveal top to bottom. Diagonal corner growth reads cheap.
- `prefers-reduced-motion: reduce` collapses every recipe to an instant change. `:focus-visible` rings show at once and never depend on motion.
- At most two infinite loops per viewport. Skeletons and spinners go away with their state.
- Press-scale is for primary actions only. Toolbars and utility buttons use color feedback.
- Expressive recipes (`confetti-burst`, `gooey-menu`, `organic-shimmer`, `organic-diffusion`, `delete-smoky-dissolve`, `gradient-text`) are accents: at most one per view, never on frequent paths, always skipped under reduced motion.
- One icon family per surface: one set, one grid, one stroke weight. Mixed icon weights look worse than any motion can repair. A project's own icon system wins. Otherwise offer open families such as Phosphor (MIT), RemixIcon (Apache-2.0), or Tabler (MIT), and record the choice.

### Spring curves

These are CSS `linear()` samples of a damped spring, for transforms only, with no JS library.

- `spring-soft`, about 5% overshoot: `linear(0, 0.069 4.5%, 0.227 9.1%, 0.415 13.6%, 0.597 18.2%, 0.752 22.7%, 0.873 27.3%, 0.958 31.8%, 1.012 36.4%, 1.041 40.9%, 1.053 45.5%, 1.053 50%, 1.046 54.5%, 1.037 59.1%, 1.026 63.6%, 1.017 68.2%, 1.01 72.7%, 1.004 77.3%, 1.001 81.8%, 0.998 86.4%, 0.997 90.9%, 0.997 95.5%, 1)`
- `spring-bouncy`, about 21% overshoot with a rebound, for switch thumbs, badge dots, and like pops: `linear(0, 0.106 4.5%, 0.352 9.1%, 0.638 13.6%, 0.895 18.2%, 1.08 22.7%, 1.184 27.3%, 1.215 31.8%, 1.192 36.4%, 1.139 40.9%, 1.077 45.5%, 1.022 50%, 0.983 54.5%, 0.96 59.1%, 0.954 63.6%, 0.959 68.2%, 0.97 72.7%, 0.983 77.3%, 0.995 81.8%, 1.004 86.4%, 1.008 90.9%, 1.01 95.5%, 1)`

## Recipes

Trigger is what starts the motion. Pick one value per project and keep it.

| Recipe | Elements | Trigger | Properties | Easing | Duration | Notes |
|---|---|---|---|---|---|---|
| button-hover | button, primary CTA | hover | background/border-color, box-shadow, optional translateY(-1px) | standard | short3 | never `transition: all` |
| button-press | primary/action button | :active | transform scale(0.97) | standard | short1 | opt-in per element class: primary actions only: blanket press-scale on every clickable (toolbars, utility buttons) reads twitchy; those default to color-only feedback |
| icon-button-hover | icon button, ghost button | hover | background tint, color | standard | short2 | |
| link-hover | inline link, nav item | hover | text-decoration-color / background-size underline | standard | short3 | no width reflow; variant: trailing chevron shifts and extends into a full arrow |
| input-focus | text input, textarea, select | :focus-visible | border-color + ring box-shadow | standard-decelerate | short2 | ring is instant-safe; never motion-gate focus visibility |
| field-error | field + helper text | validation fail | field: single segmented shake (±4px, one pass ~260ms); message: opacity + translateY(4px) synced | standard-decelerate | short4 | exactly one shake pass per submit, never repeated; message entry shares the moment |
| toggle-switch | switch | click | thumb translateX + track background-color synced | standard | short4 | thumb via transform, never `left`; playful thumb uses spring-bouncy (transform only) |
| checkbox-check | checkbox, radio dot | click | SVG stroke-dashoffset draw; box fill | standard-decelerate | short3 | fill at short2; never pop from scale(0) |
| segmented-indicator | tabs, segmented control, chip group | selection change | indicator translateX/scaleX | emphasized | short4 | indicator via transform, not left/width |
| tab-content-swap | tab panel | selection change | opacity cross-fade | standard | short3 | no full-page slide |
| card-hover | card, list tile | hover | translateY(-2px) + box-shadow deepen | standard | short4 | keep shadow subtle; >300ms feels sticky |
| dropdown-open | menu, select popup, popover | open | opacity + blur1 + translateY(-6px) scaleY(0.96 -> 1); transform-origin top center, panel aligned to trigger | emphasized-decelerate | short4 | reveal top-to-bottom only: diagonal corner growth (top-left to bottom-right) reads cheap; exit: short3 + emphasized-accelerate or instant fade; context menus may enter instantly |
| tooltip-show | tooltip | hover intent | opacity + 2-4px shift | standard-decelerate | short2 | first tooltip delays 300-500ms; subsequent tooltips in group: zero delay, zero motion; exit is instant (no exit transition) |
| modal-enter | dialog, modal | open | panel opacity + blur2 + scale(0.96 -> 1); backdrop opacity synced | emphasized-decelerate | medium1 | exit: short4 + emphasized-accelerate; backdrop and panel share timing |
| drawer-slide | drawer, sheet | open | translateX/translateY 100% -> 0 | emphasized | medium2 | exit: medium1 + emphasized-accelerate |
| accordion-expand | accordion, disclosure | toggle | grid-template-rows 0fr -> 1fr + content opacity; chevron rotate synced | standard | medium1 | never max-height hacks; chevron shares the same token |
| toast-enter | toast, snackbar | show | translateY(8px) + opacity + blur1 + scale(0.95 -> 1) | emphasized-decelerate | medium1 | exit: short4 + emphasized-accelerate; exit never slower than enter |
| list-stagger | list/grid items entrance | mount/filter | opacity + translateY(4-8px), stagger1 steps | standard-decelerate | short4 | total sequence <=500ms; text-line variant: blur-rise (translateY + blur1 to 0) |
| icon-morph | hamburger-to-X, play-pause | state change | rotate/translate composite or SVG path morph | standard | short4 | no opacity hard-swap disguised as morph |
| copy-success | copy button, save tick | success | icon swap + check draw | standard | short3 | revert after ~1.2s hold |
| count-up | numeric KPI, counter | value change | textual value tween | standard-decelerate | long2 | requires tabular-nums; data_viz rules apply |
| progress-update | determinate progress | value change | fill width tween from left; rounded cap once value > 0, flat cap only at exact zero | standard-decelerate | medium2 | width tween sanctioned for mechanical value display (scaleX would squash the rounded cap); indeterminate loop: linear-mechanical |
| skeleton-shimmer | skeleton placeholder | loading state | background-position sweep loop | linear-mechanical | extra-long4 | ~1200-1600ms per sweep; loop exception; on load complete hand off to real content via cross-fade + blur2 reveal, never a hard swap |
| spinner-rotate | spinner | loading state | rotate 360 loop | linear-mechanical | extra-long4 | ~800-1000ms per revolution; linear only |
| focus-ring | any focusable | :focus-visible | outline/box-shadow appear | standard | short1 | instant acceptable; a11y feedback never waits |
| text-swap | status line, button label, in-place copy | text change | outgoing line floats up (translateY(-8px)) + fade + blur1; incoming rises from below (8px) | standard | short3 | content line sits above its trigger; both spans stacked in one slot |
| icon-swap | icon slot | icon replace | outgoing shrinks to center (scale 0.25) + fades + blur1; incoming scales up from 0.25; transform-origin center | standard | short3 | universal for any icon pair; use SVG icons: font glyphs re-rasterize at fractional scales and jitter; morph pairs (hamburger-X) stay icon-morph |
| notification-badge | unread indicator | appear/update | two clocks: badge wrapper slides in diagonally (-8px, +12px) + fades + blur1 on a standard curve; the dot/pill itself pops (scale 0.25 -> 1) on a longer bouncy clock (~2.5x) | spring-interactive | short4 | badge is either a bare dot or a numbered pill, never both stacked; the trigger itself never moves; spring only on transform, never opacity |
| button-loading-morph | submit/action button | idle→loading→success | label fade → spinner → check draw, three phases | standard | medium1 | multi-stage exemplar; per-phase tokens; width change via container-resize rules |
| avatar-group-hover | avatar stack, member row | hover | hovered lifts -4px, neighbors -2px (distance falloff), springy return | spring-interactive | short3 | spring-soft return; stacking order: the hovered avatar takes the top layer, neighbors never overlap it; a plain per-item CSS lift also works |
| card-stack-fan | stacked cards, gallery pile | hover | resting stack sits slightly shuffled (per-card 2-5deg rotate + small offset); hover fans out per-index, stagger1 steps | spring-interactive | medium1 | spring-soft; a perfectly aligned pile does not read as a stack; transform only, shadow static |
| tilt-3d | feature card, cover art | pointer move | perspective rotateX/Y <=6deg + glare layer tracks pointer | standard | short2 | JS-assisted (pointer normalize); disable under reduced-motion |
| like-burst | like/heart button | activate | heart icon pops (spring, ~1.18): the button box never scales; fill 150ms; 8 particles burst ~25px, staying opaque through the flight and fading only in the last stretch | spring-interactive | short3 | pop applies to the icon only; particles must stay visible (tiny dots that fade immediately read as no effect); unlike reverses fill without particles |
| container-resize | expanding panel, inline editor | size change | fr-unit grid tween or FLIP transform to new size | standard | medium1 | sanctioned size-tween atom; direct width/height only on small isolated containers |
| dropdown-morph | round icon button (or square trigger) → menu panel | open | container transform: trigger itself grows into the panel, content fades in after | emphasized | medium1 | canonical form: circular FAB morphing into a surface; distinct from dropdown-open; exit reverses at short4 + accelerate |
| digit-reel | numeric ticker, KPI counter | value change | per-digit vertical reel + transient blur1, stagger1 per digit | standard-decelerate | medium2 | tabular-nums required; motion blur only mid-roll |
| input-clear | search/text field clear | clear action | text and placeholder live in absolutely-positioned layers (field height never changes); typed text flies down 12px + blur as one unit (~330ms); placeholder falls in from above (30ms later); restore drops text in from above | standard | long1 | NO streak/glow/particle layer of any kind: clearing must feel crisp and light; clear button lives inside the field |
| shimmer-text | streaming/loading text | waiting state | background-clip gradient sweep loop | linear-mechanical | extra-long4 | ~1200ms/sweep; AI-streaming placeholder; loop exception |
| success-check | confirmation badge, form success | success moment | small check on a green circular disc (~28px, white stroke): fade / rotate(80deg -> 0) / blur(10px -> 0) / 40px rise with bouncy bob: four parallel 500ms keyframe clocks + stroke draw delayed 80ms | standard | extra-long2 | keep the mark small: an oversized check reads clumsy; stroke-dasharray measured via getTotalLength(); cold state is opacity 0 |
| texts-reveal | headline + subline, two-line copy | mount/section enter | per-line rise 12px + blur2 -> 0, 40ms line stagger, 500ms per line | standard-decelerate | extra-long2 | exit is decoupled: a single quiet 200ms fade, never the reveal in reverse; longer stacks use list-stagger |
| learn-more-hover | text link with chevron | hover | the chevron itself shifts right ~3px; no shape morph | standard | long1 | label never reflows; keyboard focus mirrors hover; simplicity is the point |
| spinner-check-morph | inline loader, submit affordance | loading -> success | spinner ring pops (spring-soft scale) into a drawn check | standard | medium1 | standalone form of button-loading-morph's final phase |
| confetti-burst | publish/success CTA | activation | 18-24 physics particles arc up and tumble; those over the button land on its top edge, the rest keep falling past it out of view | spring-interactive | extra-long2 | expressive accent (<=1 per view); JS-assisted; skipped entirely under reduced-motion |
| gooey-menu | round FAB | expand | goo-filtered action dots (each carrying an icon) split from the button into an upward arc; the + rotates 45deg and the button gives one bounce | spring-interactive | medium2 | expressive accent; the +/x glyph must be an SVG sized to land on integer pixels inside the button (a half-pixel offset re-rasterizes with a visible lateral snap when the filtered layer settles); icons fade in after separation; fan uses spring-soft with stagger1 |
| organic-shimmer | decorative panel, cover art | ambient loop | three layers, all sweeping top-left to bottom-right: a large faint colour haze on a ~1.9x slower clock, doubled at half phase so it feels continuous (background, never the subject); the main layer distributed along the whole sweep path: a heavily overlapping cluster, 2-3 slightly smaller halos ringing it, and 2-3 large low-opacity masses plus scattered faint halos seeded through the otherwise-empty stretch with a deliberately uneven rhythm (a pair, a real gap, a solo, a long gap, an isolated one): sparse, never evenly filled, yet no dead void trails the cluster; the loop is made seamless by two-copy tiling (a second identical field offset by exactly one travel period, animation translating exactly one period, so the last frame equals the first pixel-for-pixel: a non-periodic field teleports at wrap and reads as a hitch every cycle): on the primary clock; and a much-subtled 1.5px edge ring | linear-mechanical | extra-long4 | the light must read as one organic coloured mass, never as separate blurred circles; distinct from organic-diffusion, never merge the two; expressive ambient, one per view; removed under reduced-motion |
| organic-diffusion | decorative panel, cover art | ambient loop | 4-5 diffuse colour blobs (varied sizes, filling the surface) each drift slowly on their own alternate clocks | linear-mechanical | extra-long4 | distinct from organic-shimmer (fixed cluster sweep); 1.5px glassy edge ring driven by the same blobs; expressive ambient, one per view; removed under reduced-motion |
| drag-drop-morph | upload/drop zone | drag + drop | chip follows pointer with spring lag; on drop the zone morphs into the content card | spring-interactive | medium1 | JS-assisted; zone morph follows container-resize rules |
| delete-smoky-dissolve | removable card/image | delete | content splits into strips that fall with blur3 + fade while the smoke puff rises concurrently (same moment, opposite directions) | standard-accelerate | extra-long1 | smoke never lags the shred: simultaneous start; expressive accent for destructive moments; core fall <=450ms |
| gradient-text | hero/display text | ambient loop | colour wash orbits the letters via background-clip gradient loop | linear-mechanical | extra-long4 | expressive ambient ~3s loop; pair with static body text |
| instant | command palette, context menu entry, grouped tooltips | high-frequency interaction | none (state snaps) | n/a | n/a | deliberate zero-motion recipe |

## Skeletons

Adapt the tokens and keep the shape.

```css
/* button-hover + button-press: common failure transition: all */
.btn { transition: background-color 150ms cubic-bezier(0.2,0,0,1),
                   box-shadow 150ms cubic-bezier(0.2,0,0,1),
                   transform 50ms cubic-bezier(0.2,0,0,1); }
.btn:active { transform: scale(0.97); }

/* dropdown-open: common failures scale(0) start; origin at center; exit slower than enter */
.menu { transform-origin: var(--origin, top left); opacity: 0; transform: scale(0.95);
        transition: opacity 200ms cubic-bezier(0.05,0.7,0.1,1), transform 200ms cubic-bezier(0.05,0.7,0.1,1); }
.menu[data-open] { opacity: 1; transform: scale(1); }
.menu:not([data-open]) { transition-duration: 150ms; transition-timing-function: cubic-bezier(0.3,0,0.8,0.15); }

/* accordion-expand: common failure max-height: 9999px timing distortion */
.acc { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 250ms cubic-bezier(0.2,0,0,1); }
.acc[data-open] { grid-template-rows: 1fr; }
.acc > * { overflow: hidden; }

@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important; }
}
```

## Checks

- Two elements of one class with different timing is a defect.
- All elements of a class carry the recipe, or the class is deliberately `instant`. Half-dressed pages read as unfinished.
- Hover, press, or focus above 200ms, or any hover above 300ms, needs a reason.
- An entrance with accelerate easing, or an exit slower than its entrance, is wrong.
- Overshoot on color, opacity, or shadow is wrong.
- Every recipe collapses under reduced motion.
- No more than two infinite loops in a viewport.
- Timings use token names, not raw milliseconds.

## Sources

Values were derived independently, and no snippet was copied. Material 3 motion and IBM Carbon motion (both Apache-2.0) for duration and easing semantics. easings.net for bezier values. Writing by Emil Kowalski and Rauno Freiberg on interaction detail, and Nielsen Norman Group on duration, for ideas restated here.
