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
`web-application-shell`), with the corrections of the UX quality gate of the same day (design D25).
Shortened on 2026-10-24 (`reorganize-main-navigation`). The groups and destinations, in this order:

| Group          | Destinations                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Inicio         | Inicio (loose, without a group label)                                                                                |
| Comprobantes   | Todos los comprobantes, Facturas, Notas de crédito, Notas de débito, Retenciones, Liquidaciones de compra, Guías de remisión |
| Administración | Clientes y proveedores, Productos, Inventario                                                                        |
| Reportes       | Reportes (loose, without a group label)                                                                              |
| Configuración  | Usuarios, Empresa, Establecimientos, Firma electrónica, Correos, Catálogos fiscales, Ambiente, Portabilidad de datos |

- **Layout of the sidebar.** A line (`SidebarSeparator`) separates Inicio, Comprobantes,
  Administración and the last block, where Reportes and Configuración sit together. A loose group
  (`loose` in the route model) shows its only destination without a label and does not repeat
  itself in the breadcrumbs.
- **Names.** «Todos los comprobantes» (`/comprobantes`, formerly «Archivo de comprobantes») and
  «Clientes y proveedores» (`/terceros`, formerly «Terceros») are the names in the sidebar, the
  breadcrumbs, the palette, the screen title and the messages that point to the screen. The routes
  did not change, and a party can still be a carrier. The data itself is still called «tercero»:
  the Terceros report, the export sheet and the «Nuevo tercero» breadcrumb.

- **Sales and documents.**
  - **Drafts have no destination of their own** (unify-drafts-into-document-lists, design D6):
    every document list shows its drafts first, with the «Borrador» state and the «Borradores»
    filter. `/borradores` redirects to `/facturas?estado=borradores` (`next.config.ts`); the
    palette finds Facturas by «borradores» or «factura sin emitir».
  - **Todos los comprobantes** (`/comprobantes`) is the cross-document archive of every type, and
    never shows drafts.

- **Parties and products register and correct on a page** (owner decision, 2026-10-17). Clientes y proveedores and Productos
  no longer use a dialog for their long forms:
  - **Routes:** `/terceros/nuevo`, `/terceros/{id}`, `/productos/nuevo` and `/productos/{id}`, with
    `parties.manage` or `products.manage`. «Nuevo tercero» and «Nuevo producto» are links in the
    list header, and each row's «Corregir» is a link (`RowActionLink`).
  - **Breadcrumbs:** «Nuevo tercero», «Nuevo producto», or the record's name once the correction
    loads («Corregir tercero» or «Corregir producto» until then). The page title itself is the
    entity («Tercero», «Producto») with the «Nuevo» or «Corrección» badge.
  - **Form** (`party-form.tsx`, `product-form.tsx`): one centered column without sections (owner
    decision, 2026-10-22), with «Cancelar» back to the list and the primary action at the foot. The
    party form puts the roles first, as full-width tabs, with «Cliente» chosen in a new party (dialogs inside a document keep the roles they pass). No rule above the actions. The product form puts the kind at full
    width, the price with the stock control at its right, the IVA and the ICE in one row, and the
    internal description in a `Textarea` with its count.
    Saving returns to the list with the toast. The correction sends the version that was opened,
    so a change by someone else still arrives as a conflict.
  - **Exception:** inside a document, registering a party stays in `PartyDialog`, so the draft is
    not left behind. It shares the fields and the save logic of `party-form.tsx`.

- **Mi cuenta** lives in the account menu, not in the sidebar.
- **Permissions.** Each destination keeps the permission of the earlier navigation. The operator
  sees every group up to Reportes and, in Configuración, only Catálogos fiscales.
- **Single source.** `frontend/src/lib/navigation/routes.ts` is the only source of:
  - the sidebar and the current destination;
  - the breadcrumbs;
  - the command palette, with its Quick Create actions;
  - the forbidden-destination guard.

  It holds the groups, the destinations, the internal routes of each destination (detail, new
  draft, draft, and the form pages of parties and products) with their final breadcrumb and their
  permission, and the creation actions. No other component keeps its own map.

