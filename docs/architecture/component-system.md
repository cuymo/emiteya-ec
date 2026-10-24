# Shared Frontend Component Contracts

## Purpose

The exact component names may follow the codebase, but each application should provide
one shared implementation for recurring operational interactions. Do not create a new
variant in each module.

## Foundation

Prefer shadcn/ui primitives styled through semantic Tailwind tokens. Use Lucide icons
instead of hand-drawn SVGs when a suitable icon exists. Treat third-party component
registries as source code to review and adapt, not as an independent design system.

## Derived Design System (ADR 0028)

The primitives come from the source code of the reference template «Studio Admin», kept outside the
repository and never versioned. A primitive is copied only when a change needs it, adapted to the
tokens, the CSP and the accessibility rules, and recorded in the change's traceability table and in
`frontend/THIRD_PARTY_NOTICES.md`.

- **Source ownership.** Each shared component belongs to one of four classes:
  - **TEMPLATE-DERIVED:** copied and adapted from the template, with a provenance comment. Examples
    are `components/ui/button.tsx`, `sidebar.tsx`, `sheet.tsx`, `dropdown-menu.tsx`,
    `tooltip.tsx`, `command.tsx`, `badge.tsx`, `breadcrumb.tsx`, `empty.tsx`, `avatar.tsx`,
    `kbd.tsx`, `separator.tsx`, `collapsible.tsx`, `skeleton.tsx` and `hooks/use-mobile.ts`.
  - **EMITEYA-EXISTING:** an earlier EmiteYa component that stays, such as `ui/dialog.tsx`,
    `EntityPickerDialog`, `ConfirmDialog`, `AppDataTable` and `FileField`.
  - **NEW SHARED:** a new application component composed from primitives, such as the
    breadcrumbs and the route states.
  - **NEW DOMAIN:** a component of a business concept.
- **Extension rule.** When the template lacks a component EmiteYa needs:
  1. compose it from the existing primitives;
  2. use the same tokens, sizes, radii, focus ring, motion, responsive behavior and accessibility
     conventions;
  3. give it component-level tests;
  4. reuse it wherever the same need appears.

  Never solve the need separately in each page.
- **One implementation per pattern.** There is one `Button`, one menu and tooltip system, and one
  skeleton. Earlier components that are still in use become compatibility facades over the derived
  primitive:
  - `components/ui/menu-and-tooltip.tsx` keeps the old `Menu`/`Tooltip` API and item height over
    `dropdown-menu` and `tooltip`;
  - `components/states.tsx` re-exports `Skeleton`.

  Facades are transitional and leave as screens migrate.
- **Control sizes are variants.**
  - `Button` sizes: `default` (36px), `sm` (32px), `xs` (24px, only inside chips), `icon`,
    `icon-sm` and `icon-xs`, all at least 44px of touch target below 768px.
  - The `legacy-*` sizes (`legacy-md`, the default while unmigrated screens exist, plus
    `legacy-sm`, `legacy-icon` and `legacy-icon-sm`) are migration compatibility variants. They
    keep the height, padding, gap, touch target and icon size of the earlier button. New code must
    not use them, a migrated screen must not keep them, and they are removed when migration reaches
    100%.
  - An icon-only button is a size, not a color. It always has an `aria-label`, plus a tooltip when
    the context asks for one.
- **Focus.** Modal layers return focus to whoever opened them, also when controlled, through
  `components/ui/use-return-focus.ts` (dialog and sheet).
- **Disabled is neutral; pending is not disabled** (`productize-invoice-editor-and-composition-foundation`,
  design D9).
  - A disabled `primary`, `secondary`, `destructive` or `danger` button becomes `bg-muted
    text-muted-foreground`, without shadow or variant color. A disabled `outline`, `ghost` or
    `link` keeps its surface and dims its text to `text-muted-foreground`; `outline` also dims its
    border. `aria-disabled` behaves the same.
  - No opacity over the variant color: a washed-out primary still reads as the main action.
  - `AsyncButton` while pending (`aria-busy`) keeps its variant with the indicator: an action in
    progress is not an unavailable action. Every disabled rule is written `disabled:not-aria-busy:`.
  - In dark mode `outline` is transparent, so it never reads as a filled block.
