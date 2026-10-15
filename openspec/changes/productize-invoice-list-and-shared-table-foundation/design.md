# Design

## Context

Motivación en `proposal.md`. Comportamiento observable en las specs delta (`invoices` y
`web-application-shell`). Este documento parte del estado real, inspeccionado el 2026-10-14 en
`redesign-frontend` (`ed91dcd`).

### La API de la lista (sin cambios en este corte)

- **Ruta:** `GET /api/v1/invoices` (`backend/src/modules/invoices/infrastructure/http/invoices-router.ts`,
  use case `invoices.list`, repositorio `fiscal/infrastructure/prisma-documents.ts`).
- **Parámetros** (`packages/contracts/src/invoices.ts`, `listInvoicesQuerySchema`):
  - `search`: hasta 100 caracteres, sin mínimo;
  - `state`: **un solo** estado de `INVOICE_STATES`;
  - `attention`: solo `"true"`;
  - `page`: desde 1;
  - `pageSize`: de 1 a 100, 25 por defecto.
  - El esquema no es estricto: un parámetro desconocido (`sort`, `environment`, `from`) se ignora
    sin error.
- **`search`** busca «contiene» en el número y en la identificación del comprador, que distinguen
  mayúsculas, y en el nombre del comprador, que no las distingue. Ninguno ignora las tildes. No
  busca la clave de acceso.
- **`attention=true`** devuelve las facturas en `SEND_UNKNOWN` o `MANUAL_REVIEW`
  (`INVOICE_ATTENTION_STATES`), o con la transmisión detenida (el último job `sri.*` en
  `STOPPED`), sea cual sea su estado. `state` y `attention` se combinan con AND.
- **Orden:** fijo, `createdAt desc, id desc`. No hay parámetro de orden.
- **Ambiente:** la lista **no** filtra por ambiente. Pruebas y Producción llegan mezcladas, y cada
  fila trae `environment`.
- **Respuesta:** `{ data, meta: { page, pageSize, total } }`. Cada fila trae `id`,
  `documentNumber`, `environment`, `issueDate`, `buyerIdentification`, `buyerName`, `total`
  (decimal en texto), `state`, `diagnosticCode` (solo en `RESERVED` con fallo de firma),
  `transmissionStopped` y `createdAt`.
- **No hay** conteos por estado ni de atención, ni disponibilidad del RIDE, ni la marca de
  consumidor final, ni `reconcilable` o `inProgress` en la fila.
- **Permisos:** `invoices.read` para administrador y operador; `invoices.draft` también para los
  dos; `archive.download` también para los dos.

### La pantalla actual

- **Estructura:** `features/invoices/invoices-screen.tsx` sobre `AppDataTable` (TanStack Table
  8.21.3, paginación manual), con un `h1` sin acción.
- **Filtros:** siete chips en `ChipGroup`: Todas, Requiere atención, Procesando, Pendientes de envío,
  Autorizadas, Devueltas y No autorizadas. «Verificando con el SRI», «Pendiente de autorización» y
  «Requiere revisión» no tienen chip.
- **Búsqueda:** `SearchInput` «Número o comprador», con 300 ms de espera.
- **URL:** `estado`, `q`, `pagina` y `filas`, con `router.replace`.
- **Columnas:** Número (enlace), Comprador e identificación, Total, Fecha y Estado al extremo
  derecho. Debajo de 768 px, tarjetas.
- **Estados:** `StatusBadge` heredado mediante `StateCell`, con el mapeo de `invoice-format.ts`:
  SEND_UNKNOWN y RESERVED en advertencia y MANUAL_REVIEW en peligro.
- **Uso compartido:**
  - `AppDataTable` lo usan 15 archivos de 13 módulos;
  - `ChipGroup` y `SearchInput`, 11;
  - `StateCell`, 13 importadores: las listas y detalles de todos los comprobantes, el archivo y
    los reportes.
- **Deuda previa:** `technical-debt.md` pide que el primer cambio con filtros independientes
  convierta en hook compartido la corrección de la carrera del estado en la URL. Hoy existe solo en
  `archive/documents-screen.tsx`.

### La plantilla (`../template-shadcn-premium/`, fuera del repositorio)

- **Versión de TanStack:** usa TanStack Table **9.3.1** (`useTable`, `features`, `table.atoms`,
  `table.FlexRender` y `ColumnDef` de dos argumentos), y todas sus tablas son de cliente.
- **Sin componentes compartidos de tabla ni `PageHeader`:** cada pantalla trae su propia barra,
  tabla y paginación.
- **Lo reutilizable:** el marcado, las clases y la composición visual, sobre todo en Tasks, Users,
  Recent customers, Recent orders y el encabezado de File manager.

## Goals / Non-Goals

**Goals:**
- Una base de lista con un contrato pequeño y estable, que la siguiente lista adopte sin tocar sus
  piezas: encabezado de página, tabla, barra de herramientas, vistas, filtro de opciones, filtros
  activos, búsqueda, paginación, acciones por fila y estado en la URL.
- Facturas completa sobre esa base, con un mapeo explícito de cada filtro de hoy al parámetro real
  y a su presentación nueva.
- Ninguna afirmación de la interfaz que el servidor no respalde: ni búsqueda más amplia, ni orden
  por columna, ni conteos inventados, ni acciones que fallen por diseño.

**Non-Goals:**
- **Sin migrar** las demás listas ni retirar en este corte `AppDataTable`, `ChipGroup`,
  `SearchInput` ni `TablePagination` heredados (D1).
