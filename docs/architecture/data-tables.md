# Data Table Pattern

## Purpose

Use one shared table contract for operational collections. Users should not have to
relearn search, filters, columns, pagination, or actions in each module.

A table is the right surface when the user must compare, sort, filter, search, or analyze
several records. Data arriving in rows is not a reason to render a table: one record's
attributes belong in a detail surface, and a handful of unrelated values belong in the
layout that fits them.

## Implementation In This Repository

`productize-invoice-list-and-shared-table-foundation` introduced the shared list base in
`frontend/src/components/data-table/`, over TanStack Table 8.21.3 with server pagination. Every list
now sits on the list card adapted from the «Studio Admin» users screen
(`users/_components/users.tsx` and `users-table.tsx`; `frontend/THIRD_PARTY_NOTICES.md`): fifteen
screens, the two tables (`DataTable` for Facturas, `AppDataTable` for the rest) and one set of
controls.

| Piece | File | Owns |
| --- | --- | --- |
| `DataTableCard` | `data-table-card.tsx` | The list surface: a card whose header holds the screen title (`h1`, or `h2` for a section of a larger page), a short description, the search and the actions; an optional `lead` (notices; drafts now go in the table itself, unify-drafts-into-document-lists); a filters row; and the table, edge to edge. It is a region named by its title |
| `DataTableSelectFilter` | `data-table-select-filter.tsx` | Every filter and view as a prefixed listbox («Estado: Todos»), over `ui/select-menu`. With `allLabel` the first option clears the filter; an option may carry a server count («Requiere atención 3»). The trigger is named after the filter and reads its value from its content |
| `DataTable<T>` | `data-table.tsx` | Typed columns with per-column `meta` classes, the accessible `caption`, skeleton rows, the empty or error state inside the surface, `aria-busy` while refreshing, the footer only with rows, and `onRowOpen` |
| `AppDataTable<T>` | `app-data-table.tsx` | The same surface for the other lists, with optional columns and a prioritized card list below 768 px |
| `DataTableFooter` | `data-table-footer.tsx` | `Filas por página`, `Mostrando A-B de N` and a numbered pagination: previous, a window of three pages around the current one with ellipses, and next; pages derived from the server `total`. Never shown while loading, empty or failed |
| `DataTableSearch`, `SearchInput` | `data-table-search.tsx`, `table-controls.tsx` | Server-backed search with debounce, trimming, `Limpiar búsqueda`, and a label that states what it really searches |
| `ColumnVisibilityMenu`, `RowActionButton` | `table-controls.tsx` | `Columnas`, at the end of the filters row, and the icon action of a row |
| `RowActionsMenu` | `row-actions-menu.tsx` | The `...` menu of a row, named after its record, with only the actions the module passes. `trigger="labeled"` turns the trigger into an outline «Acciones» button, for tables where a bare icon goes unnoticed (Usuarios) |
| `MoneyCell`, `RecordLink`, `PartyCell`, `MutedCell` | `data-table-cells.tsx` | The emphasis of every table cell (owner decision, 2026-10-16), so the eye finds the key data first. See «Cell emphasis» below |
| `DataTableEmpty`, `DataTableError` | `data-table-state.tsx` | Empty, filtered-empty and error states with a level-2 heading, over `ui/empty` |
| `useListUrlState` | `hooks/use-list-url-state.ts` | Search, filters, page and page size in the URL, with quick changes accumulated, the page reset on filter changes, aliases and the out-of-range page |

- **Row opening.** The record's own link is the keyboard target. `onRowOpen` adds a pointer
  convenience: a primary click on a non-interactive area opens the record, never from a link, a
  button, a menu (also in a portal), with a modifier key or with selected text. The row is never
  focusable, so there are no duplicate keyboard stops.
- **Selection is neutral.** A chosen filter shows its value in a neutral trigger; the primary blue
  stays for the screen's primary action.
