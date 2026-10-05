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
| Primitivas (`Button`, `Input`, `Label`, `Dialog`, `Menu`, `Tooltip`) | `components/ui/` | shadcn/ui sobre `radix-ui`, adaptado a los tokens. Los diálogos devuelven el foco a quien los abrió. `Button` e `Input` miden 44px de alto por debajo de 768px. |
| `AppDataTable`, `TablePagination`, `SearchInput`, `ChipGroup`, `ColumnVisibilityMenu`, `RowActionButton` | `components/data-table/` | TanStack Table con paginación de servidor; estados dentro del marco; lista de tarjetas por debajo de 768px. |
| `FormDialog`, `FormField` | `components/form-dialog.tsx` | Foco, Escape, cuerpo con desplazamiento, `Cancelar` y una acción principal; errores asociados al campo. |
| `AsyncButton`, `PasswordField`, `SelectionCardGroup` | `components/` | Pendiente con geometría estable; contraseña que se puede pegar y mostrar; elección en tarjetas de radio. |
| `StatusBadge`, `EmptyState`, `ErrorState`, `Skeleton` | `components/states.tsx` | Estado con icono y texto; vacío, sin coincidencias y sin permiso. |
| `SemanticToaster`, `useMutationFeedback` | `components/feedback.tsx` | Toda mutación pasa por aquí: pendiente, aviso, invalidación y mensajes de negocio. |
| `SessionGate`, `useSession`, `QueryProvider` | `components/session.tsx` | Sesión desde `GET /api/v1/me`; un 401 lleva al inicio de sesión conservando la URL. |
| `SegmentedControl` | `components/segmented-control.tsx` | De dos a cinco opciones visibles (Radix ToggleGroup); puede empezar sin selección cuando el dato se declara, y una opción elegida no se deselecciona. La altura de cada opción es mínima, no fija: una etiqueta larga que se parte en líneas crece dentro del borde. |
| `ConfirmDialog` | `components/confirm-dialog.tsx` | Escalera de confirmación: un paso, o escribir un texto exacto antes de confirmar; foco devuelto a quien lo abrió. |
| `EntityPickerDialog` | `components/entity-picker-dialog.tsx` | Selección de un registro relacionado: búsqueda con espera breve, resultados paginados por el servidor, combobox con selección por teclado (flechas, Inicio, Fin, Enter) y una opción rápida opcional antes de la primera página sin búsqueda. Devuelve el registro elegido; no conoce el tipo de entidad. Lo usa el editor de facturas para el comprador y los productos. |
| `Select` | `components/ui/select.tsx` | Select nativo con los tokens, para cinco a quince opciones conocidas; admite grupos con `optgroup`. Con más opciones se usa un combobox con búsqueda. Mide 44px de alto por debajo de 768px. |
| `ChipMultiSelect` | `components/chip-multi-select.tsx` | Chips conmutables de selección múltiple (Radix ToggleGroup `multiple`) para categorías cortas que se combinan, como los roles de un tercero; la selección vacía es válida y el orden es el de las opciones. |
| `FileField` | `components/file-field.tsx` | Un archivo: tipos y límite visibles antes de elegir, archivo vigente con tipo y tamaño, reemplazar y eliminar, alerta temprana de tipo y tamaño; el servidor decide por el contenido. Los tipos admiten extensiones (`.p12`) cuando el sistema no informa un tipo MIME fiable. |
| Ranuras `notice` y `status` de `AppShell` | `components/app-shell.tsx` | Aviso bajo la cabecera y estado junto a sus acciones; el layout compone ahí el aviso de ambiente y el de vencimiento de la firma. |
| `NoticeStrip` | `components/notice-strip.tsx` | Franja persistente bajo la cabecera, con icono decorativo y texto, en tono de advertencia, peligro o éxito; solo para condiciones que persisten. |
| `Switch` | `components/ui/switch.tsx` | Radix Switch para una opción que se aplica al momento, sin botón de guardar; el estado se repite con texto visible junto a él. Mide 44px de alto por debajo de 768px. |
| `formatDecimal`, `formatPercentage`, `formatUsd` | `lib/decimal.ts` | Formatean las cadenas decimales de la API con los separadores de es-EC, sin pasar por `number` ni redondear. |
| Contrato común de búsqueda y paginación | `packages/contracts/src/pagination.ts` | `searchParam`, `pageParams` (página desde 1, de 1 a 100 por página, 25 por defecto), `sortDirection`, filtro de estado y `listMetaSchema`. Lo usan Terceros y Productos con orden estable y desempate por `id`; la lista de usuarios conserva su propio esquema. En móvil, los filtros secundarios de una lista con muchos grupos van tras "Más filtros", que indica cuántos están activos. |
| Navegación filtrada por permisos | `components/navigation.tsx`, `lib/permissions.ts` | Espejo de presentación de la política del servidor; la API sigue autorizando. |

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