- **Sin fidelidad a la API de TanStack v9:** la plantilla es fuente visual, no de la API (D2).
- **Sin cambios de comportamiento del servidor:** las brechas quedan registradas (sección
  «Brechas del backend»).

## Respuestas del alcance

| Pregunta | Respuesta |
| --- | --- |
| ¿Qué parámetros tiene hoy la API? | `search`, un `state`, `attention=true`, `page` y `pageSize`. Nada más («Context»). |
| ¿Qué busca la búsqueda? | Número, identificación y nombre del comprador, por «contiene», sin ignorar tildes. |
| ¿Qué significa `attention=true`? | SEND_UNKNOWN, MANUAL_REVIEW o transmisión detenida. No incluye RETURNED, NOT_AUTHORIZED ni RESERVED con fallo de firma. |
| ¿Qué paginación hay? | `page`, `pageSize` (1-100) y `total`. Las páginas se calculan en el cliente. |
| ¿Hay orden? | No. El servidor entrega primero las más recientes, y no se ofrecen encabezados ordenables (D10). |
| ¿Qué columnas respaldan los datos? | Número, fecha de emisión, comprador, identificación, total, estado, transmisión detenida y ambiente (D10). |
| ¿Qué acciones por fila existen? | Abrir el detalle (`invoices.read`). La API permite descargar el RIDE de una autorizada, pero la fila no trae su disponibilidad, así que por decisión del propietario se queda en el detalle. En la fila: «Ver factura» y «Copiar número», que es del cliente y no fiscal (D11). |
| ¿Qué patrones de la plantilla se reutilizan? | Ver «Trazabilidad de la plantilla». |
| ¿Qué se adapta a TanStack v8? | Todo el cableado de la tabla (D2). |
| ¿Qué componentes compartidos se introducen? | D4 a D9 y D12. |
| ¿Qué es propio de Facturas? | Las columnas, el mapeo de filtros, el conteo de atención, la marca de ambiente y las acciones de la fila (D6, D7, D10, D11, D13). |
| ¿Cómo responde a las anchuras? | Dos distribuciones de la misma tabla, según el ancho de su contenedor (D15). |
| ¿Cómo se mapean los estados? | D12. |
| ¿Cómo se impone una sola acción principal? | La ranura única de `PageHeader`, y la creación rápida sigue en `outline` (D4). |
| ¿Cómo se reducen los filtros? | Dos vistas y un filtro de estado compacto, en lugar de siete chips (D6). |
| ¿Cómo se distingue el vacío del vacío por filtros? | D14. |
| ¿Qué sigue heredado? | D1 y la sección «Fuera de alcance» de la propuesta. |
| ¿Qué recorridos se prueban? | D17. |

## Screen brief: Facturas (`/facturas`)

- **¿Quién la usa?** El operador diario, sobre todo, y también el administrador. Usuarios
  ocasionales vuelven a buscar una factura concreta.
- **¿Qué quiere lograr?** Encontrar una factura, saber en qué estado está, atender lo que espera
  una intervención y empezar una factura nueva.
- **Decisión principal:** cuál factura abrir o atender.
- **Información mínima:** número, estado, comprador, total y fecha de emisión.
- **Acción principal:** «Nueva factura». Abrir una factura es la acción principal de cada fila.

| Pregunta | Respuesta |
| --- | --- |
| ¿Con qué frecuencia? | A diario, muchas veces: densidad de negocio, teclado y estado en la URL. Sin vistas guardadas, que quedan fuera del alcance. |
| ¿Experiencia del usuario? | Conoce el negocio, no el estado interno: textos del glosario y ayuda breve solo en «Verificando con el SRI». |
| ¿Tipo de tarea? | Rutinaria, con una parte urgente: lo que requiere atención. |
| ¿Dispositivo principal? | Escritorio y portátil; el teléfono se usa para consultar. |
| ¿Si se equivoca? | Desde la lista no hay ninguna acción fiscal, así que el error máximo es abrir otra factura. El riesgo real es reemitir una venta en SEND_UNKNOWN, y la lista lo desaconseja de forma explícita. |
| ¿Qué espera al actuar? | Ver el detalle, o la pantalla de nueva factura, sin efectos fiscales. |

**Niveles de la información:**

| Nivel | Contenido |
| --- | --- |
| P0 | Título, «Nueva factura», el número de «Requiere atención», y el número y el estado de cada fila |
| P1 | Comprador, total, fecha, búsqueda, vistas y filtro de estado, transmisión detenida, marca de ambiente |
| P2 | Identificación del comprador, menú de acciones por fila, paginación y filas por página |
| P3 | Clave de acceso, mensajes del SRI, historial: solo en el detalle, fuera de la lista |

## Decisions

### D1. Base nueva junto a la heredada, con criterio de salida

- **Decisión.** La base vive en `components/layout/` y en `components/data-table/`, con archivos
  nuevos junto a `AppDataTable`, `ChipGroup`, `SearchInput` y `TablePagination`, que siguen
  sirviendo a las 12 pantallas no migradas.
- **Coherencia con el repo.** `component-system.md` pide no mantener dos sistemas de tabla tras
  adoptar un reemplazo y migrar los consumidores en una secuencia planificada. Esta es esa
  secuencia, en su primer paso. La convivencia es transitoria, como las fachadas y los tamaños
  `legacy-*` de la base (ADR 0028).
- **Registro.** Queda en `technical-debt.md` con un criterio de salida: ninguna pantalla importa las
  piezas heredadas; entonces se borran.
