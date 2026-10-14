# Navigation, Header, Themes, And Responsive Behavior

## Navigation Hierarchy

Use at most two visible levels:

1. Module or workflow group.
2. Direct destination.

Avoid third-level navigation, boxed submenus inside boxed modules, and multiple menu
entries that represent only filtered states of the same destination. Put those states in
the destination's filters or internal view selector.

When a module has only one destination, link the module directly instead of forcing an
unnecessary expand/collapse step.

## Information Architecture Of The Shell

Approved by the owner on 2026-10-14 (`adopt-premium-design-foundation-and-shell`, spec
`web-application-shell`). The groups and destinations, in this order:

| Group         | Destinations                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Inicio        | Inicio (shown as a loose destination, without a group label)                                              |
| Ventas        | Facturas, Notas de crédito, Notas de débito                                                               |
| Compras       | Liquidaciones de compra, Retenciones                                                                      |
| Logística     | Guías de remisión, Inventario                                                                             |
| Documentos    | Comprobantes, Borradores                                                                                  |
| Maestros      | Terceros, Productos                                                                                       |
| Análisis      | Reportes                                                                                                  |
| Configuración | Empresa, Ambiente, Establecimientos, Secuenciales, Firma electrónica, Catálogos fiscales, Usuarios, Portabilidad de datos |

- **Mi cuenta** lives in the account menu, not in the sidebar.
- **Permissions.** Each destination keeps the permission of the earlier navigation. The operator
  sees every group up to Análisis and, in Configuración, only Catálogos fiscales.
- **Single source.** `frontend/src/lib/navigation/routes.ts` is the only source of:
  - the sidebar and the current destination;
  - the breadcrumbs;
  - the command palette;
  - Quick Create;
  - the forbidden-destination guard.

  It holds the groups, the destinations, the internal routes of each destination (detail, new
  draft, draft) with their final breadcrumb and their permission, and the creation actions. No
  other component keeps its own map.

### Breadcrumbs: Hierarchy, Never Repetition

Breadcrumbs add hierarchy; they never repeat the page title.
- **Operational groups.** Ventas, Compras, Logística, Documentos, Maestros and Análisis only group
  the sidebar and are not breadcrumbs.
- **Configuración** is a section, so it is a breadcrumb, shown as text.
- **On an internal screen**, the destination is a link to its list, and the last breadcrumb is the
  current page. That last breadcrumb is the label of the record when the screen provides it (the
  document number, the product name), or the label of the route.
- **A trail of one breadcrumb is not shown.** That covers Inicio, top-level destinations such as
  Facturas and Productos, and Mi cuenta.

Examples:
- Facturas › 001-001-000000123;
- Notas de crédito › Borrador de nota de crédito;
- Configuración › Empresa.

## Application Shell

The authenticated shell (`frontend/src/components/shell/`, spec `web-application-shell`) derives
from the reference template's dashboard layout (ADR 0028).

- **Sidebar** (`AppSidebar`):
  - **Header:** the EmiteYa brand (text plus a neutral Lucide mark) linking to Inicio, and Quick
    Create.
  - **Body:** the groups of the route model, with a solid but restrained active treatment
    (`aria-current="page"`).
  - **From 768px:** it collapses to icons and back with its toggle or Ctrl/⌘ + B. A collapsed
    destination keeps its accessible name and shows it as a tooltip on focus or hover.
  - **Persistence:** the choice is kept in the `sidebar_state` cookie, which the layout reads on the
    server so a reload renders the same state without a flash.
  - **Below 768px:** the same navigation opens in a sheet from the menu button. The sheet has a
    visible «Cerrar menú» button, collapsible groups (the current one open) and 44px items. It
    closes on a destination, Escape, the overlay or the close button, and returns focus to the menu
    button.
- **Topbar** (`Topbar`), 48px high (56px on mobile).
  - **From 768px:**
    - sidebar toggle;
    - breadcrumbs, which take the free space;
    - the company context;
    - the command palette trigger;
    - the environment badge (from 640px);
    - the «Tema» radiogroup (from 640px);
    - the account menu.
  - **On mobile:** menu button, company context (which grows), palette and account. Breadcrumbs
    move to the start of the content area.