### Breadcrumbs: The Route From Inicio

The breadcrumbs of the open screen live in the topbar, on its left (owner decisions on the header,
2026-10-16). They replace the breadcrumb row that used to sit above the page title. The topbar does
not repeat the screen title: the screen's own `h1`, right below, names it.
- **Trail:** separated with «/»: a house icon linking to Inicio, the navigation
  group (Comprobantes, Administración or Configuración, as text; Inicio and Reportes have none), the
  destination (a link on an internal screen) and the current page, in the brand colour and
  announced with `aria-current="page"`. On a detail, the last breadcrumb is the record label when
  the screen provides it (the document number, the product name), or the route label. Inicio and Mi
  cuenta have no group.
- **Truncation:** one line; only the last breadcrumb truncates. When the space the topbar leaves
  is under 16rem (a tablet with the sidebar expanded), the trail keeps only Inicio and the current
  page, so it never runs under the search button.
- **Phone:** below 768px the trail is hidden: it does not fit next to the global context, and the
  screen `h1`, right below, already orients.
- They are the only orientation of the screen: no «back» link repeats a breadcrumb.
- **Invoice editor** (design D12, PO-1): new invoice and draft belong to Facturas, before and after
  the first save. Drafts are resumed from the Facturas list.

Examples:
- Inicio / Comprobantes / Facturas / 001-001-000000123;
- Inicio / Comprobantes / Notas de crédito / Borrador de nota de crédito;
- Inicio / Comprobantes / Facturas / Nueva factura;
- Inicio / Configuración / Empresa.

### Configuración in Tabs

The Configuración sections share one page with tabs (`ConfigurationLayout`, the
`app/(app)/configuracion/layout.tsx` layout): Usuarios, Empresa, Establecimientos, Firma
electrónica, Catálogos fiscales, Ambiente and Portabilidad de datos (owner order, 2026-10-16), in
the navigation order and only those the role sees (`configurationDestinations`). An administrator
entering Configuración lands on Usuarios; an operator, on Catálogos fiscales.
- **Secuenciales** is no longer a tab (owner decision, 2026-10-16): each emission point in
  Establecimientos unfolds its counters for the company's current environment, with «Ajustar» on
  each. `/configuracion/secuenciales` redirects to Establecimientos (`next.config.ts`), and the
  palette finds Establecimientos by «secuencial» or «numeración».
- **Tabs are links.** Each tab is a link to its section's address (`aria-current="page"` on the open
  one), so every section keeps its deep link, its permission guard and its own `h1`. They look like
  the document detail tabs (`tabTriggerClassName`).
- **`/configuracion`** has no permission of its own and redirects to the first tab the role sees.
- **Vertical tabs.** From a 48rem container (`@settings-nav:`, `--container-settings-nav`) the tabs
  are a 13rem column to the left of the panel, like a sidebar (owner decision, 2026-10-23): full
  width items aligned left, no underline, the open one and the hovered one on the soft active blue,
  and the column sticks below the top bar while the page scrolls (`grid-cols-settings-nav`).
  - **Background and height** (owner decision, 2026-10-24): the column is a rounded panel with the
    background of the left sidebar (`bg-sidebar`). It reaches the bottom of the window: its
    minimum height is 100dvh minus where it starts. The column also sticks right below the top
    bar, including the environment strip.
  - **Measuring:** the layout measures both offsets after mounting and again when the shell
    resizes, because the environment strip and the notices arrive later. It sets them as CSS
    variables through the CSSOM (`--configuration-nav-top`, `--configuration-nav-stick`), since
    the CSP blocks `style` attributes in the server HTML.
- **Width.** The panel takes the width its screen declares with `data-panel-width` (`form` or
  `reading`), to the right of the vertical tabs or below the tab row.
- **Narrow screens.** Below that container the tabs stay a row above the panel that scrolls
  horizontally, never the page, with the open tab in view.

## Application Shell