- **Cell emphasis** (`data-table-cells.tsx`, owner decision 2026-10-16). Every list, report and
  history table follows it:
  - money: `MoneyCell`, «$17.355,05» (`formatMoney`, at least two decimals) in the `--money`
    green (6.2:1 light, 8.4:1 dark), semibold and tabular. Reports keep every amount green and
    bold only the row's total or withheld value. Detail pages follow it too
    (`components/money.tsx`): each line's amount, payments and every row of the totals panel in
    green, the total larger and semibold, and «$» inside muted text (unit price, discount). The
    editors still show «USD 1,00»;
  - the record: `RecordLink`, the number or name that opens its detail, semibold in primary blue;
    a record without a detail page is semibold text;
  - a party: `PartyCell`, the name in medium weight and its identification below, muted;
  - context (dates, causes, points, carriers, who requested): `MutedCell`;
  - short categories (party roles, user role) are outline badges; a product code is monospace on
    a soft background; a stock balance is semibold, and a kárdex change is green when it enters
    and red when it leaves, always with its sign;
  - states keep their `StatusBadge`.
- **Active filters are visible where they are set.** Each filter shows its value in its own trigger
  and clears from it; the search shows its text and has `Limpiar búsqueda`. `Limpiar filtros`
  appears only with an active filter.
- **No row selection.** There are no checkboxes or selected counters: the product has no bulk action
  yet. They arrive with the first real bulk workflow.
- **Phones.** Header actions drop under the title, filters take the full width, and secondary
  filters stay behind `Más filtros` or `Filtros` where a screen has many.
- **Report parameters.** Reportes keeps its date, identification and product parameters as labeled
  fields under the filters row: they are a parameter form, not single-value filters.
- **No client tricks.** No client-side search, sort or filtering of the loaded page. Headers are
  sortable only when the server sorts.

## Standard Anatomy

1. Compact title/description only when not already supplied by the page.
2. Search input.
3. Two or three high-value filters; move the rest into an advanced filter dialog.
4. `Columnas` visibility control when the table has optional columns.
5. Refresh, export, import, or create actions when applicable.
6. Sortable header, rows, and one actions column.
7. Footer with page size, result range and a numbered pagination with previous and next.

Keep controls in the same order and pagination component across the application.

Alignment must also hold from one module to the next: the same control heights, the same
cell padding, numbers aligned the same way, and the actions column at the same edge. A
user moving between modules should not notice the table change.

## Shared Component Contract

The application table should support:

- typed column definitions;
- global search with debounce when server-backed;
- explicit select/date/status filters;
- sorting;
- column visibility;
- client or server pagination through the same UI;
- loading skeletons that preserve column geometry;
- an informative empty state;
- permission-aware and state-aware row actions;
- selection only when a real bulk workflow exists;
- responsive overflow without shrinking text into illegibility.

Do not copy table markup per module. Add configuration or a reusable extension point.

## Filters And URL State

- Filters live with the table they affect.
- Use business labels and recognizable values.
- Keep important shareable filters, sort, and page in the URL when deep links matter.
- Reset the page when a filter changes.
- Debounce free-text search; do not debounce bounded selects.
- Provide `Limpiar filtros` only when at least one filter is active.
- Show active advanced filters as removable labels when they are otherwise hidden.
- Validate structured filters such as dates, references, or ranges before querying.
- Restore filters, sorting, page, scroll position, and selection when the user returns from a record. See `cognitive-architecture.md`.
- Use filter chips for short sets of values users toggle often, instead of a multi-select dropdown.
- On mobile, move filters into a drawer or bottom sheet with an apply action, and show the count of active filters on its trigger.

Avoid a separate oversized filter card above the table, and never a row of ten dropdowns.

## Search

- Show a search input with a search icon, and a clear button once it holds a value.
- Debounce server-backed search, and show its loading state inside the table, not over the page.
- When nothing matches, say so and offer the next step: clear the search, remove a filter, or create the record.
- Highlight the matched text when it helps the user confirm the result.
- Offer recent searches or suggested queries only where users repeat the same lookups.
- When the application has many destinations and records, add a command palette to jump directly to a record or an action.