- **Alternativa descartada:** restilizar `AppDataTable` en el sitio. Cambiaría a la vez las 13
  pantallas que lo usan (una migración en bloque que el propietario excluyó) y arrastraría su
  contrato de tarjetas por debajo de 768 px.

### D2. TanStack Table 8.21.3: la plantilla como fuente visual

- **Decisión.** Se conserva TanStack Table 8.21.3. Ninguna interacción de este corte necesita v9.
- **Cableado en v8:** `useReactTable` con `getCoreRowModel`, `manualPagination` y `rowCount` desde
  `meta.total`. La paginación y los filtros vienen del servidor y viven en la URL (D9).
- **Equivalencias de la plantilla:**

  | v9 en la plantilla | v8 aquí |
  | --- | --- |
  | `useTable({ features })` | `useReactTable` |
  | `table.FlexRender` | `flexRender(def, context)` |
  | `table.atoms` con `<Subscribe>` | `table.getState()` |
  | `ColumnDef<Features, Row>` | `ColumnDef<Row, unknown>` |
  | Filtros, facetas y orden de cliente | Estado de la URL y parámetros del servidor; sin modelos de fila de cliente |

- **Alternativa descartada:** subir a v9. Mezclaría una migración de infraestructura con el primer
  módulo y no aporta nada al objetivo.

### D3. Primitivos derivados

- **`ui/table.tsx`** viene de `src/components/ui/table.tsx`, el contenedor con desplazamiento
  horizontal y las celdas `whitespace-nowrap` de shadcn.
- **`ui/toggle.tsx` y `ui/toggle-group.tsx`** vienen de la plantilla.
- **Adaptación a la CSP.** El `toggle-group` de la plantilla escribe `style={{ "--gap": spacing }}`,
  que la CSP bloquea (`style-src-attr 'none'`). La separación pasa a una clase.
- **Radix.** Los atributos de estado se ajustan a lo que emite Radix 1.6.7 (`data-state="on"`),
  con las variantes de `globals.css`.
- **Sin dependencias nuevas:** usan `radix-ui`, `class-variance-authority` y `lucide-react`, ya
  instaladas.

### D4. `PageHeader` (`components/layout/page-header.tsx`)

- **Contenido:**
  - `title` (el `h1` de la pantalla, con la tipografía de `design-foundations.md`);
  - `description`, opcional;
  - `context`, opcional, para un estado o una marca;
  - una sola ranura `primaryAction`;
  - `secondaryActions`, en `outline` o `ghost`.
- **Una sola acción principal por diseño:** no hay forma de pasar dos principales. Una prueba
  comprueba que el encabezado nunca tiene más de un botón en variante principal.
- **Sin migas:** las pone la barra superior del shell, y repetirlas aquí duplicaría la
  orientación (`navigation-responsive.md`).
- **En Facturas:** título «Facturas», sin descripción (no aportaría información) y la acción
  principal «Nueva factura», visible solo con `invoices.draft`.
- **Creación rápida.** La del shell sigue en `outline`, así que no compite.

### D5. Tabla y barra de herramientas (`components/data-table/`)

- **Piezas:**

  | Pieza | Archivo |
  | --- | --- |
  | Tabla | `data-table.tsx` |
  | Barra de herramientas | `data-table-toolbar.tsx` |
  | Búsqueda | `data-table-search.tsx` |
  | Vistas | `data-table-views.tsx` |
  | Filtro de opciones | `data-table-option-filter.tsx` |
  | Filtros activos | `data-table-active-filters.tsx` |
  | Paginación | `data-table-pagination.tsx` |
  | Acciones por fila | `row-actions-menu.tsx` |

- **Lo que pone cada parte.** La tabla recibe las columnas tipadas, los datos, `rowCount`, la
  página, las filas por página, la carga, el estado vacío o de error, `onRowOpen` y la etiqueta
  accesible. El módulo pone sus columnas, opciones, conteos y acciones válidas; la base no conoce el
  dominio.
- **Anatomía** (`data-tables.md`):
  - fila 1: búsqueda, vistas, filtro de estado y, a la derecha, nada más;
  - fila 2, solo con filtros activos: los filtros activos y «Limpiar filtros»;
  - la tabla;
  - el pie de paginación.
- **Densidad de negocio** (convención de diseño, no requisito):
  - encabezado de unos 40 px;
  - filas de unos 44 px en la distribución amplia;
  - controles de la barra de 32 px, con 44 px de objetivo táctil por debajo de 768 px;
  - números `tabular-nums` y totales alineados a la derecha.
- **Sin selección, columnas configurables ni orden:** no hay un flujo real que lo pida (vistas
  guardadas y acciones masivas fuera del alcance), y la API no ordena.

### D6. Vistas y filtro de estado

- **Por qué no siete chips.** Las vistas cambian el lente sobre la misma colección
  (`navigation-responsive.md`), y los estados poco frecuentes van tras un control compacto.
- **Decisión:**
  - **Vistas** (`ToggleGroup` de selección única, rol radiogroup): «Todas» y «Requiere atención»
    con su conteo (D7).
  - **Filtro «Estado»:** un menú de opción única con los ocho estados del glosario, porque la API
    acepta un solo `state`.
  - Vista y estado se combinan, igual que en el servidor (AND).
  - **Selección neutra:** las vistas y el filtro seleccionados usan la superficie de acento con el
    texto en primer plano, no el azul principal, que queda para «Nueva factura» (hallazgo de la
    revisión UX).
