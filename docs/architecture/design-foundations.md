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

Use one arithmetic scale. The Tailwind base is 4px (`--spacing: 0.25rem`), the scale of the
reference template (ADR 0028). Steps of 8px are still the default rhythm, and 4px is reserved for
optical correction.

| Token   | Value | Use                                            |
| ------- | ----- | ---------------------------------------------- |
| `1`     | 4px   | Optical adjustment, such as icon to label      |
| `2`     | 8px   | Tightly bound elements                         |
| `4`     | 16px  | Related elements inside a group                |
| `6`     | 24px  | Groups inside a section                        |
| `8`     | 32px  | Subsections                                    |
| `12`    | 48px  | Sections                                       |
| `16`    | 64px  | Major divisions                                |
| `20`    | 80px  | Exceptional separation                         |

Until 2026-10-14 the base was 8px (`--spacing: 0.5rem`, so `p-2` meant 16px). The change
`adopt-premium-design-foundation-and-shell` moved to base 4 with a one-shot codemod.
- **What the codemod did:** it doubled the number of every Tailwind utility that multiplies
  `--spacing` (padding, margin, gap, space, width, height, size, inset, translate, basis, scroll
  spacing), only inside string and template literals of `frontend/src`. `p-2` became `p-4`, `h-5.5`
  became `h-11`. Every computed value stayed the same.
- **Proof:** the spacing proof of the visual harness, with zero changed pixels and identical boxes on
  the five baseline screens.
- **Where it lives now:** in the history of that change. It is no longer in the tree.

Any value written before that date in a document or a review comment is on the old scale.

Rules:

- Space expresses relation. Keep more space between groups than inside them; the gap states what belongs together.
- Reach for spacing, alignment, and typography before a border, separator, card, or background. See the container rules in `interface-design.md`.
- Equal padding everywhere flattens hierarchy. Vary it deliberately.
- Whitespace is structural, not leftover. It isolates the decision; it does not turn an operational screen into a sparse scroll.

## Content Widths

Width says what kind of screen it is (`productize-invoice-editor-and-composition-foundation`, design
D4). Three roles, with `--container-*` tokens in `globals.css` so Tailwind generates the utilities
without arbitrary values:

| Role | Token | Utility | Value |
| --- | --- | --- | --- |
| Reading | `--container-reading` | `max-w-reading` | 42rem (672 px) |
| Form | `--container-form` | `max-w-form` | 48rem (768 px) |
| Workspace | `--container-workspace` | `max-w-workspace` | 72rem (1152 px) |

Content is never full width: the shell centers every screen in one column. The column has the
workspace width, and narrows to reading or form when the screen root declares
`data-page-width="reading"` or `data-page-width="form"`. Breadcrumbs, title and content share that
column, so their left edges align at every width.

`--container-form-rail` (57.5rem) is the container width from which a form's side panel sits beside
the form (`@form-rail:`). The screens that used `max-w-xl`, `max-w-2xl`, `max-w-3xl` and
`max-w-5xl` now declare their role, as listed in `component-system.md`.

## Typography

One small scale, one ratio, few weights. The family is Geist Sans, a single variable font served
from the application's own origin by the `geist` package (`next/font/local`, OFL-1.1, ADR 0028),
with the system stack as fallback. There are no other families.

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

Define semantic tokens and never raw values in components. `frontend/src/app/globals.css` is the
only source (ADR 0028):

```text
background  foreground  card  popover  secondary  muted  muted-foreground  accent
border  input  ring  overlay  sidebar-*
primary
success  warning  destructive  info   (each with its -foreground)
```

- **Neutrals and surfaces** come from the reference template.
- **`primary`** is the single EmiteYa blue. It is used for primary actions and purposeful emphasis,
  never to encode a fiscal state. A highlighted option uses a soft bluish gradient of `primary` at
  20 %, 10 % and 5 % (owner decision, 2026-10-22; «Consumidor final» when choosing a buyer), so its
  text keeps its own tokens instead of sitting on a solid block.