- **`danger` is the solid red main action** (owner decision, 2026-10-16) for the riskiest step,
  such as switching to Producción, on the screen and in its confirmation (`ConfirmDialog`
  `tone="danger"`). Like `primary`, one per screen. `destructive` stays the soft red for
  deleting, and a red-text outline marks «Desactivar».
- **Active is blue** (owner decision, 2026-10-17; replaces the neutral selection of design D10).
  Everything active or chosen uses the primary blue, never gray, and never by color alone.
  - **Tokens:** `--active` is a soft blue tint and `--active-foreground` is the primary blue
    (light 5.25:1; dark `oklch(0.82 0.11 255)` on `oklch(0.3 0.06 255)`, 7.73:1).
    `--accent` maps to them, so menu highlights (`focus:bg-accent`) and the topbar hover are blue
    too. `frontend/test/design-tokens.test.ts` guards both pairs.
  - **Soft tint with blue text:** the sidebar's current destination (`data-active:bg-active`, hover
    stays the neutral `sidebar-accent`), Facturas' views (`ui/toggle.tsx`), the current page in
    pagination (with a `primary/40` border), the highlighted command palette item and the active
    option in `EntityPickerDialog` (with a `primary` ring).
  - **Blue text and mark:** the current tab (`text-primary` and its underline), and the checked
    option of `SelectMenu` and dropdown menus (`text-primary` and its check).
  - **Solid blue piece:** `SegmentedControl`. The chosen option is a raised `bg-primary` piece with
    a `primary` ring and a small shadow inside a `muted` track. The `tone` prop is gone. With
    `fullWidth` it fills its container and splits it equally among the options (owner decision,
    2026-10-22; the debit note's cause and IVA treatment).
  - **Still neutral:** a list filter's trigger (`DataTableSelectFilter`) shows its value in its text
    («Estado: Activos»), because it is a form control, not a selection.
- **One primary per surface, also when empty** (design D11). When the page header offers an
  action, the empty state offers the same action as `outline`, never as a second primary.
- **Content widths by role** (design D4), as `--container-*` tokens in `globals.css`:

  | Role | Token | Utility | Value | Use |
  | --- | --- | --- | --- | --- |
  | Reading | `--container-reading` | `max-w-reading` | 42rem (672 px) | Text and status: Inicio, Ambiente |
  | Form | `--container-form` | `max-w-form` | 48rem (768 px) | One-column forms: Empresa, Mi cuenta, long dialogs |
  | Workspace | `--container-workspace` | `max-w-workspace` | 72rem (1152 px) | Lists and editors with a side panel |

  - `--container-form-rail` (57.5rem) is the container width from which a form's side panel goes
    beside the form, with the `@form-rail:` variant: 36rem of form, 1.5rem of gap and a 20rem
    panel, the width the summary amounts need. Below it the panel stacks after the form.
  - The shell centers every screen in a workspace column. A screen narrows it by declaring its role
    on its root, also in its loading, error and no-permission states:
    `data-page-width="form"` (Mi cuenta) or `data-page-width="reading"` (the readiness screen).
    The Configuración sections live beside their vertical tabs (below the tab row on narrow
    screens; owner decision, 2026-10-23): their screens
    declare `data-panel-width="form"` (Establecimientos and Firma electrónica) or
    `data-panel-width="reading"` (Ambiente), and the tab panel narrows to it. Usuarios and Portabilidad keep the full width because they hold data tables.
  - Establecimientos also adds `data-panel-align="center"`: with no visible title (the tab names
    it; its `h1` is only for screen readers), its list is centered in the panel, and creating an
    establishment is a dashed card that closes the list instead of a header button. Each
    establishment ends with a dashed «Agregar punto de emisión» row, and its actions («Corregir
    dirección», «Desactivar» or «Reactivar», also on each point) are outline buttons with their
    name visible, because a bare icon is not recognized as a button; «Desactivar» has red text.
    Each point also has a «Secuenciales» toggle that unfolds its counters for the current
    environment, under a small «Ambiente: Pruebas» or «Ambiente: Producción» badge, each with
    «Ajustar» (`point-sequences.tsx`); they used to have their own tab.
  - Ambiente is centered too, with its `h1` only for screen readers: one card with the current
    environment and the readiness to emit, and a footer with the action («Cambiar a Producción» in
    `danger`, «Volver a Pruebas» in `outline`).
  - Portabilidad de datos keeps the full width for its history table; its `h1` is only for screen
    readers, and its one-line description sits beside «Generar exportación».
  - Firma electrónica is centered the same way, with its `h1` only for screen readers. One card
    holds the certificate data, then the expiry notice, and a footer with «Guardar aviso»
    (outline, always enabled: with no change it says so instead of sending) and «Reemplazar
    firma» (primary).
  - Empresa and Catálogos fiscales use the settings layout and the full width: the tab already
    names the screen, so their `h1` is only for screen readers. `SettingsSections` and
    `SettingsSection` (`components/layout/settings-section.tsx`) put each section's title and a
    one-line description (and, in Catálogos, its source) to the left of its content from the
    `--container-settings-split` container (48rem, variant `@settings-split:`), with a divider
    between sections. Empresa ends with its save action; its logo control lives in
    Identificación and applies at once, without the save action.
  - Screens never set their own `max-w-*`, which would leave them aligned to the left inside the
    column.

### Staged Duplication Enforcement

`frontend/eslint.config.js` applies strict rules only to new shell code; legacy code keeps its rules
until its screen migrates.

- **Scope:** `src/components/shell/**`, `src/components/route-states/**`, `src/lib/navigation/**`
  and `src/hooks/**`.
- **What those paths may not contain:**
  - direct `radix-ui` imports (use `components/ui`);
  - the legacy facades and components (`components/ui/menu-and-tooltip`, `components/states`,
    `components/notice-strip`);
  - arbitrary Tailwind values (arbitrary variants are allowed);
  - literal hex colors;
  - `legacy-*` sizes;
  - the JSX `style` attribute;
  - a `Button` without an explicit `size`.
- **In `src/components/ui/**`,** only the `style` attribute is forbidden. The internal arbitrary
  values of template-derived primitives stay, documented in ADR 0028.
- **Growth:** when a screen migrates, its paths join the first list in the same change.
- **Tests:** `frontend/test/staged-lint.test.ts` runs ESLint with the real configuration and checks
  that each rule fires and that correct code passes.

## System Layers

Keep one direction of dependency, from generic to specific:

```text
primitives -> system components -> domain components -> features -> pages
```

| Layer            | Knows about                            | Example                    |
| ---------------- | -------------------------------------- | -------------------------- |
| Primitive        | Tokens and interaction mechanics       | `Button`                   |
| System component | Application-wide interaction contracts | `AppDataTable`, `FormDialog` |
| Domain component | One business concept                   | `ApprovalDecision`         |
| Feature          | One workflow                           | `ApprovalPanel`            |
| Page             | Routing, layout, and data loading      | `ApprovalScreen`           |

- A layer may use the layers below it, never the ones above.
- Business rules never sink into a primitive or a system component.
- A page composing primitives directly is fine. A primitive importing a domain type is not.
- Do not promote something used once into a domain component. Compose it in place until repetition proves the concept.

## Recommended Inventory

| Example contract        | Responsibility                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| `AppDataTable<T>`       | Search, filters, sorting, columns, rows, selection, states, and pagination |
| `DataTableCard`         | The list card: title, search and actions in its header, then the filters row |
| `DataTableFooter`       | One footer: page size, range and numbered pagination                      |
| `DataTable<T>` and its pieces | The shared list base of every list (`data-tables.md`, «Implementation In This Repository») |
| `PageHeader`            | Page title (`h1`) in a 40px block, optional context; `list` variant with description, one primary-action slot and secondary actions; `editor` variant with no actions (the route's breadcrumbs live in the topbar) (`frontend/src/components/layout/page-header.tsx`; grammar in `interface-design.md`) |
| `ColumnVisibilityMenu`  | Business-facing optional column selection                                  |
| `RowActionButton`       | Icon action with permission/state handling and opaque tooltip              |
| `FormLayout`            | Form and optional 20rem side panel, beside it from a 57.5rem container (`--container-form-rail`) and stacked after it below; reading order form, panel, actions (`frontend/src/components/layout/form-layout.tsx`) |
| `FormSection`           | Form section with an `h2`, an optional badge beside it, optional description, a local action in its header and a thin top rule; named by its title, which `hideTitle` keeps only for assistive technology when the field labels already say it |
| `FormGrid`              | Fields in columns by container (two from 40rem, `--container-form-wide`), aligned by label, control and message with `subgrid` |
| `FormFieldRow`          | One row of fields read as a unit, such as a payment: a `fieldset` with its legend, `subgrid` alignment and the inline action in the control row |
| `StickySummaryPanel`    | The summary surface of a form, sticky beside it or a section after it |
| `StickyFormActions`     | Primary and secondary actions with the written reason of an unavailable one (`aria-describedby`), at the foot of the panel or as a sticky bottom bar that reserves its height for focus |
| `FormDialog`            | Accessible create/edit modal with stable header, body, and footer          |
| `EntityPickerDialog<T>` | Searchable, filterable, paginated relationship selection                   |
| `ConfirmDialog`         | Risk-proportional confirmation, with typed name when irreversible          |
| `DatePickerField`       | Localized, theme-aware date selection with clear behavior                  |
| `DateTimePickerField`   | Date/time selection with explicit commit when required                     |
| `PasswordField`         | Masked sensitive input with accessible visibility toggle                   |
| `FileField`             | Upload, replace, rename, and remove managed files with per-file state      |
| `IntegerStepperField`   | Bounded whole-number input with increment/decrement controls               |
| `SegmentedControl`      | Two to five visible, mutually exclusive options with stable geometry       |
| `SelectionCardGroup`    | Radio-card choice among options with meaningful differences                |
| `DataTableSelectFilter` | One value of a list filter or view, as a prefixed listbox               |
| `SliderField`           | Approximate value or range, with the selection always visible as text      |
| `ComboboxField`         | Searchable single or multiple selection with keyboard navigation           |
| `DateRangePickerField`  | Range selection with business presets and a custom range                   |
| `AsyncButton`           | Stable loading and duplicate-submit prevention                             |
| `useMutationFeedback`   | Mutation wrapper owning pending state, feedback, and cache invalidation    |
| `SemanticToaster`       | Shared success, error, warning, information, and loading feedback          |
| `StatusBadge`           | Shared state label using icon or dot plus color, consistent across modules |
| `EmptyState`            | Distinguish no data, no matches, missing prerequisite, and no permission   |
| `ErrorState`            | Sanitized error with safe retry                                            |
| `PageSkeleton`          | Geometry-preserving initial loading                                        |
| `AppSidebar`            | Permission-aware navigation with no more than two levels                   |
| `AppHeader`             | Page context, mobile menu, theme, and account actions                      |
| `PermissionGate`        | Presentation guard only; backend remains authoritative                     |

Names in this table are illustrative. Reuse an equivalent existing component rather than
renaming a mature codebase only to match this document. Which control fits which task is
decided in `component-selection.md`; this inventory only guarantees there is one
implementation of each.

## Contract Rules

Shared components own interaction consistency, not business policy.

- `AppDataTable` owns table mechanics; the module supplies typed columns, filter options, data, and valid actions.
- `DataTable` (the migrated base) owns the same contract for migrated screens. `AppDataTable` and its legacy controls coexist with it only until the remaining lists migrate; the exit criterion is in `../quality/technical-debt.md`.
- `FormDialog` owns focus, dismissal, responsive geometry, and footer placement; the form owns fields and business validation.
- `DatePickerField` selects one calendar date. It is implemented in `frontend/src/components/date-picker-field.tsx` (`add-document-archive`) as the shadcn date picker: a button that shows the date as `dd/mm/aaaa` and opens `Calendar` (`components/ui/calendar.tsx`, derived from shadcn/ui over `react-day-picker` 9) in a `Popover`. The owner chose it on 2026-10-22 over the native `<input type="date">`, accepting the calendar dependency. The calendar is in Spanish (the `es` locale of `react-day-picker`, with its accessible labels), starts the week on Monday, offers the month and the year in dropdowns, opens on the chosen date or the nearest bound, and disables the days outside `min` and `max`; Escape closes it and returns focus to the field. The value is `YYYY-MM-DD` or empty; the field owns its label, a clear button that appears only with a value, and an error associated with `aria-describedby` and `aria-invalid`; the button's accessible name carries the label and the date. Ranges use two fields with `min` and `max`, so the calendar does not let a range invert; the caller still explains an inverted range that arrives another way (from the URL) in the second field. The calendar renders only on the client, inside the popover: its one inline style (a visually hidden live region) is applied through the CSSOM, like Radix's popover positioning, which `style-src-attr 'none'` does not block.
- `EntityPickerDialog` returns selected business records; it does not know a specific entity type. It is implemented in `frontend/src/components/entity-picker-dialog.tsx` (`add-invoice-emission`): the caller supplies a cache key, a page loader (search, page, page size), how to render and name an item, and an optional quick option shown before the first unfiltered page (for example, "Consumidor final"). The search input is a combobox over a listbox: arrows, Home, End and Enter select without leaving the keyboard; results are paginated by the server, and loading, empty, no-match and error states stay inside the dialog.
  Its quick option can be highlighted with a soft bluish gradient (`QuickOption.highlight`), as
  «Consumidor final» is when choosing an invoice buyer. Choosing several records at once is a table
  dialog instead, like the invoice editor's `ProductPickerDialog`. `RowActionButton` takes
  `tone="danger"` for remove actions, with the icon in red (owner decision, 2026-10-22).
- `AddRowButton` (`components/add-row-button.tsx`) adds a row at the end of a form list: dashed,
  full width, 48 px tall, with a soft bluish gradient on hover instead of a solid fill. «Dividir el
  pago», «Agregar concepto», «Agregar línea», «Agregar pago» and the withholding editor's «Agregar
  impuesto», «Agregar forma de pago», «Agregar retención» and «Agregar documento sustento», and the
  shipping guide editor's «Agregar detalle» and «Agregar destinatario», and the party form's «Agregar
  correo» use it, so they always match. A party holds up to three emails: at three, «Agregar correo»
  gives way to a note with the limit, and each extra email has its own «Quitar» (add-email-delivery).
- `NumberedItem` (`components/numbered-item.tsx`) is a numbered item of a form list, such as a
  debit note concept or a purchase settlement line (owner decisions, 2026-10-22): two columns, 10 %
  and 90 %; the first holds its label («Concepto 1», «Línea 2») vertical in primary blue over a soft
  primary gradient strip, the second its fields. On a phone the label sits horizontal on top.
- `PickedCard` (`components/picked-card.tsx`) shows what a form picked as a card: a large icon in a
  circle, the data, and on the same row, at the right, the actions to choose or change it (stacked
  when there are several). Without a pick the border is dashed and the icon muted. The shipping
  guide editor uses it for the carrier, the recipient and the support invoice.
- `Textarea` (`components/ui/textarea.tsx`) is the system textarea: three lines, resizable
  downward, with the border, surface and type of `Input`; the product's internal description uses
  it.
- `SingleLineTextarea` (`components/single-line-textarea.tsx`) is a `Textarea` for long texts the
  document carries on one line (the debit note concept and the purchase
  settlement line descriptions): Enter does not break the line and pasted line breaks become
  spaces. The character count stays visible below the field (`FormField`'s `counter`).
- `FieldHint` (`components/field-hint.tsx`) is a field's help beside its label (owner decision,
  2026-10-22): an exclamation icon whose tooltip shows the text on hover, on keyboard focus or on
  a tap, instead of small text below the field. The text stays in the document, visually hidden,
  under the `id` the control names in `aria-describedby`, so a screen reader reads it on reaching
  the field. `FormField` renders its `hint` this way; `LabelWithHint` does it for labels outside
  `FormField` (segmented controls, read-only data, file fields, sub-headings). What is not help
  stays visible: errors, server problems, live counts, the consequence of a change (adjusting a
  sequence), the reason a control is disabled, and the declarations with their context and
  source. When a dialog opens, focus goes to the first control, not to the help of its label.
- `SemanticToaster` owns visual variants; callers provide human-readable messages.
- `ConfirmDialog` owns the confirmation ladder; the caller supplies the record label and the consequence. It may take its own content after the description (`children`, for example the separate declaration checkboxes of a credit note in `add-credit-notes`) and `confirmBlocked` while that content is incomplete; its body scrolls with the actions pinned, so a tall confirmation stays usable at 320 px, and the actions wrap to a second row when a long confirm label does not fit beside "Cancelar" (`add-purchase-settlements`).
- `PageHeader` owns the page's header grammar and its vertical rhythm; the screen supplies the title, the context and, in a list, its actions (`interface-design.md`, «`PageHeader` grammar»). Breadcrumbs are not part of it: `TopbarHeading` paints the screen breadcrumbs in the top bar for every route, without repeating the title (`navigation-responsive.md`, «Breadcrumbs: The Route From Inicio»).
- `StatusBadge` owns the visual encoding of a state; the module maps its domain values onto it.
- `DocumentStatusBadge` owns the presentation of fiscal document states (label, semantic variant, icon, and the help of the uncertain-send state); every document screen reaches it through the `StateCell` facade, so the mapping lives in one place. Environment and document state are independent: an authorized document in Pruebas is still not tax-valid.
- `DocumentDetailTabs` owns the tabs of a document detail: every document screen hands it its tabs (content first, then transmission, RIDE and XML, and its own), and keeps the header and the totals panel outside them.
- `HeaderActionsMenu` owns the secondary actions of a detail screen: a «⋯» button at the end of the title, naming the record, with only the actions the state and role allow. The screen primary action stays visible next to the header.
- `PermissionGate` may hide or disable controls, but cannot replace API authorization.
- Date and number components own parsing/display boundaries and return canonical values.

Do not put API calls, domain-specific permissions, or record lifecycle rules inside a
generic visual primitive.

## Extension Threshold

Add an option to a shared component when:

- at least two modules need the behavior;
- the behavior has the same interaction and accessibility contract;
- the option does not make the base component understand domain entities.

Create a module-specific composition when the workflow has unique business sequencing,
calculations, or lifecycle rules. Compose shared primitives inside it.

## External Component Intake

Before adopting a component from shadcn registries or community catalogs:

1. Inspect the installed source and dependency additions.
2. Remove demo data, branding, global styles, and unrelated variants.
3. Replace hardcoded colors, radius, shadows, fonts, and spacing with project tokens.
4. Replace custom SVGs with the established icon library where appropriate.
5. Align props and states with the shared application contract.
6. Verify keyboard, focus, screen-reader labels, reduced motion, light/dark, and mobile.
7. Consolidate or remove any existing duplicate component.

Do not keep two table systems, two toaster systems, or multiple pagination patterns after
adopting a replacement.

## Stable Geometry

Shared controls must define stable dimensions so icons, loading text, validation, hover,
or dynamic labels do not shift neighboring content. Use consistent medium icon sizes and
at least 44px touch targets for header, navigation, dialog close, and other standalone
touch actions.

## Field Focus

Fields do not change on focus (owner decisions, 2026-10-24). This covers text, password and search
inputs, text areas, native selects, the prefixed dropdowns (`select-trigger`), the date picker
(`date-picker-trigger`), checkboxes and radios.

- **On focus:** a field has no outline and no halo, and keeps its border. The text cursor marks
  the active text field. An invalid field keeps its red border.
- **Where:** the rule lives once in `globals.css`, so no field repeats focus classes.
- **Other controls:** buttons, tabs, toggles and links keep the blue focus outline.
- **Trade-off:** for keyboard users, the dropdowns, the date picker and the checkboxes show no
  focus of their own. The owner accepted this; restoring a visible field focus means changing
  this single rule.

## Ownership And Documentation

Document meaningful contract changes in `frontend.md` or an ADR. When replacing a shared
primitive, migrate its consumers in one planned sequence and remove the obsolete variant.