- **Mapeo de hoy al destino:**

  | Hoy (chip) | URL hoy | API | Destino |
  | --- | --- | --- | --- |
  | Todas | — | — | Vista «Todas» |
  | Requiere atención | `estado=atencion` | `attention=true` | Vista «Requiere atención» (`vista=atencion`); `estado=atencion` se acepta como alias de enlaces existentes |
  | Procesando | `estado=procesando` | `state=RESERVED` | Estado «Procesando» (`estado=procesando`) |
  | Pendientes de envío | `estado=firmadas` | `state=SIGNED` | Estado «Pendiente de envío» (`estado=firmadas`) |
  | Autorizadas | `estado=autorizadas` | `state=AUTHORIZED` | Estado «Autorizado» |
  | Devueltas | `estado=devueltas` | `state=RETURNED` | Estado «Devuelto» |
  | No autorizadas | `estado=no-autorizadas` | `state=NOT_AUTHORIZED` | Estado «No autorizado» |
  | (sin chip) | — | `state=SEND_UNKNOWN` | Estado «Verificando con el SRI» (`estado=verificando`), nuevo |
  | (sin chip) | — | `state=RECEIVED` | Estado «Pendiente de autorización» (`estado=recibidas`), nuevo |
  | (sin chip) | — | `state=MANUAL_REVIEW` | Estado «Requiere revisión» (`estado=revision`), nuevo |

- **Por qué «Procesando» no es una vista principal.** Con un solo `state`, «Procesando» solo puede
  ser `RESERVED`. Es un estado transitorio, y sus fallos de firma no están en la definición de
  atención. Una vista «En curso» (RESERVED, SIGNED, SEND_UNKNOWN y RECEIVED) necesitaría varios
  estados por consulta: queda como brecha del backend.
- **Móvil.** Sin «Más filtros» ni hoja inferior. Con una sola opción secundaria, el filtro de estado
  ya es el control progresivo, y su disparador mide 44 px. `data-tables.md` pide la hoja cuando hay
  varios filtros; se recoge aquí como decisión, no como excepción.

### D7. Conteo de «Requiere atención» (PO-2, aprobada)

- **Decisión.** Una consulta propia `attention=true&pageSize=1` lee `meta.total`. No es una
  capacidad nueva del backend ni un agregado fiscal.
- **Qué cuenta:** toda la población de atención de la empresa, con la semántica vigente de
  `attention=true`.
  - No es un conteo por estado ni por ambiente.
  - No sale de recorrer páginas en el cliente.
  - No depende de la página, de las filas por página, del estado ni de la búsqueda.
- **Cuándo se pide.** Tiene su propia clave de consulta, sin esos parámetros, así que un cambio de
  presentación no la repite. Se vuelve a pedir con la invalidación habitual de las facturas y al
  volver a la ventana, igual que la lista.
- **Por qué.** Responde de forma visible a «¿algo me espera?», sin alarmar.

### D8. Búsqueda

- **Etiqueta y ayuda:** «Buscar por número, comprador o identificación» y «Número, comprador o
  identificación», que es lo que el servidor busca.
- **Comportamiento:** espera de 300 ms, recorte de espacios, `maxLength` de 100 (el límite del
  servidor), borrar con «Limpiar búsqueda», y la búsqueda vuelve a la primera página.
- **Sin búsqueda de cliente** sobre la página cargada.
- **La clave de acceso no se busca:** queda como brecha.

### D9. Estado de la lista en la URL (`hooks/use-list-url-state.ts`)

- **Hook compartido.** Recibe un esquema de parámetros (vista, estado, `q`, `pagina` y `filas`) con
  sus valores por defecto y sus alias.
- **Corrección de la carrera.** Aplica la de `archive/documents-screen.tsx`: los cambios se
  acumulan sobre el último pedido, no sobre los parámetros de la última representación. Así se
  salda la deuda registrada.
- **Navegación:** usa `router.replace` sin desplazar. Cambiar cualquier filtro borra `pagina`.
- **Página fuera de rango:** con `total > 0` y una página posterior a la última, va a la última.
- **Volver desde el detalle** restaura la lista porque todo está en la URL.
- **Alternativa descartada:** una librería de estado global (Zustand), excluida por el propietario
  e innecesaria.

### D10. Columnas y orden (Facturas)

- **Distribución amplia** (D15):

  | Columna | Contenido | Alineación |
  | --- | --- | --- |
  | Factura | Enlace con el número (`whitespace-nowrap`, `tabular-nums`), la fecha de emisión debajo en atenuado, y la marca de atención o de ambiente delante cuando aplica | Izquierda |
  | Estado | `DocumentStatusBadge` y, si aplica, «Transmisión detenida» debajo | Izquierda, junto al número |
  | Comprador | Nombre (se recorta con su nombre completo accesible) y la identificación debajo | Izquierda |
  | Total | `formatUsd`, `whitespace-nowrap`, `tabular-nums` | Derecha |
  | (acciones) | `RowActionsMenu` | Derecha, estrecha y estable |

- **Número y estado juntos**, para leerlos de un vistazo.
- **Sin columna de fecha propia:** la fecha va bajo el número para que, a 1024 px con la barra
  expandida (unos 720 px útiles), el comprador conserve unos 150 px sin partir el número ni el
  total.
- **Sin encabezados ordenables:** la API entrega siempre primero las más recientes.
- **Nombre accesible de la tabla:** se conserva «Facturas emitidas».

### D11. Apertura de una factura y acciones por fila

