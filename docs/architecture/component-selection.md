# Component Selection

Choose the control that represents the user's intention, not the one that can merely store
the value. A screen built by mapping each column type to its primitive input is the database
schema rendered as a form, which `cognitive-architecture.md` already forbids.

The target is the simplest interaction that feels natural, intentional, efficient,
accessible, and refined. Not the simplest component: the simplest component that gives the
user a strong experience.

## Intent Over Primitive Mapping

Do not map data types to controls mechanically.

| Mechanical mapping        | Ask instead                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| string -> text input      | Is it free text, a known value to search, or a choice from a set?    |
| number -> number input    | Is it a small quantity, a relative position, or an exact amount?     |
| boolean -> checkbox       | Does the change apply immediately, or when the form is submitted?    |
| enum -> select            | How many options, and does seeing them all help the decision?        |
| date -> text input        | Is it one day, a range, a common preset, or an available slot?       |
| array -> repeated inputs  | Is it a set of tags, a selection from a catalog, or an ordered list? |

For every interaction, weigh the user's intent, the number of possible values, the value
range, how often it is used, the precision it needs, how important it is, whether comparing
options matters, whether visual information helps, the space available, error prevention,
accessibility, mobile use, and the patterns the design system already provides.

## Decision Framework

1. **Intent**: name what the user is trying to accomplish, not the data type.
2. **Number of choices**: see the table below.
3. **Precision**: see the table below.
4. **Simultaneous visibility**: when seeing options side by side improves the decision, do not hide them in a dropdown.
5. **Visual nature**: when the choice is inherently visual, show it visually.
6. **Frequency**: optimize frequent actions for fewer interactions.
7. **Danger**: give dangerous actions safeguards proportional to their risk.
8. **Mobile and keyboard**: the control works with touch alone and with keyboard alone.

| Choices            | Default control                                                  |
| ------------------ | ---------------------------------------------------------------- |
| 1                  | Often no selector at all; show the value                         |
| 2                  | Switch, segmented control, or radio buttons                      |
| 3-5                | Segmented control, selection cards, radios, or chips             |
| 5-15               | Select or list, searchable when labels are long or unfamiliar    |
| Large or unbounded | Searchable combobox, autocomplete, or command palette            |

| Precision needed                          | Control                                              |
| ----------------------------------------- | ---------------------------------------------------- |
| Exact, arbitrary value                    | Input with the right input mode and formatting       |
| Relative position in a known range        | Slider with the current value visible                |
| Small increments of a bounded quantity    | Stepper                                              |

These are defaults, not laws. Context decides.

## Control Catalog

Each row maps to shadcn/ui and to the shared contracts in `component-system.md`.

### Numbers

| Intent                                                                     | Control                                                                  | Stack                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| Small bounded quantity adjusted by one: guests, seats, rooms, items        | Stepper `[-] 3 [+]`, with direct typing when values can grow large      | `IntegerStepperField`        |
| Approximate value in a known range: volume, opacity, intensity, threshold  | Slider with the current value, min and max labels, and ticks when useful | `Slider`                     |
| Minimum and maximum: price, age, distance                                  | Range slider with the selection in text, such as `$80 - $320`            | `Slider` with two thumbs     |
| Exact or arbitrary amount: invoice total, salary, measurement              | Input with `inputMode="decimal"` and locale formatting                   | `Input`                      |

A slider never captures a precise arbitrary value: an invoice amount of `137.42` is typed.
When a slider value must also be exact, pair it with a numeric input.

### Choices

| Intent                                                                  | Control                                                              | Stack                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- |
| Two to five modes the user should see at once                           | Segmented control                                                    | `ToggleGroup` with `type="single"`          |
| Options that differ in price, features, consequences, or recommendation | Selection cards with name, key differences, and a selected state     | `RadioGroup` rendered as cards              |
| Short tags, categories, or filter values                                | Chips, toggleable for multi-select                                   | `ToggleGroup` with `type="multiple"`        |
| Five to fifteen short, known options                                    | Select                                                               | `Select`                                    |
| Large sets: countries, people, products, projects                       | Searchable combobox; rich rows with avatar, name, and email for people | `Popover` with `Command`, or `EntityPickerDialog` |
| Controlled status, priority, or severity                                | Fixed choices with label and icon, never free text or color alone    | `ToggleGroup` or `Select`; `StatusBadge` to display |
| Ratings                                                                 | Stars or a segmented scale, operable by keyboard                     | `RadioGroup` with icons                     |

### Booleans

| The change...                                              | Control  |
| ---------------------------------------------------------- | -------- |
| Applies immediately: notifications, auto-save, visibility  | Switch   |
| Applies on submit, as part of a form                       | Checkbox |
| Is one of several independent selections                   | Checkbox |
| Records agreement or confirmation                          | Checkbox |

A checkbox that changes a setting immediately, or a switch that waits for a submit button,
misleads the user about when the change happens. An immediate switch confirms its effect
through feedback.

### Dates And Time

- Use a date picker instead of typed dates, unless typing is genuinely faster for the audience. The shared `DatePickerField` wraps `Popover` and `Calendar`.
- Use a range picker with presets for reports and filters: `Hoy`, `Ayer`, `Ultimos 7 dias`, `Ultimos 30 dias`, `Este mes`, `Personalizado`.
- For booking and scheduling, show availability, instead of letting the user pick an unavailable slot and fail on submit.

