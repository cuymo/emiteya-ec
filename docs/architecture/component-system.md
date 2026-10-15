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
| `TableToolbar`          | Stable arrangement of search, filters, columns, and table commands         |
| `TablePagination`       | One footer for client and server pagination                                |
| `DataTable<T>` and its pieces | The shared list base of migrated screens (`data-tables.md`, «Implementation In This Repository») |
| `PageHeader`            | Page title (`h1`), optional description and context, one primary-action slot and secondary actions (`frontend/src/components/layout/page-header.tsx`) |
| `ColumnVisibilityMenu`  | Business-facing optional column selection                                  |
| `RowActionButton`       | Icon action with permission/state handling and opaque tooltip              |
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
| `ChipGroup`             | Toggleable tags, categories, and filter values                             |
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
- `DatePickerField` selects one calendar date. It is implemented in `frontend/src/components/date-picker-field.tsx` (`add-document-archive`) over the native `<input type="date">`, which the browser localizes and adapts to theme, touch and keyboard, without a calendar dependency. The value is `YYYY-MM-DD` or empty; the field owns its label, a clear button that appears only with a value, and an error associated with `aria-describedby` and `aria-invalid`. Ranges use two fields with `min` and `max`, and the caller explains an inverted range in the second field.
- `EntityPickerDialog` returns selected business records; it does not know a specific entity type. It is implemented in `frontend/src/components/entity-picker-dialog.tsx` (`add-invoice-emission`): the caller supplies a cache key, a page loader (search, page, page size), how to render and name an item, and an optional quick option shown before the first unfiltered page (for example, "Consumidor final"). The search input is a combobox over a listbox: arrows, Home, End and Enter select without leaving the keyboard; results are paginated by the server, and loading, empty, no-match and error states stay inside the dialog.
- `SemanticToaster` owns visual variants; callers provide human-readable messages.
- `ConfirmDialog` owns the confirmation ladder; the caller supplies the record label and the consequence. It may take its own content after the description (`children`, for example the separate declaration checkboxes of a credit note in `add-credit-notes`) and `confirmBlocked` while that content is incomplete; its body scrolls with the actions pinned, so a tall confirmation stays usable at 320 px, and the actions wrap to a second row when a long confirm label does not fit beside "Cancelar" (`add-purchase-settlements`).
- `StatusBadge` owns the visual encoding of a state; the module maps its domain values onto it.
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

## Ownership And Documentation

Document meaningful contract changes in `frontend.md` or an ADR. When replacing a shared
primitive, migrate its consumers in one planned sequence and remove the obsolete variant.