- **Enlace principal.** El número es un enlace real a `/facturas/{id}`, alcanzable con Tab, que
  admite Ctrl/⌘-clic y el clic central.
- **Clic en la fila** (comodidad del puntero). Un manejador en la fila navega cuando el clic cae en
  una zona no interactiva, y no lo hace:
  - si viene de un enlace, un botón o un menú;
  - si hay una selección de texto;
  - si se usó un modificador.

  La fila no tiene rol interactivo, así que no hay elementos interactivos anidados. El teclado usa
  el enlace.
- **`RowActionsMenu`** (PO-3, modificada por el propietario). Es un botón de icono con el nombre
  accesible «Acciones de la factura 001-001-000000123» y su ayuda, y abre un menú alineado al final.
  Sus acciones:
  - **«Ver factura»:** siempre. Repite el destino del enlace del número, pero dentro del menú, sin
    añadir paradas de teclado.
  - **«Copiar número»:** copia solo el número visible, con una confirmación accesible. Nunca la
    clave de acceso, el identificador interno ni datos personales.
- **Excluidas:**
  - **«Descargar RIDE».** La fila no trae la disponibilidad del RIDE, y la lista no la adivina ni
    pide el detalle por fila. El RIDE sigue en el detalle, y podrá añadirse aquí cuando una lectura
    de la lista exponga su disponibilidad.
  - **Notas de crédito o de débito:** siguen en sus flujos y en el detalle.
  - **Reintentar la firma y reconciliar:** son mutaciones fiscales y siguen en el detalle.
  - **Anular, reenviar y duplicar:** no existen.
- **Sin consultas por fila:** la tabla usa solo la respuesta de la lista y el contexto de la empresa
  del shell.
- **Presupuesto de acciones:** abrir la fila es la acción principal, y hay como mucho tres
  secundarias en el menú (`cognitive-architecture.md`).

### D12. `DocumentStatusBadge` (`features/documents/document-status-badge.tsx`)

- **Composición:** sobre `ui/badge`, con texto del glosario (`INVOICE_STATE_LABELS`) e icono.
  Nunca solo color.
- **Mapeo aprobado:**

  | Estado | Texto | Variante | Icono |
  | --- | --- | --- | --- |
  | RESERVED | Procesando | info | Hourglass |
  | SIGNED | Pendiente de envío | info | FileCheck2 |
  | SEND_UNKNOWN | Verificando con el SRI | info | SearchCheck |
  | RECEIVED | Pendiente de autorización | info | Clock3 |
  | RETURNED | Devuelto | destructive | Undo2 |
  | AUTHORIZED | Autorizado | success | BadgeCheck |
  | NOT_AUTHORIZED | No autorizado | destructive | Ban |
  | MANUAL_REVIEW | Requiere revisión | warning | TriangleAlert |

- **«Verificando con el SRI».** Lleva junto a la insignia un botón de ayuda pequeño, con nombre
  accesible y una ayuda que dice: «El envío pudo haber llegado. No emitas esta venta nuevamente.».
  La celda no se convierte en un párrafo.
- **Transmisión detenida:** una segunda insignia `warning` con `CirclePause`, «Transmisión
  detenida».
- **Marca de atención.** Un punto discreto delante del número, con el texto accesible «Requiere
  atención» y su ayuda. Se calcula con `INVOICE_ATTENTION_STATES` o `transmissionStopped`, la
  misma regla que el servidor. No colorea la fila.
- **Alcance (decisión del propietario, PO-1).**
  - **Recomendado:** `DocumentStatusBadge` es la única presentación del estado de los comprobantes.
    `StateCell` queda como fachada que delega en él, así que las 13 pantallas que lo usan reciben el
    mismo mapeo, sin migrar su estructura. Así se cumple que un estado se vea igual en todas partes
    (`data-tables.md`), y el mismo comprobante no se ve «en revisión» como rechazo en el Archivo y
    como advertencia en Facturas.
  - **Alternativa:** solo Facturas. Las demás pantallas conservan el mapeo heredado hasta su corte,
    con la incoherencia registrada como deuda.
  - Ninguna de las dos cambia las specs.

### D13. Ambiente de cada factura (PO-4, aprobada y obligatoria)

- **Dato.** La respuesta de la lista trae `environment` en cada fila (`invoiceSummaryViewSchema`). El
  ambiente nunca se infiere del número, del estado ni de la clave de acceso.
- **Factura de Pruebas en una empresa en Producción.** Una insignia neutra junto a la identidad, con
  el texto «Pruebas · sin validez tributaria» en la distribución amplia, o «Pruebas» con su ayuda
  «Sin validez tributaria» en la compacta. No parece rechazada: el estado sigue aparte, y una
  factura autorizada en Pruebas se ve «Autorizado».
- **Factura de Producción en una empresa en Pruebas.** «Producción» como contexto, con la
  semántica de ambiente de la base (`emphasis` neutro), nunca el verde de éxito.
- **Mismo ambiente:** sin indicación, porque el shell ya dice el vigente.
- **Ambiente desconocido.** Si el vigente no puede confirmarse, se marcan las facturas de Pruebas,
  para no presentarlas nunca como válidas.
- **Sin filtro de ambiente.** El servidor no lo ofrece, y la lista no filtra la página cargada en
  el navegador. Queda como brecha.
- **Por qué.** La API mezcla los dos ambientes. Tras pasar a Producción, una factura de Pruebas
  podría entregarse como válida, y esto lo evita sin tocar el backend.

### D14. Carga, vacío y error

