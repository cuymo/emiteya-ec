# Frontend Architecture

## Runtime

- Framework: Next.js.
- Language: TypeScript.
- Styling: Tailwind CSS with semantic theme tokens.
- Component system: shadcn/ui.
- Icons: lucide-react.
- Form handling: React Hook Form and Zod.
- Data tables: TanStack Table behind one shared application component.
- Feedback: one shared semantic toast system.
- Data fetching: typed API helpers over internal backend routes.
- Charts: shadcn-compatible chart components when a chart answers a real question.
- Política de seguridad del navegador: `src/proxy.ts` aplica a cada documento la política de
  `src/lib/web-security-policy.ts`, con un nonce nuevo por petición (ADR 0025).
  - Todos los documentos se renderizan por petición: el layout raíz lee el nonce con `headers()`.
  - Una página nueva no necesita nada para recibir el nonce. Un script en línea propio, o una
    biblioteca que inserte scripts o estilos en tiempo de ejecución, tiene que pasar por esa
    política y por `check:web-security-policy`.

## Product UI Principle

Build the working product as the first screen. Operational applications should feel
quiet, predictable, and efficient for repeated use. The interface exists to help a
person scan, compare, decide, and act; it should not advertise its own implementation.

Do not treat every dataset as a dashboard, every section as a card, or every action as
a permanent panel. Choose the smallest surface that supports the workflow.

Design from the user, never from the schema. A table, a field, an endpoint, or an existing
feature does not decide what belongs on screen; the user's job does. Answer the screen brief
in `cognitive-architecture.md` before implementing. It is a precondition, not a formality: a
screen whose user, decision, required information, and primary action are unknown is not
ready to build.

## Required Pattern Documents

Open only the documents relevant to the task:

- User, decision, information tiers, and action budget: `cognitive-architecture.md`.
- Spacing, type, color, states, and motion scales: `design-foundations.md`.
- Choosing the control that fits the user's intent: `component-selection.md`.
- Screen hierarchy and visual workload: `interface-design.md`.
- Shared component inventory and contracts: `component-system.md`.
- Lists, filters, columns, actions, and pagination: `data-tables.md`.
- Forms, selectors, modals, drawers, and full-page workflows: `forms-and-workflows.md`.
- Toasts, validation, loading, empty, error, and background-job states: `feedback-and-states.md`.
- Sidebar, header, permissions, mobile, touch, and themes: `navigation-responsive.md`.
- Completion audit: `../quality/frontend-checklist.md`.

## State Ownership

- Server state: typed query/mutation helpers with cancellation and invalidation.
- Form state: React Hook Form.
- Validation: shared Zod schemas where client/server contracts permit reuse.
- Local UI state: transient interaction only, such as an open dialog or temporary selection.
- URL state: shareable search, filters, sorting, page, and active views when useful.
- Persisted job state: backend-owned when work must survive navigation, refresh, or closing a modal.

Do not mirror the same state across URL, form, component, and server caches without a
single declared owner.

## Component Policy

1. Reuse an existing product component.
2. Compose shadcn/ui primitives.
3. Add a shared application component when at least two workflows need the same contract.
4. Create a module-specific component only when its behavior is genuinely domain-specific.

External registries may provide a starting point, but inspect installed code, remove
demo assumptions, map colors to project tokens, verify accessibility, and align it with
the existing component contract before use. Do not accumulate near-duplicate primitives.

## Contratos compartidos implementados

Introducidos por `add-user-access`, `add-taxpayer-setup`, `add-signing-certificate`, `add-fiscal-catalogs`, `add-parties-and-products` y `add-invoice-emission`; los módulos nuevos los reutilizan en lugar de crear variantes.