- **Company context.** It is read-only: the trade name, or the legal name, of the session's
  company, from `/company/status`. It is not a control and never suggests switching companies.
  - **While loading:** it reserves its space.
  - **On error:** it says it could not confirm the company, without guessing a name.
  - **Without registered data:** it says so.
- **Environment.**
  - **Pruebas:** the persistent, non-dismissible warning strip stays under the topbar, then the
    signature notice.
  - **Producción:** a badge with icon and text from 640px, and the compact strip below.
  - **Unknown environment:** it is never shown as Producción.
- **Theme.** From 640px the «Tema» radiogroup is in the topbar; below 640px it moves into the account
  menu as radio items. Both use the same next-themes state, and there is never more than one theme
  control at the same width.
- **Account menu.** Its accessible name is «Cuenta de {nombre}». It shows the name, email and role,
  plus Mi cuenta and Cerrar sesión, which disables itself after the first selection.
- **Skip link.** «Saltar al contenido» is the first focusable element and targets `main#contenido`.
- **Quick Create** (`QuickCreateMenu`, «Nuevo», in the sidebar header).
  - **What it offers:** the existing creation screens the role allows (invoice, credit note, debit
    note, withholding, shipping guide and purchase settlement).
  - **What it does:** it only navigates. It never creates a draft, reserves a number or emits.
  - **Style:** the `outline` variant, because it sits on every screen and must not compete with the
    screen's primary action.
  - **Collapsed:** an icon button named «Nuevo». It is 44px on mobile.
- **Command palette** (`CommandPalette`).
  - **Opening:** Ctrl/⌘ + K from any authenticated screen, or the «Buscar» trigger in the topbar.
  - **Contents:** «Ir a» (the permitted destinations and Mi cuenta) and «Crear» (the Quick Create
    actions), both from the route model.
  - **Filtering:** case- and accent-insensitive, over labels and group names
    (`lib/navigation/palette-filter.ts`).
  - **No server calls:** it never queries the server while typing. Server-backed global search is a
    later change.
  - **Behavior:** choosing an entry navigates and closes the palette, and Escape returns focus to the
    trigger. Its content loads on first opening, so it does not grow every route's first load.

## Submodules Instead Of Tabs

A module that covers several areas exposes them as submodules under its sidebar group,
never as tabs that split one page into several.

A section is a submodule when it has any of:

- its own collection of records;
- its own create, edit, or delete actions;
- its own permission;
- a URL worth linking, reloading, or sharing directly.

Tabs and segmented controls remain valid only for switching lenses over data already on
screen: a filtered view of the same collection, a table/chart toggle, or grouped read-only
detail of one open record. They must never stand in for a destination.

This keeps every destination visible in the sidebar, keeps deep links and reloads working,
and stops one page from silently growing into several unrelated screens.

## Sidebar

- Use plain labels with consistent Lucide icons, not a stack of decorative boxes.
- Chevrons belong only to expandable parents.
- Apply the solid active treatment only to the selected destination.
- Keep a selected child visually distinct without making its parent look selected.
- Use a small consistent radius for active/hover states.
- Group destinations by user workflow and permissions, not backend package structure.
- Name destinations in the user's words: `Facturas`, `Clientes`, `Proyectos`. Internal service, module, or agent names do not belong in navigation.
- Keep configuration and help in predictable lower positions.
- Hide destinations the user cannot access, but enforce permissions again on routes and APIs.

Desktop may keep frequently used groups expanded when the number of destinations remains
scannable. Mobile should collapse groups to preserve space.

## Reorderable Navigation

Let users drag navigation groups and destinations into their own order when the product
serves operators who return to the same few screens every day.

- Persist the order per user; a reload or a new session must not reset it.
- Provide a keyboard-accessible alternative to dragging.
- Show a clear drag affordance, an obvious drop target, and the resulting position.
- Reordering changes presentation only. It never changes permissions, routes, or which destinations exist.
- Keep the drag gesture from competing with normal selection, especially on touch.
- Offer a way back to the default order.

## Header

The authenticated header should remain compact and stable:

- mobile menu control when the sidebar is hidden;
- current context or breadcrumb and page title;
- theme control;
- avatar menu for profile and sign-out actions.

Use borderless icon controls when their grouping is already clear. Keep icon size medium,
touch targets at least 44px, and avoid displaying a long account name when the avatar
menu can provide it.