- **Todo dentro de la superficie de la tabla.** El encabezado de página y la barra no se mueven
  (`feedback-and-states.md`).
- **Primera carga:** filas esqueleto que conservan la geometría de las columnas, y el pie de
  paginación sin cifras.
- **Recarga** (con `keepPreviousData`): las filas siguen y la tabla anuncia `aria-busy`.
- **Vacío inicial** (`Empty`):
  - «Todavía no hay facturas»;
  - «Aquí aparecen las facturas que emites. Empieza con un borrador.»;
  - con `invoices.draft`, la acción «Nueva factura» en `outline`, para no duplicar el peso de la
    principal del encabezado (una sola acción focal);
  - sin paginación.
- **Vacío por filtros:**
  - «No hay facturas con estos filtros»;
  - nombra la búsqueda o el estado activos;
  - ofrece «Limpiar filtros» y nunca crear;
  - sin paginación.
- **Error:**
  - «No pudimos cargar las facturas.» con «Intentar de nuevo» (el `refetch` de TanStack Query);
  - sin JSON ni trazas;
  - el encabezado y la barra siguen.
- **Sin permiso:** la guarda del shell y, ante un 403 de la API, el estado «No tienes acceso a
  Facturas» dentro del `PageHeader`.

### D15. Lectura a cualquier anchura

Una sola tabla semántica con dos distribuciones, elegidas con container queries de Tailwind 4 sobre
el contenedor de la tabla. Son CSS puro, compatible con la CSP. Dependen del espacio real, que
cambia con la barra expandida o colapsada, y no del viewport.

- **Amplia** (contenedor de 576 px o más, `@xl`): las cinco columnas de D10. Cubre 1024 px con la
  barra expandida y 768 px con la barra colapsada.
- **Compacta** (menos de 576 px): dos columnas.
  - «Factura»: el número, el comprador y la insignia de estado, en líneas.
  - «Total»: el total y, debajo, la fecha.
  - Las columnas Estado, Comprador y acciones se ocultan a la vez que sus encabezados.
  - El menú de acciones sigue accesible dentro de la celda del total, para que todo quepa a 390 px
    sin desplazar. Solo una de sus dos copias es visible a la vez, y la oculta queda fuera del
    árbol de accesibilidad y del orden de Tab.
- **Si no cabe** (por ejemplo a 320 px), la tabla se desplaza dentro de su contenedor, nunca la
  página. No hay tarjetas.
- **Sin columna fija:** la identidad ya es la primera columna en las dos distribuciones.
- **Documentación.** `data-tables.md` permite elegir por tabla. `frontend.md`, que hoy describe las
  tarjetas de `AppDataTable`, se actualiza.

### D16. Accesibilidad y teclado

- **Semántica:** tabla con `caption` accesible, encabezados `th` con `scope` y un encabezado
  visualmente oculto «Acciones».
- **Orden de Tab:** acción principal, búsqueda, vistas (flechas dentro del grupo), filtro de
  estado, filtros activos, «Limpiar filtros», cada número, cada menú de fila y la paginación.
- **Menús:** las vistas y el filtro anuncian su selección, y el menú de la fila tiene nombre propio
  y devuelve el foco al cerrarse.
- **Estado:** el texto nunca depende del color, y la ayuda de SEND_UNKNOWN se abre con foco y con
  el puntero.
- **Paginación:** «Primera página», «Página anterior», «Página siguiente», «Última página», «Página
  X de Y» y «Filas por página».
- **Objetivos táctiles** de 44 px por debajo de 768 px.

### D17. Pruebas

- **Unitarias de la base (Vitest):**
  - `DataTable`: encabezados, filas, esqueleto, vacío y error en la superficie, pie sin cifras al
    cargar o sin filas, `onRowOpen` que ignora clics interactivos y selecciones, y `caption`;
  - paginación: textos, límites deshabilitados y filas por página;
  - vistas: radiogroup, flechas y conteo accesible;
  - filtro de opciones: opción única y quitar;
  - filtros activos: quitar uno y limpiar;
  - `RowActionsMenu`: nombre accesible y elementos;
  - `PageHeader`: una sola principal;
  - `DocumentStatusBadge`:
    - variante por estado;
    - SEND_UNKNOWN nunca destructivo y con su ayuda;
    - MANUAL_REVIEW como advertencia;
    - texto con icono;
    - transmisión detenida;
  - `useListUrlState`: cambios rápidos, alias `estado=atencion`, volver a la página 1 y página
    fuera de rango.
- **De la pantalla (Vitest):**
  - acción principal con permiso y sin él;
  - vistas y conteo;
  - cada estado hacia su parámetro;
  - búsqueda veraz con su espera;
  - restaurar desde la URL;
  - «Limpiar filtros» solo con filtros;
  - paginación;
  - vacío inicial, vacío por filtros y error;
  - enlace y clic de fila;
  - acciones por estado y permiso, y el RIDE no disponible;
  - marcas de ambiente y de atención;
  - sin encabezados ordenables.
  - Las pruebas actuales de Facturas (`invoices-screen.test.tsx`, `invoice-transmission.test.tsx`)
    se actualizan sin borrar comportamientos. Cada aserción que cambia (por ejemplo, el radiogroup
    «Estado» de siete chips) se explica en el commit.
- **Navegador (harness):**
  - **Teclado:** el recorrido de D16.
  - **Axe:** claro, oscuro, vista de atención y móvil.
  - **Anchuras:** a 1024 px con la barra expandida, el número y el total en una línea, medido por
    altura. A 390 px, número, comprador, estado y total dentro de la tabla, sin desbordar la página.
    A 320 px, desplazamiento solo de la tabla.