The authenticated shell (`frontend/src/components/shell/`, spec `web-application-shell`) derives
from the reference template's dashboard layout (ADR 0028).

- **Sidebar** (`AppSidebar`):
  - **Header:** the EmiteYa logo and name linking to Inicio (`BrandLogo`, add-brand-logo). The
    logo is decorative, since the name beside it gives the link its accessible name. Collapsed, the
    logo stays with the «EmiteYa» tooltip. There is no creation button (owner decision, 2026-10-24).
  - **Body:** the groups of the route model, with a solid but restrained active treatment
    (`aria-current="page"`).
  - **From 768px:** it collapses to icons and back with its toggle or Ctrl/⌘ + B. A collapsed
    destination keeps its accessible name and shows it as a tooltip on focus or hover.
  - **Pointer:** every destination responds to the pointer over its whole visible area, also the
    last one of each group when collapsed (design D21). The invisible group labels of the icon mode
    never take the pointer.
  - **Short windows:** the navigation scrolls inside the sidebar, expanded or collapsed, with the
    wheel, the touchpad or the keyboard, and never horizontally (design D22).
  - **Current destination in view:** on load, on a deep link and on every route change, the sidebar
    scrolls just enough to show the current destination if it is outside its visible area. It never
    scrolls the page, does not move when the destination is already fully visible, and does not
    animate with reduced motion (design D23).
  - **Configuración, one destination** (owner decision, 2026-10-16): a single link right after
    Reportes (since `reorganize-main-navigation`; it used to sit at the foot), with the settings icon, to the first section the role sees; it is the current
    destination on any of its sections. The sections are tabs of one page (see «Configuración in
    tabs» below). The operational groups never fold, so they keep a strong information scent.
  - **Persistence:** the choice is kept in the `sidebar_state` cookie, which the layout reads on the
    server so a reload renders the same state without a flash.
  - **Below 768px:** the same navigation opens in a sheet from the «Abrir navegación» button, which
    uses the conventional menu icon (design D29). The sheet has a visible «Cerrar menú» button,
    collapsible groups (the current one open) and 44px items. It closes on a destination, Escape,
    the overlay or the close button, and returns focus to the navigation button.
- **Topbar** (`Topbar`), a 72px row (56px on mobile) under the environment strip, on one line at every width, in two zones
  (owner decision on the header, 2026-10-16):
  - **start:** the sidebar toggle (or «Abrir navegación» on mobile), a divider and, from 768px, the
    breadcrumbs of the screen (see above);
  - **end:** the command palette trigger (an outline button with the magnifier, «Buscar» and the
    shortcut; the magnifier alone on a phone), «Pantalla completa» as a round 36px button on the
    muted surface (from 768px, where the browser allows it), the notifications bell (see below)
    and the identity: a building tile (from 1024px), the company context and, under it, the
    account menu trigger. The company context is at most 14rem from 768px and 7rem below,
    truncated.

  No theme control (it lives in the account menu) and no help button: the product has none.
- **Notifications** (`NotificationsMenu`, `features/notifications/notifications-menu.tsx`; owner
  decision, 2026-10-22). A round bell left of the identity, at every width, with the number of
  pending notices (always green, owner decision 2026-10-22; «9+» past nine) and the name
  «Avisos: N pendientes». It opens a popover with the list. Each notice is a condition the server
  already reports, not an event, so it disappears once resolved; there is no read state.
  - **Signature** (`/signing-certificate/validity`): expired or without its key (red), or expiring
    with its date and the days left (amber).
  - **Readiness** (`/company/status`): the company cannot emit yet, with what is missing (red). An
    expired or unavailable signature is not repeated here.
  - **Dashboard summary** (`/dashboard`, `invoices.read`, shared with Inicio but cached for five
    minutes and not refetched on focus): documents that need attention, returned or not
    authorized in the last 30 days, documents whose last email failed (with a link to the archive
    filtered by «Correo: No enviado», add-email-delivery), and out-of-stock products (amber).
  - **Links:** each notice links to its section only when the role can open it (the permission of
    `resolveRoute`); otherwise it says to ask an administrator. Following a link closes the list.