Do not duplicate the same module title immediately below the header.

## Mobile Navigation

- Hide the desktop sidebar at the chosen breakpoint.
- Open the same permission-aware navigation in a drawer.
- Provide a visible medium-size close button.
- Close on destination selection, Escape, overlay click, or explicit close.
- Prevent background scroll while open.
- Restore focus to the menu button on close.
- Keep navigation labels readable without horizontal scrolling.
- Use a bottom navigation bar only when the product has three to five top-level destinations and mobile is the primary device. Otherwise use the drawer.

## Responsive Layout

Responsive is not a smaller desktop. Each breakpoint restates the interaction: what the user
can do there, in what order, and how much is on screen at once.

| Viewport | Intent                                                                        |
| -------- | ----------------------------------------------------------------------------- |
| Desktop  | Maximum operational density: collection, context, and actions together        |
| Tablet   | Fewer columns and panels, secondary context on demand                         |
| Mobile   | One task at a time, sequential navigation, contextual actions                 |

Transform instead of compressing:

| Desktop                    | Mobile                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Wide operational table     | Horizontal scroll when the user compares rows, a prioritized card list when they act on one |
| Multi-panel layout         | Sequential navigation between panels                                                        |
| Persistent sidebar         | Drawer or sheet                                                                             |
| Dense toolbar              | Search plus progressive filters                                                             |
| Primary action in a header | Sticky action when the task depends on it                                                   |

- Define stable responsive constraints for tables, boards, toolbars, counters, and fixed-format controls.
- Let toolbars wrap by control group rather than compressing inputs below usable width.
- Use one column for forms when side-by-side fields become cramped.
- Keep modal height within the viewport and scroll its body.
- Ensure long words, emails, references, and translated labels wrap or truncate with a discoverable full value.
- Do not scale type continuously with viewport width.
- Do not allow controls, text, or overlays to cover adjacent content.
- Test at 320px, 768px, 1024px, and 1440px, plus 200% zoom and browser text enlargement.

## Touch And Mobile Input

- Never rely on hover alone. Anything revealed on hover is also reachable by tap and by keyboard.
- Keep the primary action within thumb reach on mobile, as a sticky action when the task depends on it.
- Open selectors and filters in a bottom sheet on mobile, and long searchable lists in a full-screen selector.
- Set `inputMode` and `type` so the right keyboard appears: `numeric` for whole numbers, `decimal` for amounts, and `email`, `tel`, `url`, or `search` where they apply.
- Set `autoComplete` tokens such as `name`, `email`, `current-password`, `new-password`, and `one-time-code`, so browsers and password managers can fill the field.

## Dark And Light Themes

- Use semantic CSS variables, never module-local hardcoded theme colors.
- When one product ships both an operational panel and a public site, keep their token sets in separate namespaces so restyling one cannot alter the other.
- Verify background, foreground, border, input, popover, tooltip, toast, destructive, and focus colors in both themes.
- Keep data visualizations legible and distinguishable without relying only on hue.
- Persist the user's explicit preference and respect system preference before one is chosen.
- Avoid flashes of the wrong theme during initial render.

## Density And Sizing

- Use medium, consistent icons throughout headers, forms, tables, dialogs, and navigation.
- Keep icon buttons and counters dimensionally stable so hover or loading states do not shift layout.
- Keep compact headings inside dense surfaces; reserve hero scale for actual hero experiences.
- Prefer a restrained multi-neutral palette with semantic accents over a one-hue interface.

## Accessibility

The baseline is WCAG 2.2 level AA. Accessibility is part of the initial architecture, not a
later pass.

- Use landmarks and one logical heading hierarchy, without skipping levels.
- Preserve visible focus and keyboard order.
- Keep the focused element unobscured by sticky headers, footers, or floating controls.
- Provide a pointer-free alternative to every drag interaction.
- Keep help, account, and support controls in the same place across pages.
- Do not require a memory or puzzle step to authenticate, and allow pasting into password fields.
- Give icon-only buttons accessible names.
- Associate labels, descriptions, and errors with form controls.
- Ensure dialogs manage focus and announce their title.
- Do not communicate status only through color.
- Meet contrast in every theme and interaction state: 4.5:1 for body text, 3:1 for large text and meaningful non-text elements.
