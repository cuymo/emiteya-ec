# Shared Frontend Component Contracts

## Purpose

The exact component names may follow the codebase, but each application should provide
one shared implementation for recurring operational interactions. Do not create a new
variant in each module.

## Foundation

Prefer shadcn/ui primitives styled through semantic Tailwind tokens. Use Lucide icons
instead of hand-drawn SVGs when a suitable icon exists. Treat third-party component
registries as source code to review and adapt, not as an independent design system.

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
- `FormDialog` owns focus, dismissal, responsive geometry, and footer placement; the form owns fields and business validation.
- `DatePickerField` selects one calendar date. It is implemented in `frontend/src/components/date-picker-field.tsx` (`add-document-archive`) over the native `<input type="date">`, which the browser localizes and adapts to theme, touch and keyboard, without a calendar dependency. The value is `YYYY-MM-DD` or empty; the field owns its label, a clear button that appears only with a value, and an error associated with `aria-describedby` and `aria-invalid`. Ranges use two fields with `min` and `max`, and the caller explains an inverted range in the second field.
- `EntityPickerDialog` returns selected business records; it does not know a specific entity type. It is implemented in `frontend/src/components/entity-picker-dialog.tsx` (`add-invoice-emission`): the caller supplies a cache key, a page loader (search, page, page size), how to render and name an item, and an optional quick option shown before the first unfiltered page (for example, "Consumidor final"). The search input is a combobox over a listbox: arrows, Home, End and Enter select without leaving the keyboard; results are paginated by the server, and loading, empty, no-match and error states stay inside the dialog.
- `SemanticToaster` owns visual variants; callers provide human-readable messages.
- `ConfirmDialog` owns the confirmation ladder; the caller supplies the record label and the consequence.
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