### Color, Images, And Visual Choices

- Choose colors from swatches or theme presets. Offer hex or RGB fields only as an advanced option.
- Show inherently visual choices visually: avatars, product photos, themes, layouts, and templates as thumbnails or preview tiles, never as text-only selects.

### Files

Use a drop zone with per-file preview, progress, validation, replacement, and removal, and
state the accepted types and the maximum size before the user picks a file. The full
lifecycle lives in `forms-and-workflows.md` and the `FileField` contract.

## Action Hierarchy

Actions are components too. Give each action a level, and keep each level on the same
variant across the application.

| Level       | Examples                               | Button variant                                     |
| ----------- | -------------------------------------- | -------------------------------------------------- |
| Primary     | Guardar, Crear, Continuar, Confirmar   | `default`, one per surface                         |
| Secondary   | Volver, Vista previa, Duplicar         | `outline` or `secondary`                           |
| Tertiary    | Cancelar, Mas informacion              | `ghost` or `link`                                  |
| Destructive | Eliminar, Quitar, Restablecer          | `destructive`, never mistakable for a safe action  |

How many may be visible at once is set by the action budget in `cognitive-architecture.md`.
How destructive actions are confirmed, or undone, is set by `forms-and-workflows.md`.

## Native First For Accessibility

A visually attractive component that reduces accessibility is not an improvement.

- Prefer native elements when they already meet the need.
- Prefer shadcn/ui components, which build on Radix primitives with keyboard and ARIA behavior, over hand-built widgets.
- A custom control matches its native equivalent on keyboard operation, focus, labeling, and screen reader announcements, or it is a regression.
- Use ARIA only when semantic HTML cannot express the role.

## Two Biases To Resist

### Primitive UI Bias

Generated frontend code converges on screens made only of `input`, `select`, `textarea`,
`checkbox`, and `button`. Those primitives are valid, but they are not automatically the
final experience. Evaluate the higher-level control before settling on one.

### Component Novelty Bias

The opposite mistake replaces every native input with a custom widget. Do not use:

- a slider where typing an exact value is easier;
- a dropdown for two choices;
- a carousel for static information;
- a modal for everything;
- cards, charts, gradients, or animation as decoration;
- a custom widget that is less accessible than the native one.

## Context Beats Rules

The same component is excellent in one context and wrong in another.

| Component         | Excellent for                  | Wrong for                       |
| ----------------- | ------------------------------ | ------------------------------- |
| Slider            | Volume from 0 to 100           | A monthly salary of `$4,825`    |
| Selection cards   | Choosing between three plans   | Choosing one of 200 countries   |
| Segmented control | Three viewing modes            | Twelve categories               |
| Switch            | A setting that applies now     | A field submitted with a form   |

## Examples

| Avoid                                                | Prefer                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `Cantidad: [ 3 ]`                                    | `[-] 3 [+]`, editable when quantities can be large                      |
| `Opacidad: [ 65 ]`                                   | A slider with `65%` visible                                             |
| `Modo: [ Equilibrado ▼ ]`                            | `[ Rapido ] [ Equilibrado ] [ Calidad ]`                                |
| `Plan: [ Profesional ▼ ]`                            | Plan cards with name, price, key features, recommended and selected states |
| `[ ] Activar notificaciones` as an instant setting   | `Notificaciones` with a switch                                          |
| `[ Seleccionar usuario ▼ ]` with hundreds of rows    | A searchable combobox with avatar, name, and email                      |
| `Estado: [ En progreso ]` as free text               | `[ Pendiente ] [ En progreso ] [ Revision ] [ Hecho ]` as fixed choices |

## Agent Behavior

Choosing the control is part of implementing the feature, not an optional polish request.
When a requirement states the behavior but not the control, choose the most appropriate
interaction pattern. "Let the user choose between 1 and 8 guests" does not mean
`<input type="number">`; evaluate a stepper first.

Improving the interaction never changes the product. See the scope rules in `frontend.md`.

Balance usability, visual quality, accessibility, consistency, and implementation
simplicity. Do not optimize one by severely damaging another.

## Reject The Change When

- a form is a column of generic inputs that mirrors the schema;
- a dropdown offers two choices, or hundreds without search;
- a slider captures a precise arbitrary number;
- free text captures an enumerable state;
- a checkbox acts as an immediate on/off setting;
- options that fit on screen are hidden in a menu;
- a destructive action looks like a safe one;
- a custom control is less accessible than its native equivalent;
- complexity was added that does not improve the experience.

## Verification

- [ ] Each control was chosen from the user's intent, not from the column type.
- [ ] Choices that fit on screen are visible, and large sets are searchable.
- [ ] Exact values are typed, approximate ones may slide, and small quantities step.
- [ ] Switches apply immediately, and checkboxes wait for submit.
- [ ] Visual choices are shown visually.
- [ ] Action levels map to consistent button variants, and destructive actions stand apart.
- [ ] Custom controls match native keyboard, focus, label, and screen reader behavior.
- [ ] Nothing was added that the task does not need.