| Contrato | Ubicación (`frontend/src/`) | Notas |
| --- | --- | --- |
| Primitivas (`Button`, `Input`, `Label`, `Dialog`) | `components/ui/` | shadcn/ui sobre `radix-ui`, adaptado a los tokens. Los diálogos y el panel lateral devuelven el foco a quien los abrió (`use-return-focus.ts`). `Button` deriva de la plantilla (ADR 0028): variantes `primary`, `secondary`, `outline`, `ghost`, `destructive` y `link`; tamaños `default` (36px), `sm` (32px), `xs` (24px) y de icono, 44px por debajo de 768px; tamaños `legacy-*` transitorios para las pantallas sin migrar. `Input` mide 44px de alto por debajo de 768px. |
| Primitivos derivados de la plantilla «Studio Admin» | `components/ui/{sidebar,sheet,dropdown-menu,tooltip,popover,command,badge,breadcrumb,empty,avatar,kbd,separator,collapsible,skeleton}.tsx`, `hooks/use-mobile.ts` | Copiados y adaptados (ADR 0028, `THIRD_PARTY_NOTICES.md`): tokens, capas `--z-*`, textos en español, sin `style` en el servidor. `menu-and-tooltip.tsx` es una fachada con la API anterior sobre `dropdown-menu` y `tooltip`, y `states.tsx` reexporta `Skeleton`. |
| `DataTableCard`, `DataTableSelectFilter`, `DataTable`, `AppDataTable`, `DataTableFooter`, `DataTableSearch`, `SearchInput`, `ColumnVisibilityMenu`, `RowActionButton`, `RowActionsMenu`, `DataTableEmpty`, `DataTableError` | `components/data-table/`, `hooks/use-list-url-state.ts` | La base de todas las listas (`data-tables.md`): la tarjeta de lista de la plantilla, con el título, la búsqueda y las acciones en su cabecera, filtros como desplegables con prefijo y un pie con paginación numerada; TanStack Table 8.21.3 con paginación de servidor, estado en la URL y estados dentro de la superficie. `AppDataTable` añade la lista de tarjetas por debajo de 768px. |
| `FormDialog`, `FormField` | `components/form-dialog.tsx` | Foco, Escape, cuerpo con desplazamiento, `Cancelar` y una acción principal; errores asociados al campo. |
| `AsyncButton`, `PasswordField`, `SelectionCardGroup` | `components/` | Pendiente con geometría estable; contraseña que se puede pegar y mostrar; elección en tarjetas de radio. |
| `StatusBadge`, `EmptyState`, `ErrorState`, `Skeleton` | `components/states.tsx` | Estado con icono y texto; vacío, sin coincidencias y sin permiso. |
| `DocumentStatusBadge`, `StateCell`, `TransmissionStoppedBadge`, `AttentionMarker` | `features/documents/document-status-badge.tsx` | Presentación canónica del estado de los comprobantes (`productize-invoice-list-and-shared-table-foundation`, PO-1) sobre `Badge`: «Procesando», «Pendiente de envío», «Verificando con el SRI» y «Pendiente de autorización» como información; «Autorizado» como éxito; «Devuelto» y «No autorizado» como destructivos; «Requiere revisión» como advertencia. «Verificando con el SRI» lleva una ayuda: «El envío pudo haber llegado. No emitas esta venta nuevamente.». La transmisión detenida es un indicador operativo aparte. `StateCell` es la fachada que usan todas las pantallas de comprobantes. |
| `DocumentDetailTabs`, `transmissionNeedsAttention` | `features/documents/document-detail-tabs.tsx`, sobre `components/ui/tabs.tsx` | Pestañas del detalle de los seis comprobantes (spec `document-archive`, «Detalle de un comprobante en pestañas»): el encabezado y los totales quedan fuera; la primera pestaña es el contenido, después la transmisión (no mientras espera la firma), el RIDE y el XML, y lo propio de cada tipo. La pestaña va en `?seccion=` y la de la transmisión lleva un punto con su nombre accesible cuando requiere atención. Las pestañas inactivas no se montan, así que sus consultas esperan a que se abran. |
| `HeaderActionsMenu` | `components/layout/header-actions-menu.tsx` | Menú «⋯» al final del título de una pantalla de detalle con sus acciones secundarias (spec `web-application-shell`, «Más acciones de una pantalla de detalle»): en la factura, emitir una nota de débito y crear una guía de remisión (`useInvoiceDebitNoteAction`, `useInvoiceShippingGuideAction`); en el inventario, ajustar y desactivar el control. La acción principal sigue a la vista; una acción no disponible dice por qué, y sin acciones el menú no aparece. |
| `LineItemList` | `features/documents/line-item-list.tsx` | Líneas de un comprobante en su detalle (factura, nota de crédito y liquidación de compra; spec `document-archive`, «Líneas de un comprobante en su detalle»): enteras con 10 o menos; con más, un buscador sin mayúsculas ni tildes sobre el nombre y el código y una paginación discreta de 10 en 10 («11–20 de 45 productos»), todo en el navegador porque las líneas llegan con el comprobante. |
| `SemanticToaster`, `useMutationFeedback` | `components/feedback.tsx` | Toda mutación pasa por aquí: pendiente, aviso, invalidación y mensajes de negocio. |
| `SessionGate`, `useSession`, `QueryProvider` | `components/session.tsx` | Sesión desde `GET /api/v1/me`; un 401 lleva al inicio de sesión conservando la URL. |
| `SegmentedControl` | `components/segmented-control.tsx` | De dos a cinco opciones visibles (Radix ToggleGroup); puede empezar sin selección cuando el dato se declara, y una opción elegida no se deselecciona. La altura de cada opción es mínima, no fija: una etiqueta larga que se parte en líneas crece dentro del borde. |
| `ConfirmDialog` | `components/confirm-dialog.tsx` | Escalera de confirmación: un paso, o escribir un texto exacto antes de confirmar; foco devuelto a quien lo abrió. |
| `EntityPickerDialog` | `components/entity-picker-dialog.tsx` | Selección de un registro relacionado: búsqueda con espera breve, resultados paginados por el servidor, combobox con selección por teclado (flechas, Inicio, Fin, Enter) y una opción rápida opcional antes de la primera página sin búsqueda. Devuelve el registro elegido; no conoce el tipo de entidad. Lo usa el editor de facturas para el comprador y los productos. |
| `Select` | `components/ui/select.tsx` | Select nativo con los tokens, para cinco a quince opciones conocidas; admite grupos con `optgroup`. Con más opciones se usa un combobox con búsqueda. Mide 44px de alto por debajo de 768px. Va sin la apariencia nativa (`appearance-none`), como el `native-select` de shadcn/ui, porque según el navegador y el tema del sistema el control nativo pintaba su propio borde oscuro: lleva el mismo borde `input` que los demás campos y una flecha `ChevronDown` del tema. Su `className` va al contenedor, que fija el ancho. |
| `ChipMultiSelect` | `components/chip-multi-select.tsx` | Chips conmutables de selección múltiple (Radix ToggleGroup `multiple`) para categorías cortas que se combinan, como los roles de un tercero; la selección vacía es válida y el orden es el de las opciones. |
| Composición de formularios (`FormLayout`, `FormSection`, `FormGrid`, `FormFieldRow`, `StickySummaryPanel`, `StickyFormActions`) | `components/layout/form-layout.tsx`, `form-section.tsx`, `form-grid.tsx` | Distribución con panel por contenedor, secciones con acción local, campos alineados por `subgrid` sobre el `FormField` existente (que admite una acción en la fila del control) y acciones con su motivo, fijas al pie cuando el panel se apila (`productize-invoice-editor-and-composition-foundation`, design D5 a D8). |
| `FileField` | `components/file-field.tsx` | Un archivo: tipos y límite visibles antes de elegir, archivo vigente con tipo y tamaño, reemplazar y eliminar, alerta temprana de tipo y tamaño; el servidor decide por el contenido. Los tipos admiten extensiones (`.p12`) cuando el sistema no informa un tipo MIME fiable. |
| Shell autenticado (`AppShell`, `AppSidebar`, `Topbar`, `TopbarHeading`, `CompanyContext`, `AccountMenu`) | `components/shell/` | Derivado de la plantilla (ADR 0028; `navigation-responsive.md`, «Application Shell»). Ranuras `company`, `environment` y `notices`: el layout compone ahí el contexto de la empresa, el indicador del ambiente y el aviso de la firma. La barra superior tiene tres zonas y una sola línea, sin migas ni tema; el tema vive en el menú de cuenta. `AppBreadcrumbs` pinta las migas encima del título, con un solo dueño por ruta (el shell o el encabezado de la pantalla migrada; `productize-invoice-editor-and-composition-foundation`, design D1 y D2). `useBreadcrumbLabel` deja que una pantalla de detalle ponga la etiqueta de su registro en la última miga. |
| `NoticeStrip` | `components/notice-strip.tsx` | Franja persistente bajo la cabecera, con icono decorativo y texto, en tono de advertencia o peligro; solo para condiciones que persisten y piden una acción, como la firma por vencer (`feedback-and-states.md`). El ambiente ya no usa franja. |
| Ambiente (`EnvironmentBanner`, `EmissionEnvironmentNotice`) | `features/company/environment-notice.tsx`, `features/company/emission-environment-notice.tsx` | Franja de ancho completo encima de la barra superior en Pruebas o con el ambiente sin confirmar (ninguna en Producción), y aviso de Pruebas o de ambiente sin confirmar junto a «Emitir» y en la confirmación de cada editor que emite (`productize-invoice-editor-and-composition-foundation`, design D21). |
| `Switch` | `components/ui/switch.tsx` | Radix Switch para una opción que se aplica al momento, sin botón de guardar; el estado se repite con texto visible junto a él. Mide 44px de alto por debajo de 768px. |
| `formatDecimal`, `formatPercentage`, `formatUsd` | `lib/decimal.ts` | Formatean las cadenas decimales de la API con los separadores de es-EC, sin pasar por `number` ni redondear. |
| Contrato común de búsqueda y paginación | `packages/contracts/src/pagination.ts` | `searchParam`, `pageParams` (página desde 1, de 1 a 100 por página, 25 por defecto), `sortDirection`, filtro de estado y `listMetaSchema`. Lo usan Terceros y Productos con orden estable y desempate por `id`; la lista de usuarios conserva su propio esquema. En móvil, los filtros secundarios de una lista con muchos grupos van tras "Más filtros", que indica cuántos están activos. |
| Tablero de Inicio (`DashboardScreen`, `HomeScreen`, `dashboard-charts.tsx`) | `features/dashboard/`, `features/home/home-screen.tsx` | Resumen de `GET /dashboard` en tarjetas de la plantilla: requisitos pendientes primero, cuatro indicadores, ventas de seis meses (el mes en curso destacado) y rankings de clientes y productos en barras horizontales con los charts de shadcn/ui (`components/ui/chart.tsx`, Recharts), cada uno con su tabla para la asistencia, comprobantes del mes por tipo en barras apiladas (lo autorizado en `--chart-1` y el resto en `--chart-muted`, con leyenda y su tabla), estado del sistema y últimos comprobantes. Las ventas y los rankings tienen una sola serie, en `--chart-1`; los comprobantes por tipo son un gráfico de énfasis, cuyo gris solo marca «el resto». Los dos colores pasan el validador de paletas contra la superficie clara y la oscura: contraste de al menos 3:1 y separación ΔE de al menos 15, también con daltonismo. El estado del sistema sigue en una lista con icono y texto, porque son cuatro estados distintos y no una serie. Quien no consulta facturas ve solo la preparación para emitir. |
| Configuración en pestañas (`ConfigurationLayout`, `ConfigurationIndex`) | `features/configuration/configuration-layout.tsx`, `app/(app)/configuracion/layout.tsx` | Una página con pestañas-enlace para las secciones de Configuración que el rol ve, en el orden de la navegación; cada sección conserva su dirección, su permiso y su `h1`, y su panel toma el ancho que declara con `data-panel-width`. `/configuracion` lleva a la primera pestaña. En la barra lateral, Configuración es un solo destino. |
| Modelo de rutas canónico | `lib/navigation/routes.ts`, `lib/permissions.ts` | Única fuente de la navegación, el destino actual, las migas, la paleta (con los sinónimos de cada destino), la creación rápida, la sección plegable de Configuración y la guarda de destino no permitido. Espejo de presentación de la política del servidor; la API sigue autorizando. |

