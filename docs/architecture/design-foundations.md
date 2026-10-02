# Design Foundations

Scales, tokens, states, and motion that every screen inherits. A visual value that is not
on a scale does not belong in a component.

## Token Discipline

Centralize color, spacing, radius, typography, shadow, z-index, motion, and breakpoints in
one place. Screens consume tokens; they do not invent their own visual language.

- No arbitrary values in components: `p-[13px]`, `#3b82f6`, `duration-[370ms]`, `z-[9999]`.
- No module-local theme colors. Semantic variables only, so both themes stay correct.
- Adding a value to a scale is a system decision, documented where the scale lives.
- When a design needs a value the scale lacks, either the scale or the design is wrong. Resolve that before writing the component.

## Spacing

Use one arithmetic scale. Base 8, with 4 reserved for optical correction.

| Token   | Value | Use                                            |
| ------- | ----- | ---------------------------------------------- |
| `0.5`   | 4px   | Optical adjustment, such as icon to label      |
| `1`     | 8px   | Tightly bound elements                         |
| `2`     | 16px  | Related elements inside a group                |
| `3`     | 24px  | Groups inside a section                        |
| `4`     | 32px  | Subsections                                    |
| `6`     | 48px  | Sections                                       |
| `8`     | 64px  | Major divisions                                |
| `10`    | 80px  | Exceptional separation                         |

Rules:

- Space expresses relation. Keep more space between groups than inside them; the gap states what belongs together.
- Reach for spacing, alignment, and typography before a border, separator, card, or background. See the container rules in `interface-design.md`.
- Equal padding everywhere flattens hierarchy. Vary it deliberately.
- Whitespace is structural, not leftover. It isolates the decision; it does not turn an operational screen into a sparse scroll.

## Typography

One small scale, one ratio, few weights.

| Role            | Size    | Weight  |
| --------------- | ------- | ------- |
| Page title      | 30-32px | 700     |
| Section         | 18-20px | 600-700 |
| Component title | 15-16px | 600     |
| Body            | 14-16px | 400     |
| Metadata        | 12-13px | 400     |

- Keep weights to roughly 400, 500, and 700. Hierarchy comes from contrast in weight and size, not from five similar sizes.
- Design for scanning: titles, short labels, prominent values, grouping. Operational screens are scanned in an F or Z path, not read line by line.
- Keep body lines around 60-80 characters.
- Align numbers consistently in tables; see `data-tables.md`.
- Do not scale type continuously with the viewport; see `navigation-responsive.md`.

## Color

Define semantic tokens and never raw values in components:

```text
background  surface  surface-subtle  foreground  foreground-muted  border  ring
primary
success  warning  danger  info  neutral
```

- Define the palette in a perceptual space such as OKLCH, with HSL as an acceptable fallback, so lightness and chroma relationships hold across states and themes.
- Derive hover, active, selected, and disabled from the base token by a defined lightness or opacity step, not by choosing another color.
- Keep a dedicated focus ring token that stays visible on every surface.
- Keep operational panel tokens and public site tokens in separate namespaces; see `navigation-responsive.md`.

### 60 / 30 / 10

Distribute color roughly as 60% neutral background, 30% surfaces and structure, and 10%
accent for actions, states, and emphasis. Strong color is a scarce resource. When
everything stands out, nothing does.

### Color Carries Meaning

| Token   | Meaning                             |
| ------- | ----------------------------------- |
| success | Completed, healthy, approved        |
| warning | Needs attention, degraded, expiring |
| danger  | Failed, blocked, destructive        |
| info    | In progress, informational          |
| neutral | Inactive, secondary, draft          |

Never encode a state with color alone. Pair it with an icon or dot and a label, as the
shared status badge does.

## Radius, Elevation, And Depth

- Keep a small radius set and use it to group, not to decorate. Default to 8px or less in work surfaces.
- Prefer a border or a surface step over a shadow. Reserve elevation for genuinely floating layers: popover, dropdown, dialog, toast.
- Tokenize z-index by layer, so stacking is never guessed: dropdown, sticky, overlay, dialog, popover, toast.

## Interactive States

Every interactive element defines its states before it ships.

| State           | Requirement                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| `default`       | Legible and clearly interactive                                              |
| `hover`         | Perceptible change, pointer only, never the sole affordance                  |
| `focus-visible` | Always present, never removed, visible in both themes and on every surface   |
| `active`        | Distinct from hover, so a press is unmistakable                              |
| `disabled`      | Visually distinct, with an accessible explanation when the reason is unclear |
| `loading`       | Stable geometry and duplicate submission blocked                             |

Add `selected`, `error`, and `read-only` where the component supports them. A control whose
pressed state is indistinguishable from its resting state is unfinished.

## Motion

### The 100ms Rule

The interface acknowledges an interaction within about 100ms. When the operation takes
longer, show a pending state immediately: a skeleton when content will replace the surface,
an in-control pending state when the surface stays, real progress when it can be measured.

### Durations

| Transition                  | Duration  |
| --------------------------- | --------- |
| Hover and small state change | 100-150ms |
| Popover, dropdown, tooltip  | 120-180ms |
| Dialog, sheet, drawer       | 180-250ms |
| Layout and list reflow      | 200-320ms |
| Feedback such as toast entry | 150-300ms |

Use physical easing: `cubic-bezier(0.2, 0, 0, 1)` for standard moves, a decelerating curve
for entrances, an accelerating one for exits. Linear motion reads as mechanical.

### Animation Must Explain Something

Animate only to explain a change of position, a change of state, an appearance or
dismissal, progress, or temporal hierarchy. Ask what the animation tells the user. If the
answer is that it looks nice, remove it.

- Do not animate every row, every refetch, or every card on scroll.
- Animating five meaningful elements beats animating a hundred irrelevant ones.
- Respect `prefers-reduced-motion`: drop long travel and loops, shorten transitions, and keep functional feedback.

## Verification

- [ ] No arbitrary color, spacing, radius, z-index, or duration value was introduced.
- [ ] Spacing expresses grouping, and no container was added where space would do.
- [ ] Type roles come from the scale, with at most three weights.
- [ ] Accent color stays within roughly the 10% budget.
- [ ] No state is communicated by color alone.
- [ ] Every interactive element covers default, hover, focus-visible, active, disabled, and loading.
- [ ] Feedback appears within about 100ms, with a pending state beyond it.
- [ ] Every animation explains a change and respects reduced motion.