- **Capturas** (proyecto `shell`, conjunto pequeño, revisadas a mano antes de aceptarlas):
  - escritorio claro con datos;
  - escritorio oscuro con datos;
  - vista «Requiere atención»;
  - vacío inicial;
  - vacío por filtros;
  - carga;
  - error;
  - 1024 px con una empresa en Producción y facturas de Pruebas (marca de ambiente);
  - 390 px.

  La captura «lista heredada de facturas dentro del shell» se sustituye por la de escritorio claro.
  Las capturas del shell tomadas sobre `/facturas` (barra colapsada, tableta, paleta, creación
  rápida y error de ruta) cambian de fondo: se revisan sus diferencias y se actualizan solo
  ellas.
- **Arnés.** Los datos del harness aceptan parámetros de consulta (`attention`, `state`, `search`,
  `page` y `pageSize`), para responder la lista y el conteo con datos deterministas.

### D18. Rendimiento

- **Medición:** `corepack pnpm test:visual:bundle` antes del primer cambio de código y al final,
  sobre `/facturas` (JavaScript, CSS y fuente), en
  `docs/quality/benchmarks/frontend-facturas-<fecha>.md`.
- **Peticiones:** la lista y el conteo de atención (D7), sin repetir el conteo por cambio de filtro.
  La búsqueda espera 300 ms y las vistas y el estado no esperan. Sin pedir todas las páginas.
- **Sin dependencias nuevas.** Las piezas de la base se cargan con la pantalla que las usa.

### D19. Aplicación escalonada del lint

- **Rutas nuevas en la lista estricta** de `eslint.config.js`: `components/layout/**`, los archivos
  nuevos de `components/data-table/`, `features/documents/**`, `hooks/use-list-url-state.ts` y
  `features/invoices/invoices-screen.tsx`.
- **Qué prohíbe:** `radix-ui` directo (va por `components/ui`), `@/components/states` y los tamaños
  `legacy-*`.
- **Consecuencia:** la pantalla migrada usa `ui/empty`, `ui/skeleton` y `Button` en sus tamaños
  canónicos (`component-system.md`).

### D20. Revisión UX posterior

- **Revisión enfocada** en Facturas, después de la verificación técnica:
  - a 1440, 1024, 768 y 390 px, en claro y oscuro;
  - con el operador diario, el usuario ocasional y el administrador nuevo;
  - con datos del harness y sobre el despliegue local de revisión, que está vacío.
- **Umbral:** sin hallazgos S4/S5, ni S3 atribuibles a la base o al encabezado, y el operador diario
  en 4/5 o más.
- **Hallazgos heredados.** Un S3 que venga solo de una limitación del backend o de una pantalla
  fuera del alcance se informa aparte.

## Trazabilidad de la plantilla

Origen relativo a `../template-shadcn-premium/`, donde `D/` es `src/app/(main)/dashboard/`. Destino
relativo a `frontend/src/`. Licencia: MIT de «Studio Admin», sobre primitivos MIT de shadcn/ui; los
avisos se añaden a `frontend/THIRD_PARTY_NOTICES.md`.

| Origen | Destino | Clase | Por qué se adapta | Dependencias | Accesibilidad | CSP |
| --- | --- | --- | --- | --- | --- | --- |
| `src/components/ui/table.tsx` | `components/ui/table.tsx` | Directo | — | ninguna | Igual | Sin `style` |
| `src/components/ui/toggle.tsx`, `toggle-group.tsx` | `components/ui/toggle.tsx`, `toggle-group.tsx` | Adaptado | `--gap` por clase; estados de Radix 1.6.7 | `radix-ui`, cva | Radiogroup de Radix | Sin el `style` de `--gap` |
| `D/tasks/_components/tasks.tsx`, `D/users/_components/users-table.tsx` | `components/data-table/data-table.tsx` | Visual portado | v9 a v8; paginación del servidor | TanStack 8.21.3 | `caption`, `scope` y estados en la superficie | Sin `style`; sin anchos dinámicos por atributo |
| `D/tasks/_components/tasks-toolbar.tsx` | `data-table-toolbar.tsx`, `data-table-search.tsx` | Visual portado | Búsqueda del servidor con espera; etiqueta veraz | — | Etiqueta accesible y «Limpiar búsqueda» | — |
| `D/tasks/_components/task-status-filter.tsx` | `data-table-option-filter.tsx` | Adaptado | Opción única (el servidor acepta un estado); selección neutra | `ui/dropdown-menu` | Grupo de radio del menú | — |
| `D/ecommerce/_components/recent-orders.tsx` (vistas «All / Needs action») | `data-table-views.tsx` | Adaptado | Vistas del servidor con conteo | `ui/toggle-group` | Radiogroup y conteo accesible | Sin `--gap` |
| `D/tasks/_components/tasks.tsx` (pie) y `D/default/_components/recent-customers-table/table.tsx` | `data-table-pagination.tsx` | Visual portado | «Mostrando A-B de N»; sin cifras al cargar o vacía | `ui/select` (nativo) | Nombres de cada botón | — |
| `D/users/_components/users-columns.tsx` (acciones) | `row-actions-menu.tsx` | Adaptado | Nombre accesible con el número; solo acciones del dominio («Ver factura», «Copiar número») | `ui/dropdown-menu`, `ui/tooltip` | El original de Roles no tiene nombre: aquí siempre | — |
| `D/users/_components/users-columns.tsx` (identidad) | Columnas de `features/invoices/` | Visual portado | Número y fecha; comprador e identificación | — | El texto recortado conserva su nombre completo | — |
| `D/tasks/_components/columns.tsx` (insignia de estado) | `features/documents/document-status-badge.tsx` | Adaptado | Variantes semánticas con tokens, no clases de paleta | `ui/badge` | Texto con icono y ayuda con foco | — |
| `D/file-manager/page.tsx` (encabezado) | `components/layout/page-header.tsx` | Visual portado | Una sola ranura principal; sin migas | `ui/button` | `h1` único | — |
| (sin origen) | `data-table-active-filters.tsx`, estados de la tabla | Propio | La plantilla no tiene filtros activos ni estados de carga o vacío en tablas | `ui/badge`, `ui/empty`, `ui/skeleton` | Quitar con nombre accesible | — |

