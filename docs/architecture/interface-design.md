# Interface Design For Operational Applications

## Goal

Reduce cognitive and visual workload while keeping frequent actions fast. A screen is
successful when the user can identify where they are, understand current state, and
perform the primary task without reading implementation commentary.

## Start From The User Task

The screen brief in `cognitive-architecture.md` is answered before this document applies:
who uses the screen, what they are trying to accomplish, the primary decision, the minimum
information that decision needs, and the single primary action.

With those answers settled, place the content:

1. What belongs in the initial view, and what belongs in detail, history, or an advanced view?
2. Which fields can the backend derive instead of asking the user for them?
3. Which information is P0, P1, P2, or P3?

If the brief is missing, do not compensate with more cards, text, or controls. Go back and
answer it.

## Choose The Primary Surface

| User need                                          | Preferred surface              |
| -------------------------------------------------- | ------------------------------ |
| Scan, compare, filter, and act on records          | Table-first module             |
| Create or edit a short independent record          | Modal dialog                   |
| Complete a long, high-risk, multi-section workflow | Full page                      |
| Inspect one record without losing list context     | Detail modal or drawer         |
| Adjust a small local value                         | Inline control when reversible |
| Switch lenses or filters over one collection       | Internal view selector         |
| Reach a section with its own records and actions   | Sidebar submodule              |
| Monitor a few decision-driving metrics             | Compact dashboard              |

Do not put a full CRUD form permanently next to its table. Do not use a modal for a
workflow that needs extensive context, several sections, or comparison while editing.

Do not use tabs to separate the pages of a module. A section with its own records,
actions, or permission is a destination and belongs in the sidebar, not behind a tab. See
`navigation-responsive.md`.

## Standard Mental Models

Prefer the pattern the user already knows. Reinventing an interaction is justified only by a
functional problem the established pattern cannot solve, and that reason belongs in the
design of the OpenSpec change.

| Need                                 | Established pattern       |
| ------------------------------------ | ------------------------- |
| Persistent navigation                | Sidebar                   |
| Position in a hierarchy, and the way back | Breadcrumb           |
| Sibling views over data already on screen | Tabs or segmented control |
| Secondary options                    | Dropdown menu             |
| A temporary, focused decision        | Modal                     |
| Contextual detail without losing the list | Drawer or sheet      |
| Comparing entities                   | Table                     |
| A sequence of events                 | Timeline                  |
| Work moving through stages           | Kanban                    |
| A guided multi-step process          | Wizard                    |

## Master And Detail

When the user inspects many records in a row, keep the collection and open the record
beside it: table plus drawer or detail modal. Move to a full detail page when the work is
deep, owns its own sections, or needs a URL worth sharing.

Either way, returning restores the list as the user left it: filters, sorting, page, scroll
position, and selection. See `cognitive-architecture.md`.

## Module Composition

A standard list module should usually contain:

1. Page breadcrumb or context label and one page title.
2. One compact module header with icon, concise description, and primary actions when needed.
3. One table surface containing search, filters, columns, rows, and pagination.
4. Focused dialogs for create, edit, detail, assignment, import, or advanced filtering.

Remove the module header when the page title and table title already communicate the
same thing. Never repeat the same title and description in consecutive containers.

In this repository, migrated screens use `PageHeader` (`frontend/src/components/layout/`,
`productize-invoice-list-and-shared-table-foundation`) for steps 1 and 2:
- the page title as the only `h1`;
- an optional description and context;
- one primary-action slot and separate secondary actions, so a screen cannot ship two primary
  actions.

Breadcrumbs live in the shell's top bar, without a title, for every screen (owner
decision on the header, 2026-10-16; `navigation-responsive.md`). No screen paints its own, and no
«back» link repeats a breadcrumb. The shell's Quick Create stays an
`outline` secondary control.

### `PageHeader` grammar

One header component with three variants (`productize-invoice-editor-and-composition-foundation`,
design D3). No screen builds its own header.

| Variant | Breadcrumbs | Title | Description | Context | Primary action | Secondary actions |
| --- | --- | --- | --- | --- | --- | --- |
| List (`variant="list"`, Facturas) | None | `h1` | Optional | Optional | Right of the title | Next to the primary |
| Editor (`variant="editor"`, invoice editor) | None (top bar) | `h1` | None | None: the save state («Sin guardar», «Guardado») sits in the summary, as neutral text | None: actions live next to the summary or in the action bar | None |
| Configuration and reading (written for the migration of those screens) | None (top bar) | `h1` | Yes | Optional | Right, inside the width of its role (`max-w-form` or `max-w-reading`) | Next to the primary |

- **Form titles** (owner decision, 2026-10-22): a form names only its entity («Factura»,
  «Tercero») and carries its state in a `FormStateBadge` inside the `h1`, at the end of the title row: «Nuevo»/«Nueva» before
  the first save (informative tone), «Borrador» for a saved document draft (the neutral badge of
  the lists) and «Corrección» when correcting a record. Document editors use `EditorTitle`; the
  entity creation dialogs (tercero, usuario, establecimiento) pass the same badge to `FormDialog`.
  Breadcrumbs keep their wording.
- **Fixed rhythm:** the title block is at least 40px high, the height of the default button, with
  the title centered. The title lands on the same y with or without an action.