- **Semantic colors** come from EmiteYa. In the light theme, `success`, `info` and `warning` were
  darkened slightly so that text on them reaches 4.5:1 and their icons reach 3:1 on the background.
- **`input`** is the border of every field (owner decision, 2026-10-22): a soft gray, one step
  darker than the card `border` (`oklch(0.87 0 0)` light, `oklch(0.37 0 0)` dark). It covers
  inputs, selects, filter triggers, segmented controls, chips, the switch and the native
  checkboxes, which drop their own dark border for it. It used to keep 3:1 against background and
  surface (WCAG 1.4.11); the owner traded that for a lighter look. Every field keeps a visible
  label, and focus keeps its solid 3:1 ring. The token test checks that the border stays visible
  (at least 1.3:1) and below 3:1, and darker than the card border in the light theme.
- **`ring`** is solid, never translucent.
- **Legacy aliases** (`surface`, `surface-subtle`, `foreground-muted`, `danger`,
  `danger-foreground`, `neutral`) map to the canonical tokens until every screen migrates. New code
  uses the canonical names.
- **Contrast** of every pair in use is checked by `frontend/test/design-tokens.test.ts`, and
  contrast wins over a literal template value.
- **Dark theme for sustained use** (`adopt-premium-design-foundation-and-shell`, design D28). The
  template's near-black background with near-white text gave 18.96:1 and glared in long sessions.
  - **Values:** background `oklch(0.18 0 0)` (`#121212`) and foreground `oklch(0.93 0 0)`, with the
    foreground and muted foreground (0.72) taken from the template's Tangerine preset.
  - **Surfaces:** neutral and stepped: sidebar 0.2, card and popover 0.225, muted, secondary and
    accent 0.285.
  - **Unchanged:** primary, semantic colors, `input` and `ring` (`input` changed later, on
    2026-10-22).

  | Pair | Before | After |
  | --- | --- | --- |
  | Foreground / background | 18.96:1 | 15.30:1 |
  | Foreground / card | 17.16:1 | 13.92:1 |
  | Muted foreground / background | 8.28:1 | 7.58:1 |
  | Muted foreground / muted | 6.32:1 | 5.79:1 |
  | Foreground / accent (hover, active) | 14.48:1 | 11.68:1 |
  | Primary foreground / primary | 6.71:1 | 6.71:1 |
  | Primary (link) / background | 6.85:1 | 6.50:1 |
  | Form border / card | 3.69:1 | 3.52:1 (until the soft field border of 2026-10-22; see `input`) |

  Everything stays at WCAG AA or better, and the token test guards against near-pure black and
  white in the dark theme.
- **Environment, not status.** `Badge` has a neutral, high-attention `emphasis` variant (inverted
  contrast) for context such as Producción. A context is never drawn as a success.

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
| destructive (`danger`) | Failed, blocked, destructive |
| info    | In progress, informational          |
| neutral | Inactive, secondary, draft          |

Never encode a state with color alone. Pair it with an icon or dot and a label, as the
shared status badge does.

## Radius, Elevation, And Depth

- Keep a small, named radius set and use it to group, not to decorate. The scale is the template's
  (ADR 0028, which supersedes the former 8px maximum): `--radius` is 10px, with `sm` 6px, `md` 8px,
  `lg` 10px and `xl` 14px; `2xl` to `4xl` are reserved for large floating surfaces. Never write an
  arbitrary radius in new code; a derived primitive that technically needs one documents it as an
  isolated exception.
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

- **Disabled reads as unavailable, not as a faded variant**
  (`productize-invoice-editor-and-composition-foundation`, design D9). Filled buttons turn to the
  `muted` surface with `muted-foreground` text; quiet buttons dim only their text. Never lower the
  opacity of the variant color. The disabled text keeps at least 3:1 on `muted` in both themes
  (`design-tokens.test.ts`).
- **Loading is not disabled.** A pending `AsyncButton` (`aria-busy`) keeps its variant color with
  the indicator.
- **Selected is neutral** (design D10). Chips and segmented controls show the chosen option by
  shape, border and weight on neutral surfaces; the primary color stays with the main action.

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