Las rutas autenticadas viven en `app/(app)/` dentro de `SessionGate`; el inicio de sesión, en
`app/(auth)/`. Los objetivos táctiles miden al menos 44px por debajo de 768px.

## Component Construction

- Colocate a component with its tests, its hook, and its own types.
- Prefer composition over configuration. A component with many appearance props is usually several components.
- Separate data from presentation: one piece resolves loading, error, and empty; the other renders a value it was given.
- Keep a component focused on one job. A file that keeps growing is decomposed before more is added to it.
- Do not pass a prop through more than about three layers that do not use it. Restructure or use context instead.

## Scope Of A UI Change

An interface change is bounded by the interface. A redesign does not silently modify
business logic, permissions, API contracts, database schema, security rules, or domain
behavior. When a screen needs something the backend does not provide, document the gap in
the OpenSpec change and implement it as its own change.

- Within that boundary, improve freely: interaction patterns, layout, hierarchy, feedback, component choice, state representation, and discoverability.
- Never invent pricing, permissions, business rules, backend behavior, required fields, or workflows that change the product logic.
- Never ship a control that does nothing. An unsupported action is a documented requirement, not a button.
- Never replace missing data with a permanent mock. A fixture belongs in a test, not in a screen.
- Never drop working functionality because the new layout has no room for it. Find the place, or raise it as a decision.

## Technical Information Boundary

The frontend may carry internal IDs in values and requests, but should present labels,
names, references, or searchable selectors. Backend-generated identifiers, database
keys, provider names, storage locations, secret references, framework names, and raw
metadata stay hidden unless the user has a documented operational reason to inspect them.

Audit or developer tools may expose technical detail, but must remain permission-gated
and visually distinct from normal product workflows.

## Verification Baseline

Before completion, exercise the screen with real conditions, not the demo dataset that made
the screenshot look good:

- zero, one, a handful, and several hundred records;
- realistic, empty, loading, partial, failure, and unauthorized data;
- missing optional values, long labels and names, large numbers, other locales, and other time zones;
- the smallest supported viewport;
- keyboard-only navigation and visible focus;
- light and dark themes;
- repeated submit clicks, slow requests, and stale responses;
- the shared frontend checklist.
