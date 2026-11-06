# Motion vocabulary

Shared names for what moves, how, and for how long. It adds no runtime dependency. A motion spec names four things: category, easing, duration, and personality.

## Categories

| Category | Covers | Default | Check |
|---|---|---|---|
| micro_interaction | hover, focus, click, toggle, counter | `standard-decelerate`, `short2-short4` | Feedback is visible but does not grab attention. |
| state_feedback | success, error, loading, skeleton, progress | `standard`, `medium1-medium2` | The change is timely and hides no content. |
| entrance_exit | fade, slide, scale, blur reveal, stagger | enter `emphasized-decelerate`, exit `emphasized-accelerate`, `medium1-long1` | Direction and hierarchy match the layout. |
| page_route_transition | cross-fade, shared element, view transition | `emphasized`, `long1-extra-long1` | Navigation keeps the user oriented. |
| scroll_driven | parallax, sticky transform, scroll timeline, image reveal | CSS scroll and view timelines first; `linear` for mechanical progress only | Motion does not fight reading. |
| hero_ambient | looped background, gradient drift, ambient illustration | `standard`, or a low-amplitude spring; `extra-long1` and up | It supports the mood and respects reduced motion. |
| data_viz | value counters, chart draw-on, morphing shapes | `standard-decelerate`, `medium2-long2` | Numbers stay legible during the change. |
| game_juice | screen shake, hit-stop, squash and stretch, particle burst | spring or tapered easing, 50-300ms by technique | Juice reinforces impact without hiding play state. |

## Easing

| Token | Value | Use |
|---|---|---|
| emphasized | `cubic-bezier(0.2,0,0,1)` | Expressive state changes, route transitions |
| emphasized-decelerate | `cubic-bezier(0.05,0.7,0.1,1)` | Things arriving on screen |
| emphasized-accelerate | `cubic-bezier(0.3,0,0.8,0.15)` | Things leaving |
| standard | `cubic-bezier(0.2,0,0,1)` | Ordinary state changes |
| standard-decelerate | `cubic-bezier(0,0,0,1)` | Subtle entrances and feedback |
| standard-accelerate | `cubic-bezier(0.3,0,1,1)` | Subtle exits |
| spring-interactive | stiffness 80-200, damping 10-20 | Drag, snap, playful feedback |
| linear-mechanical | `linear` | Progress bars, meters, continuous mechanical motion only |

A softer site-wide choice for `standard` is `cubic-bezier(0.33,1,0.68,1)`. Spatial overshoot accents may use `cubic-bezier(0.34,1.56,0.64,1)`. Pick one and keep it in one place.

## Duration

| Token | Time | Use |
|---|---|---|
| short1 | 50ms | Tiny affordance response |
| short2 | 100ms | Click or tap feedback |
| short3 | 150ms | Hover and focus transitions |
| short4 | 200ms | Compact component feedback |
| medium1 | 250ms | Common component state change |
| medium2 | 300ms | Loading, success, or error transition |
| long1 | 350ms | Entrance, exit, small route transition |
| long2 | 400ms | Shared element or larger reveal |
| extra-long1 | 450ms | Page or route transition |
| extra-long2 | 500ms | Richer page transition |
| extra-long3 | 600ms | Hero or ambient sequence |
| extra-long4 | 700ms and up | Cinematic or ambient only |

## Personality

Pick one per screen or flow, so easing stays consistent.

| Personality | Posture | Tokens |
|---|---|---|
| Calm | Restrained, low amplitude, content first | `standard`, `short3-medium1`, few ambient loops |
| Confident | Crisp, decisive, clear | `emphasized-decelerate`, `medium1-long1` |
| Playful | Elastic, tactile, small overshoot | `spring-interactive`, `short4-medium2` |
| Energetic | Fast, high contrast, impact first | `emphasized`, `short2-medium2`, careful with repetition |

Personality sets a posture, not a quality limit. Calm does not mean static.

## Game juice

| Technique | Timing | Use |
|---|---|---|
| Screen shake | 0.1-0.3s, tapered randomness | Weight of an impact |
| Hit-stop | 3-5 frames, about 50-85ms | Let a collision register |
| Squash and stretch | Short spring | Landing, jump, impact, tactile UI |
| Particle burst | Brief randomized arc | Collect, destroy, reward |
| Icon or button wobble | Spring overshoot | Success or celebration |

A person playing the game is the real test. These only give it vocabulary.

## Rubric

Judge motion from a recording or frame sequence of a few seconds. A screenshot, the DOM, or a keyframe in the code proves nothing here.

| Quality | Check |
|---|---|
| Timing | Speed, delay, and sequence feel believable. |
| Material | Fire, smoke, liquid, glass, cloth, and light behave like that material, not like a fade and a scale. |
| Variation | Loops and repeated feedback avoid obvious repetition and stay readable. |
| Continuity | Position and state carry across transitions, hits, and interruptions. |
| Readability | Cause, state, priority, and input feedback stay clear while it moves. |
| Reduced motion | A fallback keeps the meaning and the usability. |

## Sources

Token names and ranges follow Material Design 3 motion. The personality vocabulary draws on the LottieFiles motion design skill. Check both for changes before refreshing these tables.