- **Spacing:** 8px between the breadcrumb row and the title, and 24px from the header to the content
  (the `gap-6` of the screen's section).
- **Breadcrumb owner:** only a route that declares `orientation: "page-header"` may use the editor
  variant; the header paints the breadcrumbs only there. Every other route keeps the shell's row.
- **Scope today:** the list and editor variants are implemented, because they have consumers. The
  configuration variant is documented so those screens migrate to it instead of inventing another
  header.

A module is complete when everything it offers works end to end against the real backend:
list, create, edit, detail, and the removal or deactivation the domain allows. A list that
renders while its create dialog fails is an unfinished module.

## Information Hierarchy

- Use one clear page title; reserve large typography for true page-level hierarchy.
- Keep panel headings compact and aligned with their density.
- Put primary actions at the top-right of the surface they affect.
- Keep filters physically attached to the data they filter.
- Put row-specific detail and commands in row actions.
- Use helper text only when it prevents a realistic error. It goes beside the label, behind an
  exclamation icon with a tooltip (`FieldHint`), not as small text below the field (owner decision,
  2026-10-22); a live value such as a character count stays visible below.
- Use labels, not placeholder-only inputs.
- Prefer domain language over technical abbreviations.

## Visual Fatigue Guardrails

- Do not wrap every section in a floating card.
- Do not nest cards inside cards.
- Do not add KPI cards above every table; add a metric only when it changes a decision.
- Do not add large empty panels to balance a layout.
- Do not render permanent success, loading, or informational banners after routine actions.
- Do not repeat descriptions already clear from the label or selected navigation item.
- Do not put secondary detail beside a table when it can open from the selected row.
- Do not expose every advanced option by default; use progressive disclosure.
- Avoid decorative gradients, oversized radii, and ornamental backgrounds in work surfaces.

Whitespace should clarify groups, not make an operational screen sparse and scroll-heavy.

## Generated Defaults To Avoid

Generated interfaces converge on the same recognizable choices. They are not neutral, and
they make every product look alike. The guardrails above already cover gradients, oversized
radii, and ornamental backgrounds; these are the rest:

| Default                                | Why it fails                                                        |
| -------------------------------------- | ------------------------------------------------------------------- |
| A violet or indigo palette by habit    | Signals a template rather than this product's palette               |
| Uniform maximum corner rounding        | Erases the radius hierarchy that real systems use to group elements |
| A generic hero section                 | Layout chosen before content, unrelated to the user's task          |
| Placeholder prose instead of real copy | Hides wrapping, length, and overflow problems until production      |
| Uniform card grids for everything      | Ignores information priority and how the user scans                 |
| Layered shadows for depth              | Competes with content and costs rendering on low-end devices        |
| Generous equal padding everywhere      | Destroys hierarchy and wastes the screen on operational work        |

Use the project's real palette, spacing scale, radius set, and content. Never invent a
spacing or radius value that is not on the scale.

## Cards, Bands, And Containers

Use cards for repeated entities, bounded tools, dialogs, and genuinely independent
objects. Use unframed sections or full-width bands for page structure. Keep radius at
8px or less unless the established design system says otherwise.

## Commands And Controls

- Use icon buttons for familiar compact commands such as edit, delete, refresh, close, download, and visibility.
- Give every icon-only command an accessible name and opaque tooltip.
- Use text or icon-plus-text for primary commands whose meaning is not universal.
- Choose each control from the user's intent, not from the data type: switches, segmented controls, selection cards, chips, sliders, steppers, and searchable comboboxes each fit a different task. See `component-selection.md`.
- Keep primary actions solid and visually consistent across modules.
- Destructive actions require clear wording, confirmation proportional to risk, and lifecycle-safe backend behavior.

## Dashboards

Dashboards summarize decisions; they are not a substitute for modules, and they are not a
gallery of KPIs. A dashboard answers four questions: what is happening, what changed, what
needs attention, and what to do about it. Order the screen the same way: attention first,
then results, then trend, then analysis, then the records behind them.

- Keep KPI count small and attach context such as period, trend, or comparison.
- Do not give ten metrics the same weight. One of them is why the user opened the screen.
- Use charts only when shape, composition, or change is easier to understand visually.
- Keep operational tables after summaries when users need to inspect the underlying records.
- Do not duplicate the same aggregate in a KPI, chart, and summary list.
- Empty dashboards should explain setup or next action, not fabricate demo data.

Choose each visualization from the question it answers, never from how impressive it looks.

| Question                                   | Visualization                                   |
| ------------------------------------------ | ----------------------------------------------- |
| How does it change over time?              | Line chart                                      |
| How do these items compare?                | Bar chart                                       |
| How far along is it?                       | Progress indicator                              |
| What is the one number that matters?       | Metric with its period and comparison           |
| How are the values distributed?            | Histogram                                       |
| What makes up the whole?                   | Stacked bar; a pie only with very few parts     |
| What state is it in?                       | Status badge                                    |

## Business Language

Show what the user recognizes:

- a person or organization name instead of an internal identifier;
- a searchable record label instead of a foreign-key input;
- a status label instead of an enum token;
- a masked secret state instead of a credential reference;
- a generated human reference when a record needs one.

### Voice

Write for someone who must understand the screen the first time they read it:

- address the user directly; do not narrate the system in the third person;
- name the action and the object, not the mechanism that performs it;
- do not explain business rules, internal processes, or third-party services in the interface;
- do not quote requirement documents, ticket numbers, or specification sections in visible copy;
- keep that traceability in code comments or documentation, never on the product surface;
- delete any sentence the user does not need in order to decide or act.

Technical detail belongs in permission-gated audit or diagnostic views.

## Final Simplification Pass

Before declaring the screen complete, remove one unnecessary layer:

- a duplicated heading;
- a summary that does not affect a decision;
- a card border around a page section;
- helper text that restates the label;
- a visible technical field the backend can derive;
- a control that can move into a row action or advanced dialog.

Then verify that the primary action and current state remain obvious.