## Brechas del backend (fuera de este cambio)

| Brecha | Efecto en la interfaz | Mientras tanto |
| --- | --- | --- |
| Un solo `state` por consulta | Sin una vista «En curso» de varios estados | Filtro de estado único (D6) |
| Sin orden por columna | Sin encabezados ordenables | Las más recientes primero |
| Sin filtro de ambiente | Pruebas y Producción mezcladas | Marca de ambiente por fila (D13) |
| Sin conteos por estado ni de atención | El conteo cuesta una consulta extra | `attention=true&pageSize=1` (D7) |
| La fila no trae la disponibilidad del RIDE, la marca de consumidor final, `reconcilable` ni `inProgress` | Sin «Descargar RIDE» ni notas desde la fila | Siguen en el detalle de la factura |
| La búsqueda distingue tildes, distingue mayúsculas en el número y no busca la clave de acceso | La búsqueda es más estrecha de lo que el usuario podría esperar | La etiqueta dice exactamente lo que busca |
| «Requiere atención» no incluye los fallos de firma (RESERVED con diagnóstico) | Un fallo de firma no aparece en esa vista | Se respeta la definición del dominio y se informa al propietario |

## Operaciones sensibles

- **Ninguna operación nueva.** La lista es de lectura y ya está aislada por empresa.
- **El conteo** usa la misma consulta aislada y no puede revelar facturas de otra empresa.
- **«Copiar número»** es del cliente y copia solo el número visible.
- **Sin descargas ni consultas por fila** desde la lista.
- **Sin mutaciones fiscales** desde la lista.

## Risks / Trade-offs

- **[Dos sistemas de tabla durante la migración]** → Es transitorio y tiene criterio de salida en la
  deuda (D1). La pieza heredada no admite código nuevo, porque el lint escalonado la excluye de las
  rutas migradas.
- **[El conteo añade una petición]** → Una fila y un total, sin repetir por cambios de
  presentación (D7).
- **[El estado de los comprobantes cambia también en las otras pantallas (PO-1)]** → Solo la
  insignia, con el mapeo ya aprobado. El harness y las pruebas de esas pantallas se revisan, y la
  alternativa de solo Facturas queda disponible.
- **[La distribución compacta oculta columnas]** → Sus datos pasan a la primera columna y no se
  pierden. Las acciones siguen en el detalle.
- **[El clic de fila puede interferir con seleccionar texto]** → No navega con una selección activa,
  ni desde elementos interactivos, ni con modificadores (D11).
- **[Las capturas del shell sobre `/facturas` cambian]** → Se revisan las diferencias una por una y
  se actualizan solo las afectadas.
- **[AC-04 sigue inestable bajo carga]** → No se toca. La verificación final informa su evidencia
  tal como sea.

## Migration Plan

- **Rama y commits.** Todo ocurre en `redesign-frontend`, con un commit por grupo de tareas, en el
  orden de `tasks.md`.
  - Antes de tocar la interfaz: los datos del harness y la medición previa.
  - Después: los primitivos, el hook, la base, el encabezado, la insignia, la pantalla, el lint y la
    documentación, las capturas y la verificación.
- **Reversión.** Cada grupo se revierte por separado. Si se revierte la pantalla, Facturas vuelve a
  `AppDataTable`, que sigue intacto.
- **Sin despliegue, migraciones ni cambios de API.** El cambio no se archiva, no se fusiona en
  `main` y no se sube sin la revisión del propietario.
- **CI alojado.** No puede ejecutarse por la facturación de la cuenta. La verificación final es un
  `verify` en sala limpia, según la política vigente.

## Decisiones del propietario (2026-10-14)

| Id | Decisión |
| --- | --- |
| PO-1 | **Aprobada.** `DocumentStatusBadge` es la presentación canónica del estado de los comprobantes, mediante la fachada de `StateCell`. En las demás pantallas solo cambia la presentación del estado: no su tabla, columnas, filtros, paginación, acciones, encabezado, comportamiento por anchura, estados vacíos ni flujos. |
| PO-2 | **Aprobada.** Conteo con una consulta `attention=true&pageSize=1`, global e independiente de la página, las filas, el estado y la búsqueda (D7). |
| PO-3 | **Modificada.** En la fila, solo «Ver factura» y «Copiar número». Sin «Descargar RIDE» ni notas de crédito o débito (D11). |
| PO-4 | **Aprobada y obligatoria.** Indicación con texto del ambiente distinto del vigente, con «sin validez tributaria» para Pruebas, sin filtro de ambiente (D13). |
| PO-5 | **Aprobada.** Vistas «Todas» y «Requiere atención» solamente, más el filtro «Estado» de opción única (D6). |