## Columns

Show the columns the primary decision needs, usually five to seven. Every extra column
costs scanning speed on every row the user reads. Keep the rest in the column menu or in
the detail surface, and let a saved preference remember what an individual user chose.

- Put the primary identity first.
- Combine closely related secondary information in one cell when it improves scanning.
- Align numbers consistently and format them for the user's locale.
- Keep status concise and semantic.
- Keep the actions column last, stable, and narrow.
- Hide raw IDs, database timestamps, storage paths, and technical metadata by default.
- Do not allow column visibility to hide the only meaningful record identity or action access.

Column names, empty values, and units must be understandable without source-code knowledge.

## Visual Encoding

Let the user recognize a value without reading every cell.

- Use one shared status badge for every state column in the application.
- Encode meaning with an icon, a dot, or text in addition to color. Color alone is not a state.
- Keep the same value in the same treatment everywhere; a state must not change color between modules.
- Add a badge, icon, or inline control only when it speeds a decision. Plain text is correct for the rest.
- Keep badge and control dimensions stable so rows do not change height.
- Use an inline control in a cell only for a reversible change with immediate feedback.
- Do not color whole rows for routine states; reserve that for a condition that needs attention now.

## Row Actions

- Use familiar Lucide icons with accessible names and opaque light/dark tooltips.
- Edit, inspect, download, retry, activate, deactivate, archive, or delete only when valid for the row state and current permission.
- Disable with an explanation when the action is visible but temporarily unavailable.
- Confirm destructive or irreversible actions.
- Open detail from the row itself instead of spending an icon on it or keeping a permanent side panel beside the table.
- Budget the row: at most three visible icon actions, each frequent and valid for most rows. Everything else goes in a `...` menu. Two or three unambiguous icons are faster than a menu; seven are a wall.

## Pagination

Every table uses the same footer language and geometry:

- `Mostrando A-B de N`;
- `Filas` page-size selector;
- first, previous, current page indicator or page numbers, next, and last;
- disabled boundary controls;
- stable dimensions so controls do not shift.

Server pagination returns total records and deterministic ordering. Selected records for
a real multi-page workflow must persist across page changes until the workflow is
completed or explicitly cleared.

## Empty, Loading, And Error States

- Loading: render row skeletons inside the existing table frame.
- Empty collection: explain what can be created and offer the valid primary action.
- No filter results: state that filters returned no matches and offer to clear them.
- Error: keep the table frame, show a concise message and retry action.
- Partial data: render available columns and disclose which secondary data failed.

Do not replace the entire page with a spinner for routine table refreshes.

## Responsive Behavior

- Choose per table: horizontal scroll inside the surface when the mobile user compares rows, a prioritized card list when they act on one record at a time. See `navigation-responsive.md`.
- In the shared `DataTable`, a table can switch between a wide and a compact composition with
  Tailwind container queries on the table surface (`@container` with `@table-wide:` classes in the
  column `meta`; the `--container-table-wide` token is 40rem, measured with Facturas). The available
  width changes with the sidebar and the zoom, so the viewport is the wrong signal. The
  compact composition keeps one semantic table and moves the hidden columns' data into the first
  column; if it still does not fit, the table scrolls inside its surface, never the page. Facturas
  uses this instead of cards.
- Never compress a wide table into columns too narrow to read.
- Keep primary identity and actions reachable.
- Allow toolbar controls to wrap into logical rows.
- Use sticky headers only when they do not cover page controls or modal headers.
- Test long unbroken values and 200% zoom.

## Table Review

Reject the implementation when:

- pagination differs from neighboring modules;
- controls, alignment, or spacing drift from neighboring modules;
- filters sit in a detached decorative section;
- row actions lack tooltips or feedback;
- the table exposes internal identifiers;
- the default columns exceed what the primary decision needs;
- a row carries more than three visible actions;
- a state is communicated only by color;
- changing pages loses intentional selection;
- loading causes layout jumps;
- mobile content overlaps or becomes unreachable;
- summary cards repeat what the table already communicates.