- **Company context.** It is read-only: the trade name, or the legal name, of the session's
  company, from `/company/status`. It is not a control and never suggests switching companies.
  - **While loading:** it reserves its space.
  - **On error:** it says it could not confirm the company, without guessing a name.
  - **Without registered data:** it says so.
- **Environment** (`EnvironmentBanner`; owner decision on the header, 2026-10-16). A full-width
  warning strip above the topbar row, inside the sticky header block, so it stays visible while
  scrolling at every width and with the sidebar in any state. It has an icon and text and cannot be
  dismissed. There is no environment badge in the topbar.
  - **Pruebas:** «Estás en el ambiente de Pruebas: los comprobantes que emitas no tienen validez
    tributaria.», plus «Cambiar ambiente» (to Configuración › Ambiente) for roles that can change it.
  - **Producción:** no strip and no indicator: it is the company's real environment.
  - **Unknown environment:** the strip says the environment could not be confirmed and asks to
    reload before emitting; never shown as Producción. A query that already failed stays
    unconfirmed while it retries.
  - **While loading:** nothing, so it never announces an environment it does not know yet.
  - **Where the fiscal decision is made:** every editor that emits repeats the warning next to its
    «Emitir» and in its confirmation (`EmissionEnvironmentNotice`, spec `document-emission`).
  - **Signature:** the certificate expiry notice stays as a strip under the topbar, and is also
    one of the notifications.
- **Theme.** Always light (owner decision, 2026-10-22): next-themes forces the light theme and
  ignores the system preference, and there is no theme control anywhere. The dark tokens stay in
  `globals.css`, unused.
- **Account menu.** Its trigger is the whole identity (owner decision, 2026-10-22): the building
  tile, the company and, under it, the person's name with a chevron; the company is announced as
  its description. On a phone its touch area grows to 44px. Its accessible name is «Cuenta de
  {nombre}».
  - **Contents:** the person's own photo, or their initials (`UserAvatar`), beside their name,
    email and role; then Mi cuenta and Cerrar sesión, which disables itself after the first
    selection.
  - **Photo:** the trigger keeps the building tile and never shows the photo (owner decision,
    2026-10-24; `redesign-account-profile`). The menu reads `GET /me/profile` only when it opens,
    with the same query as Mi cuenta, and shows the initials while it loads.
- **Skip link.** «Saltar al contenido» is the first focusable element and targets `main#contenido`.
- **Quick Create** lives in the command palette (add-brand-logo; owner decision, 2026-10-24: no
  «Nuevo» button in the sidebar).
  - **What it offers:** the existing creation screens the role allows (invoice, credit note, debit
    note, withholding, shipping guide and purchase settlement), in the palette's «Crear» group.
  - **What it does:** it only navigates. It never creates a draft, reserves a number or emits.
- **Command palette** (`CommandPalette`).
  - **Opening:** Ctrl/⌘ + K from any authenticated screen, or its trigger in the topbar.
  - **Truthful scope** (design D26): the trigger reads «Buscar» with the shortcut, its accessible
    name and tooltip are «Buscar pantalla o acción», and the field says the same. It searches
    screens and actions, never documents, third parties or products, and is never called a global
    search.
  - **Contents:** «Ir a» (the permitted destinations and Mi cuenta) and «Crear» (the Quick Create
    actions), both from the route model.
  - **Filtering:** case- and accent-insensitive, over labels, group names and the synonyms each
    destination declares in the route model (`lib/navigation/palette-filter.ts`). For example,
    «clientes» or «transportista» finds Clientes y proveedores, «contraseña» Mi cuenta and «IVA» Catálogos fiscales.
  - **No invented results:** an invoice number, a customer or a product finds nothing, and the empty
    state says that no screen or action matched, pointing to each screen's own search. It never says
    a record does not exist.
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
- the company context, the command palette and the environment indicator;
- avatar menu for profile, theme and sign-out actions.

Breadcrumbs and the page title belong to the content area, never to the header.

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
