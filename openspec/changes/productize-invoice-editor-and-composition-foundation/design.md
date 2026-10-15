# Design

## Context

La motivación está en `proposal.md` y el comportamiento observable en las specs delta
(`web-application-shell` e `invoices`). Este documento parte del producto real, medido el
2026-10-15 en `redesign-frontend` (`97834b8`), sin tráfico al SRI.

### Barra superior (`frontend/src/components/shell/topbar.tsx`)

- **Composición:** 48 px de alto (56 px por debajo de 768 px), con siete elementos centrados en
  y=24 y separados siempre por el mismo hueco de 8 px:
  - el botón de la barra lateral;
  - un separador;
  - las migas (`AppBreadcrumbs`, `flex-1`);
  - el contexto de la empresa (`md:max-w-64`);
  - la paleta;
  - el ambiente;
  - el grupo «Tema» de 106×38 px;
  - la cuenta.
- **Fallo V4:** el contexto de la empresa, de unos 215 px, tiene prioridad sobre las migas.
  - A 1024 y 1280 px, las migas miden 182×40 px: dos líneas, y la página actual se corta en
    «Nueva f…».
  - A 768 px miden 0×60 px y se montan sobre el nombre de la empresa.
- **Migas en móvil:** el shell ya las pinta dentro del contenido
  (`app-shell.tsx`: `<AppBreadcrumbs className="mb-4 md:hidden" />`).
- **Enlaces de vuelta:** 14 pantallas de detalle y de editor añaden además un enlace «volver»
  (`ArrowLeft`) que repite la primera miga.

### Ambiente en el shell

- **Hoy:** el distintivo compacto de la barra (`EnvironmentBadge`: «Pruebas» con advertencia,
  «Producción» en `emphasis`, nada si el ambiente no se confirma) y, debajo, una franja de ancho
  completo (`EnvironmentNotice` sobre `NoticeStrip`).
  - En Pruebas, la franja dice «Ambiente de Pruebas: los comprobantes no tienen validez
    tributaria.».
  - Si el ambiente no se confirma, la franja dice «Ambiente desconocido…».
- **Specs que hoy la exigen:**
  - `web-application-shell`: «Ambiente fiscal visible en el shell», «Shell autenticado disponible»
    y «Carga de una pantalla»;
  - `taxpayer-setup`: «Aviso persistente del ambiente».
- **Trazabilidad:** ERS RF-004 (distinguir los ambientes de forma inequívoca) y RF-005 (advertencia
  persistente en Pruebas).
- **Confirmaciones de los editores:** las seis muestran «Ambiente: Pruebas» o «Desconocido».
  - Ninguna dice «sin validez tributaria»: eso lo aportaba la franja.
  - Son las de la factura (`draft-editor.tsx`) y de los editores de nota de crédito, nota de débito,
    retención, guía y liquidación.
- **La franja de la firma** (vencimiento de la firma electrónica) usa el mismo `NoticeStrip` y no
  cambia.

### Guardar y emitir en el servidor

- **Guardar** (`backend/src/modules/invoices/application/drafts.ts`, `create` y `update`):
  - **acepta borradores incompletos:** sin punto, sin comprador, sin líneas o sin formas de pago;
  - **solo rechaza:**
    - el formato del cuerpo (`createDraftSchema` y `updateDraftSchema`);
    - más líneas que el máximo (`INVOICE_TOO_MANY_LINES`);
    - referencias que no existen en la empresa: `EMISSION_POINT_NOT_FOUND`, `BUYER_NOT_FOUND`,
      `PRODUCT_NOT_FOUND` y `PAYMENT_METHOD_NOT_FOUND` (fuera del catálogo vigente);
    - la versión desactualizada (`INVOICE_DRAFT_CHANGED`);
    - el borrador ya emitido (`INVOICE_DRAFT_ALREADY_EMITTED`);
    - la falta de permiso (`invoices.draft`).
  - **En el cliente,** Zod pide una cantidad válida, un descuento válido o vacío, y una forma de
    pago elegida en cada fila existente.
- **Vista previa:** cada `GET` y cada guardado devuelven la evaluación del borrador a la fecha
  (`evaluateInvoice`, `backend/src/modules/invoices/domain/evaluation.ts`).
  - Sus problemas son exactamente los requisitos de la emisión:
    - lo que falta (`INVOICE_DRAFT_INCOMPLETE`);
    - contribuyente configurado y firma usable;
    - punto disponible;
    - comprador cliente y activo;
    - productos activos;
    - impuestos calculables;
    - descuentos;
    - límites de consumidor final;
    - formas de pago utilizables y que suman el total;
    - esquema disponible.
- **Emisión** (`backend/src/modules/invoices/application/emission.ts`, `reserve`):
  - comprueba `invoices.emit`, la `Idempotency-Key`, el borrador sin emitir y la versión esperada;
  - vuelve a ejecutar la misma evaluación bajo bloqueo, a la fecha de emisión, y rechaza con el
    primer problema (`EmissionRejectedError`);
  - una condición que cambió después de la vista previa, como la firma, se rechaza al emitir.
- **Al volver a montar:** el editor se monta de nuevo con cada versión guardada
  (`key={id-version}`). Una edición hecha mientras el guardado está en curso se pierde al montarse
  la versión nueva.

### Editor de facturas (`frontend/src/features/invoices/draft-editor.tsx`, 827 líneas)

- **Rutas:** `/borradores/nuevo` (`DraftEditorScreen draftId={null}`) y `/borradores/[id]`.
  - El modelo de rutas (`lib/navigation/routes.ts`, `INTERNAL_ROUTES`) asigna las dos a
    Borradores de facturas.
  - La primera vez que se guarda, `router.replace` cambia `/borradores/nuevo` por
    `/borradores/{id}`.
- **Formulario:** React Hook Form con Zod.
  - Punto de emisión: `select`.
  - Comprador: `EntityPickerDialog` de clientes, con la opción rápida «Consumidor final».
  - Líneas: producto elegido en `EntityPickerDialog`, cantidad, precio unitario de solo lectura
    (el del producto) y descuento.
  - Formas de pago: catálogo y un importe opcional.
- **Guardado:** `useSaveDraft` hace `POST /api/v1/invoices/drafts` o
  `PUT /api/v1/invoices/drafts/{id}` con `expectedVersion`.
  - La respuesta trae `preview` (`draftPreviewViewSchema`): `evaluatedOn`, por línea
    `taxableBase` e impuestos, `totals` (`null` si una línea no se puede calcular), `issues` y
    `stockWarnings`.
  - **El servidor solo calcula al persistir:** no hay vista previa sin guardar
    (`SERVER_TOTAL_PREVIEW_GAP`).
- **Emisión:** `useEmitInvoice` hace `POST /api/v1/invoices` con `Idempotency-Key` (una por versión
  del borrador) y, si sale bien, lleva a `/facturas/{id}`.
  - `ConfirmDialog` muestra el ambiente (o «Desconocido»), el comprador, el total del servidor y
    las líneas, más el aviso de consumidor final.
- **Habilitación de «Emitir»** (`emitBlocked`):
  - sin borrador, con cambios sin guardar, con problemas o con el guardado en curso;
  - el motivo va en `emitHint`, en texto de 12 px.
- **Problemas y errores:**
  - los problemas del servidor se muestran por línea, por forma de pago y en general, solo
    con el borrador guardado y sin cambios;
  - recuperación de `INVOICE_DRAFT_CHANGED` («Recargar borrador») y de
    `INVOICE_DRAFT_ALREADY_EMITTED` («Ver facturas»).
- **Cambios sin guardar:** existe `isDirty`, pero no hay indicador ni aviso al salir
  (`UNSAVED_CHANGES_GAP`).
- **Formas de pago** (spec `invoices`, «Formas de pago»):
  - una sola sin importe cubre el total; con varias, todas llevan importe y deben sumar
    exactamente el total;
  - el editor deja quitar cualquier fila, incluida la última, y el servidor lo señala como
    problema del borrador;
  - la ayuda «Vacío: el total» solo aparece con una forma de pago y significa «sin importe, se usa
    el total de la factura».
- **Composición medida:**
  - `form` en rejilla `lg:grid-cols-[minmax(0,1fr)_20rem]`;
  - formulario y resumen en 792:320 a 1440 px, 632:320 a 1280 y 376:320 a 1024 con la barra
    expandida;
  - la fila de pago es `items-end` con la ayuda bajo el importe: las etiquetas quedan desfasadas
    20 px;
  - el comprador va en una caja y el punto de emisión en un `select` a todo el ancho, de 792 px.

### Primitivos compartidos

- **`Button`** (`components/ui/button.tsx`): `disabled:opacity-50` en todas las variantes. Una
  principal deshabilitada se ve azul translúcida, más viva que las secundarias activas.
  `AsyncButton` usa `disabled` más `aria-busy` mientras espera.
- **Selección en azul principal:**
  - `ChipGroup` (`data-table/table-controls.tsx`) en 10 listas heredadas: inventario, retenciones,
    notas de crédito, liquidaciones, notas de débito, usuarios, guías, terceros, productos y
    archivo;
  - `SegmentedControl` en 11 consumidores: movimientos de inventario, sustento y editor de
    retención, reportes, editores de nota de crédito y de débito, diálogo de producto,
    secuenciales, destinatario y editor de guía, y Empresa.
- **Estado vacío con dos principales:** cinco listas reutilizan en el estado vacío el botón principal
  del encabezado, `action={newX ?? undefined}`: notas de crédito, notas de débito, retenciones,
  guías y liquidaciones.
- **Anchos de contenido:** `max-w-3xl` (11 usos), `max-w-2xl` (5), `max-w-xl` (3), `max-w-5xl` (3)
  y el ancho completo.

## Goals / Non-Goals

**Goals:**
- Cerrar el V4 de la barra superior a todas las anchuras, con una sola orientación por pantalla.
- Cerrar el V4 de formularios para el editor de facturas, con primitivos que tengan consumidor real.
- Un editor que el operador diario use sin buscar la acción ni dudar de los totales.
- Un flujo de revisión visual repetible que el agente ejecute, abra e interprete.

**Non-Goals:**
- Ninguna pantalla heredada adopta `PageHeader`, la distribución de formulario ni los anchos por
  función en este cambio. Solo reciben los cambios transversales listados en D9 y D12.
- Sin cambios de backend, API, base de datos, lógica fiscal ni de la máquina de estados.
- Sin vista previa de totales sin guardar, sin guardado automático y sin bloqueo de la navegación
  interna.

## Screen brief: editor de facturas (`/borradores/nuevo`, `/borradores/{id}`)

- **¿Quién la usa?** El operador diario, muchas veces al día; el administrador nuevo, las primeras
  veces; un usuario ocasional que retoma un borrador.
- **¿Qué quiere lograr?** Preparar una factura correcta y emitirla sin miedo a equivocarse.
- **Decisión principal:** si la factura está lista para emitirse y, si no, qué falta.
- **Información mínima:** comprador, punto, líneas, formas de pago, la siguiente acción y su motivo,
  y los totales del servidor.
- **Acción principal:** la siguiente válida: guardar o emitir (D14).

| Nivel | Contenido |
| --- | --- |
| P0 | Título y migas, comprador, líneas, formas de pago, la acción siguiente y el motivo de la que no está disponible |
| P1 | Totales del servidor, problemas, ambiente junto a la emisión, punto de emisión, «Cambios sin guardar» |
| P2 | Avisos de existencias, «Vista previa del…, sin validez fiscal», código del producto |
| P3 | Versión, autoría y fechas del borrador: fuera del editor |

## Decisions

### D1. Barra superior en tres zonas, sin migas ni tema

- **Zonas:**
  - izquierda: el botón de navegación y el contexto de la empresa;
  - centro flexible: el acceso a la paleta;
  - derecha: el ambiente y la cuenta.
- **Huecos:** 8 px dentro de cada zona y 16 px entre zonas, para que se lea como composición y no
  como una lista de widgets.
- **Paleta:** campo «Buscar pantalla o acción…» de 18rem (288 px) desde `xl`, con icono y nombre
  accesible por debajo, centrado en su zona (spec «Paleta de comandos»).
- **Contexto de la empresa:** máximo 14rem (224 px) desde `md` y 10rem (160 px) por debajo, con
  `truncate`. El nombre completo va en `title` y en el nombre accesible (spec «Contexto de la empresa
  visible», «Nombre largo»).
- **Ambiente:** el indicador compacto de la zona derecha es la identidad global del ambiente (D21).
- **Alternativa descartada:** recortar las migas en la barra con elipsis. Mantiene la jerarquía de la
  página en el chrome global, compite con la empresa por el espacio y sigue fallando a 768 px.

### D2. Migas encima del título: el `PageHeader` en las rutas migradas y la fila compartida en las heredadas (PO-1)

- **Cambio:** las migas salen de la barra superior.
- **Dueño por ruta, decidido por el modelo de rutas y no por el historial:**
  - **Rutas migradas** (en este cambio, `/borradores/nuevo` y `/borradores/[id]`): el `PageHeader`
    pinta las migas encima del título. Las obtiene de la misma derivación
    (`breadcrumbsFor(resolveRoute(…))`, con la etiqueta del registro de `useBreadcrumbLabel`).
  - **Rutas heredadas:** la fila compartida del contenido (`AppBreadcrumbs` en `app-shell.tsx`) se
    muestra a todas las anchuras, sin el `md:hidden` actual, hasta que cada ruta se migre.
  - **Nunca las dos a la vez:** cada ruta interna del modelo (`INTERNAL_ROUTES`) declara
    `orientation: "page-header"` cuando la pantalla usa el `PageHeader` con migas. El shell no
    pinta la fila compartida en esas rutas.
  - Una prueba recorre el modelo y comprueba que ninguna ruta tiene las dos.
- **Forma:** una sola línea con `truncate` en la última miga, sin fila en los destinos de primer
  nivel.
- **Una sola orientación:** se retiran los 14 enlaces «volver» que repiten la primera miga.
  - Editores: factura, nota de crédito, nota de débito, retención, guía y liquidación.
  - Detalles: factura, nota de crédito, nota de débito, retención, guía, liquidación e ítem de
    inventario.
  - Es un cambio mecánico, sin tocar la composición de esas pantallas.
- **Alternativa descartada:** que el shell pinte siempre las migas. Funciona sin migrar, pero deja
  al `PageHeader` sin dueño de su orientación y obliga a cada migración a deshacerlo.

### D3. Gramática de `PageHeader` (componente existente, sin otro sistema de encabezado)

| Variante | Migas (D2) | Título | Descripción | Contexto | Acción principal | Secundarias |
| --- | --- | --- | --- | --- | --- | --- |
| Lista (Facturas) | No | `h1` | Opcional | Opcional | A la derecha del título | Junto a la principal |
| Editor (factura) | Sí, dentro del propio `PageHeader`, encima del título (D2) | `h1` | No | Estado del borrador: «Sin guardar», «Guardado» o «Cambios sin guardar» | No: las acciones viven en el resumen o en la barra de acciones (D11) | No |
| Configuración y lectura | Sí («Configuración › …»), en el `PageHeader` al migrarse | `h1` | Sí | Opcional | A la derecha, dentro del ancho de la función (D4) | Junto a la principal |

- **Ritmo vertical fijo:**
  - el bloque del título mide al menos 40 px, la altura del botón por defecto, con `items-center`;
  - así el título cae siempre en la misma y, haya o no acción, y desaparece la deriva de 2–4 px
    medida entre rutas;
  - 8 px entre la fila de migas y el título, y 24 px entre el encabezado y el contenido.
- **Alcance:** en este cambio solo se implementan las variantes de lista y de editor, porque son las
  que tienen consumidor. La de configuración queda escrita para la migración de esas pantallas.

### D4. Anchos de contenido por función

| Función | Token (`@theme` de `globals.css`) | Valor | Uso |
| --- | --- | --- | --- |
| Lectura | `--container-reading` (`max-w-reading`) | 42rem (672 px) | Texto y estado: Inicio, Ambiente |
| Formulario | `--container-form` (`max-w-form`) | 48rem (768 px) | Formularios de una columna: Empresa, Mi cuenta, diálogos largos |
| Espacio de trabajo | Sin máximo (`max-w-none`) | Ancho del contenido | Listas y editores con panel: Facturas, editor de facturas |

- **Por qué tokens de `--container-*`:** Tailwind 4 genera `max-w-reading` y `max-w-form` sin
  valores arbitrarios, compatibles con el lint estricto.
- **Mapeo de los usos actuales para su migración:**

  | Hoy | Destino |
  | --- | --- |
  | `max-w-xl` (Mi cuenta) | Formulario |
  | `max-w-2xl` (Inicio, Ambiente) | Lectura |
  | `max-w-3xl` (Configuración) | Formulario |
  | `max-w-5xl` (Portabilidad) | Lectura |

  Las pantallas heredadas conservan sus valores hasta su corte.

### D5. Distribución del formulario (`FormLayout`) y punto de apilado

- **Problema real:** el resumen fijo de 20rem (320 px) junto al formulario lo deja en 376 px a 1024 px
  con la barra expandida.
- **Decisión:** `FormLayout` es un contenedor con `@container`, con el formulario y un panel lateral
  opcional.
  - El panel mide 18rem (288 px), suficiente para «USD 1.250.000,00» con 16 px de relleno.
  - Panel al lado solo cuando el contenedor mide al menos `--container-form-rail` = 55rem (880 px):
    formulario mínimo de 36rem (576 px), más 24 px de hueco y el panel.
  - Por debajo, el panel se apila después del formulario.
- **Resultado medido sobre el contenedor actual:**

  | Anchura | Contenedor | Distribución | Formulario |
  | --- | --- | --- | --- |
  | 1440 | 1136 | al lado | 824 |
  | 1280 expandida | 976 | al lado | 664 |
  | 1024 colapsada | 928 | al lado | 616 |
  | 1024 expandida | 720 | apilado | — |
  | 768 | 464 | apilado | — |
  | 390 | 358 | apilado | — |

- **Por qué container query y no viewport:** el ancho útil cambia con la barra lateral, igual que en
  la tabla de Facturas (`--container-table-wide`).

### D6. Secciones (`FormSection`)

- **Problema real:** los tres bloques del editor (comprador y punto, productos, formas de pago) usan
  un `h2` suelto y solo el comprador va en caja.
- **Decisión:** `FormSection` aporta:
  - una cabecera con título (`h2`) y descripción opcional;
  - una acción local opcional a la derecha: «Agregar producto» y «Agregar forma de pago» pasan a la
    cabecera de su sección, como en `invoice-items.tsx` de la plantilla;
  - el contenido.
- **Agrupación:** separación entre secciones (32 px) y un filete superior fino, sin tarjetas
  pesadas. Las tarjetas quedan para el resumen, que es otra superficie.

### D7. Rejilla de campos (`FormGrid`) y filas alineadas (`FormFieldRow`)

- **`FormGrid`:** columnas con anchos semánticos por contenedor.
  - Comprador y punto de emisión: dos columnas desde 40rem de contenedor, una por debajo.
  - El punto de emisión ocupa su columna, no 792 px.
- **`FormFieldRow`:** fila de campos alineados con `grid-rows-subgrid` (Tailwind 4).
  - Cada campo existente (`FormField` de `form-dialog.tsx`, sin otro sistema de campo) ocupa tres
    filas: etiqueta, control y mensaje (ayuda o error).
  - Las acciones en línea se colocan en la fila del control.
  - El desfase de 20 px desaparece por estructura: la ayuda bajo el importe ya no empuja nada.
- **Fila de pago:**
  - forma de pago (fluida, mínimo 14rem), importe (10rem) y quitar (2.5rem, en la fila del control);
  - por debajo de 32rem de contenedor: la forma de pago ocupa la línea entera y debajo van el
    importe y su «Quitar»;
  - todo dentro de un `fieldset` con la leyenda «Forma de pago N», así el quitar queda asociado a su
    fila (spec «Formas de pago en el editor»).
- **Por qué no `ui/field.tsx` de la plantilla:** duplicaría el campo existente (`FormField`) y
  `component-system.md` pide una sola implementación. De la plantilla se toma solo la composición.

### D8. Panel de resumen (`StickySummaryPanel`) y acciones (`StickyFormActions`)

- **`StickySummaryPanel`:**
  - al lado (D5): `sticky` bajo la barra superior, que sigue a la vista;
  - apilado: una sección más, al final del formulario.
- **Contenido veraz** (spec «Totales veraces», PO-2):
  1. **Estado del borrador:** «Sin guardar», «Guardado» o «Cambios sin guardar», en texto (D16).
  2. **Totales**, siempre del servidor y nunca ceros ni cálculos del navegador:
     - **A. Borrador nuevo sin guardar:** sin importes; «Guarda el borrador para obtener los
       totales calculados por el servidor.»
     - **B. Guardado sin cambios:** los últimos del servidor: subtotal sin impuestos, descuento,
       cada IVA y total.
     - **C. Guardado con cambios:** el bloque se rotula «Totales del último guardado», se atenúa
       y lleva «Guarda para recalcularlos». Ningún importe aparece como vigente.
     - **D. Tras un guardado correcto:** la respuesta nueva del servidor sustituye al bloque (el
       editor se monta con la versión nueva) y el rótulo desaparece. Un guardado fallido deja el
       bloque en C.
     - **Con `totals` nulo:** «Los totales aparecen cuando todas las líneas se pueden calcular».
  3. «Vista previa del dd/mm/aaaa, sin validez fiscal», en P2.
  4. **«Antes de emitir»:** los problemas generales del servidor.
  5. **Aviso de ambiente junto a la emisión (D21):** el aviso contextual, inmediatamente encima
     de las acciones.
- **`StickyFormActions`:** la acción principal, la secundaria y el motivo de la acción no
  disponible, escrito y asociado con `aria-describedby`.
  - Al lado, al pie del panel.
  - Apilado, en una barra fija al pie del área de contenido (`sticky bottom-0`, borde superior),
    que deja las acciones alcanzables sin volver arriba.
  - El contenido reserva su alto (`scroll-padding-bottom`) para que el foco nunca quede tapado.
- **Alternativa descartada:** mantener un panel lateral de 320 px que solo dice «Guarda el borrador
  para calcular…». Ocupa espacio sin información.

### D9. Botón deshabilitado neutro (sistema)

- **Regla:**
  - `primary`, `secondary` y `destructive` deshabilitados pasan a `bg-muted text-muted-foreground`,
    sin sombra ni color de variante, con `opacity-100`;
  - `outline`, `ghost` y `link` deshabilitados pasan a `text-muted-foreground`, con el borde
    atenuado;
  - `aria-disabled` igual;
  - el estado pendiente de `AsyncButton` (`aria-busy`) se excluye y conserva el color de su
    variante con el indicador, porque una acción en curso no es una acción no disponible.
- **Legibilidad:** el texto deshabilitado sigue legible (al menos 3:1 sobre `muted`), con una prueba
  de tokens.
- **Modo oscuro:** `outline` conserva el fondo transparente (hoy parece un bloque gris relleno), para
  que la jerarquía no se aplane.
- **Impacto:** todos los botones deshabilitados del producto se ven neutros. Es intencional y es el
  hallazgo V3 de la auditoría. Las capturas de `test:visual` que muestren un deshabilitado cambian y
  se revisan a mano.

### D10. Selección neutra (sistema, con impacto listado)

- **`ChipGroup`:** la opción elegida pasa a borde en `foreground`, superficie `muted`, texto en
  `foreground` y peso medio. Se reconoce por forma y peso, no solo por color, y deja de competir con
  la acción principal.
  - Afecta a las 10 listas heredadas de Context.
  - Solo cambia el aspecto: ni estructura ni filtros.
- **`SegmentedControl`:** la opción elegida pasa a una pieza elevada `bg-background` con sombra
  dentro de la pista `muted`, como el `toggle-group` de la plantilla.
  - Afecta a los 11 consumidores de Context, entre ellos el ambiente de Secuenciales y Bien/Servicio
    del diálogo de producto.
- **Migración:** cambia el aspecto de pantallas heredadas sin migrarlas. Las capturas afectadas se
  revisan a mano y la matriz de revisión incluye una lista heredada (Productos) y un formulario con
  control segmentado (diálogo de producto).

### D11. Estado vacío sin segunda principal

- **Regla:** si el encabezado ya ofrece la acción, el estado vacío la ofrece en `outline`.
- **Dónde se aplica:** en las cinco listas de Context, el botón del estado vacío deja de ser el mismo
  elemento del encabezado y pasa a la variante secundaria. Facturas y Borradores ya lo cumplen.

### D12. Destino actual, migas y creación rápida de las rutas de factura (PO-1, aprobada)

- **Cambio:** en `INTERNAL_ROUTES`, `/borradores/nuevo` y `/borradores/[id]` pasan a tener a
  Facturas como destino.
- **Migas resultantes:** «Facturas › Nueva factura» y «Facturas › Borrador de factura».
- **Por qué:** la regla depende de la ruta, no del historial, y el primer guardado (que reemplaza
  `/borradores/nuevo` por `/borradores/{id}`) ya no cambia el destino ni las migas en mitad del
  flujo.
- **Lo que no cambia:** Borradores de facturas sigue en Ventas como lista para retomar borradores, y
  las direcciones no cambian (sin enlaces rotos).
- **Alternativa descartada por el propietario:** nueva factura en Facturas y borrador existente en
  Borradores. Cambiaba el destino en mitad del flujo, al primer guardado.

### D13. Editor: composición de cada sección

- **Comprador y punto de emisión** (`FormSection` + `FormGrid`, dos columnas):
  - «Comprador» se presenta como un campo:
    - una caja de la altura de un control con el nombre y la identificación;
    - la insignia «Consumidor final» si aplica;
    - el botón «Elegir comprador» o «Cambiar comprador» en la misma fila;
  - el punto de emisión va a su lado, con su ancho de columna.
- **Productos:**
  - lista de líneas con una fila de encabezados visible desde 40rem de contenedor, inspirada en la
    rejilla de `invoice-items.tsx`: producto (nombre y código), cantidad (6rem), precio unitario
    (solo lectura), descuento (7rem), base imponible y quitar;
  - la base imponible es la del servidor (`preview.lines[].taxableBase`), solo con el borrador
    guardado y sin cambios; si no, «—» con el texto «se calcula al guardar»;
  - por debajo de 40rem, cada línea pasa a dos filas: identidad y quitar; luego cantidad, precio y
    descuento;
  - agregar un producto deja el foco en la cantidad de la línea nueva, para cargar rápido con el
    teclado;
  - estado vacío en línea, con «Agregar producto» en la cabecera de la sección;
  - los problemas y el aviso de existencias van bajo su línea, como hoy.
- **Formas de pago:**
  - las filas de D7;
  - la ayuda «Déjalo vacío para usar el total de la factura» con una forma de pago;
  - con varias, la ayuda de sección «Cada forma de pago lleva su importe y deben sumar el total»;
  - las reglas no cambian, y quitar la última fila sigue permitido como hoy.

### D14. Guardar y emitir según el código y el servidor reales

Cinco preguntas independientes deciden las acciones. Ninguna es un estado nuevo: todas existen hoy
en el código.

| Pregunta | Fuente real |
| --- | --- |
| ¿Hay un guardado en curso? | `save.isPending` |
| ¿Se puede guardar? | Siempre que no haya un guardado en curso y el usuario tenga `invoices.draft` (la ruta ya lo exige). Un borrador incompleto o con problemas se guarda. Lo que el cliente o el servidor rechazan se explica al pulsar, junto al dato o con su recuperación, sin deshabilitar el botón de antemano. |
| ¿La versión vigente está guardada? | `draft !== null && !isDirty` |
| ¿Se cumplen los requisitos de la emisión? | `preview.issues.length === 0` en la versión guardada; el servidor lo vuelve a evaluar al emitir |
| ¿Puede emitir el usuario? | `invoices.emit` |

| Situación | Principal | Secundaria | No disponible, con su motivo | Llamada |
| --- | --- | --- | --- | --- |
| Nuevo, sin guardar | Guardar borrador | — | Emitir: «Guarda el borrador para emitirlo.» | `POST /invoices/drafts` |
| Guardado, incompleto o con problemas, sin cambios | Ninguna destacada (se corrige un dato) | Guardar borrador (vuelve a evaluar a la fecha) | Emitir: «Resuelve los problemas del resumen antes de emitir.» o lo que falta | `PUT /invoices/drafts/{id}` al guardar |
| Guardado con cambios | Guardar borrador | — | Emitir: «Guarda los cambios antes de emitir.» | `PUT /invoices/drafts/{id}` |
| Guardado en curso | Guardar, en curso (`aria-busy`) | — | Emitir, y el formulario sin edición hasta la respuesta | En curso |
| Listo: guardado, sin cambios, sin problemas, con `invoices.emit` | Emitir factura | Guardar borrador | — | Abre la confirmación |
| Emitiendo | Confirmar, en curso | Cancelar, deshabilitado mientras espera | — | `POST /invoices` con `Idempotency-Key` |
| Sin `invoices.emit` | Guardar borrador | — | Emitir, ausente | — |
| Guardado rechazado | Recuperación: «Recargar borrador» (`INVOICE_DRAFT_CHANGED`) o «Ver facturas» (`INVOICE_DRAFT_ALREADY_EMITTED`); el resto, junto al dato | Guardar (lo escrito se conserva) | — | — |
| Emisión rechazada por el servidor | — | — | Emitir, hasta corregir: el motivo y los problemas actuales al volver a cargar el borrador | `GET /invoices/drafts/{id}` |

- **Guardar nunca se deshabilita por los requisitos de la emisión.** Solo espera mientras hay un
  guardado en curso.
- **Formulario sin edición mientras se guarda** (derivada de PO-3): los campos se marcan como solo
  lectura con `aria-busy`. Así lo persistido es exactamente lo que se ve, y montar la versión nueva
  no descarta nada escrito durante la espera.
- **Ni estados ni reglas nuevos.** La máquina de estados fiscal y las reglas del servidor no
  cambian.

### D15. Confirmación de la emisión

- **Se conservan:** la intención explícita, la irreversibilidad, el ambiente, el comprador, el total
  del servidor, las líneas, el aviso de consumidor final y la `Idempotency-Key` por versión.
- **Se añade:** el aviso contextual de D21 dentro de la confirmación: «Pruebas · esta factura no
  tendrá validez tributaria», con icono y texto. Con el ambiente sin confirmar, «No pudimos
  confirmar el ambiente».
- **No cambia:** la máquina de estados ni las precondiciones del servidor.

### D16. Cambios sin guardar (PO-3, aprobada)

- **Indicador:** el contexto del `PageHeader` del editor (D3) y el estado del resumen (D8) dicen
  «Cambios sin guardar» mientras `isDirty`.
- **Aviso al salir:** un `beforeunload` registrado solo mientras hay cambios avisa al cerrar o
  recargar la pestaña. Se retira en cuanto el estado queda limpio.
- **Cuándo se limpia:** solo cuando el servidor confirma el guardado. El editor se monta con la
  versión devuelta, que es la que se ve gracias al formulario sin edición durante el guardado (D14).
  - Un guardado fallido conserva los valores, el indicador y el aviso.
  - La recuperación de `INVOICE_DRAFT_CHANGED` («Recargar borrador») descarta los cambios solo
    cuando el operador la elige.
- **Navegación interna:** no se intercepta. El App Router de Next.js no ofrece un bloqueo fiable,
  y un bloqueo a medias es peor que ninguno. Queda como brecha documentada.

### D17. Revisión visual como ojos del agente (`test:visual:review`)

- **Comando:** `corepack pnpm --filter @facturador/frontend test:visual:review`.
  - Es un proyecto `review` de Playwright en `playwright.config.ts`, fuera de `test:visual` y de
    `verify`.
  - Sin aserciones de capturas, `workers: 1`, sobre el mismo build y el mismo harness determinista
    (`visual/fixtures.ts`).
- **Salida:** `frontend/.review/visual/<etiqueta>/`, ignorada por git (`.gitignore`).
  - La etiqueta sale de `REVIEW_LABEL`, o de la fecha y el commit corto.
  - `screenshots/<ruta>-<estado>-<anchura>-<tema>.png`.
  - `geometry/<misma clave>.json`, medido en el navegador:
    - cajas de la barra superior y sus huecos;
    - encabezado de página y migas, y la y del título;
    - acciones principales con su estado;
    - etiqueta y control de cada campo, con su hueco;
    - superficies;
    - desbordes de la página y de las tablas.
  - `contact-sheets/<grupo>.html`, hojas por grupo (shell, editor, listas, configuración, móvil,
    oscuro), y su PNG, sacado con el mismo navegador para abrir una sola imagen.
  - `manifest.json`: ruta, estado, anchura, tema, archivo, commit, build y fecha.
- **Antes y después:** con `REVIEW_COMPARE_WITH=<etiqueta>`, el comando genera además
  `contact-sheets/compare-<antes>.html` (y su PNG) con cada captura junto a su par.
- **Fallos:** termina con código distinto de cero si:
  - falla una navegación o una captura;
  - el navegador se cae;
  - un estado no alcanza su condición de listo;
  - hay un `pageerror`;
  - hay una petición a otro origen;
  - hay una ruta de la API sin datos de prueba.

  Nunca falla por estética: la composición la juzgan el agente y las personas.
- **Sin dependencias nuevas:** solo Playwright y las API del navegador y de Node.
- **Solo harness:** el comando nunca usa el backend ni emite.
- **Despliegue local de revisión:** es un procedimiento manual documentado.
  - Antes de abrir el navegador, exige leer la configuración real del backend en ejecución
    (`docker inspect`) y comprobar `SRI_TRANSMISSION_ENABLED=0`.
  - Si no puede establecerse, la revisión se detiene.
  - Nunca se deduce del valor por defecto, y nunca se emite de verdad durante la revisión.

### D18. Matriz de revisión de este cambio

- **Pantallas y estados:**
  - Facturas (poblada, vacía, vista de atención, menú de fila);
  - Nueva factura (vacía, con comprador y líneas sin guardar);
  - borrador existente (listo, con problemas, con cambios sin guardar, totales no calculables,
    confirmación abierta, empresa en Producción, ambiente desconocido);
  - una configuración (Empresa) y su miga;
  - una lista heredada (Productos, por la selección neutra);
  - el diálogo de producto (control segmentado);
  - un editor heredado que emite (nota de crédito), con el aviso de Pruebas junto a «Emitir» y en su
    confirmación;
  - la barra superior en Pruebas (con la explicación del indicador abierta), en Producción y con el
    ambiente sin confirmar;
  - el panel móvil.
- **Anchuras:** 1440×900, 1280×800, 1024×768 expandida y colapsada, 768×900, 390×844 y 720×450 con
  escala 2 (equivalente a 200 % de zoom).
- **Temas:** claro en todas las capturas y oscuro en Facturas, el editor listo y Productos.

### D19. Definición de Hecho del frontend

En un cambio visual material, el agente SHALL:
- generar la matriz antes y después;
- abrir y mirar las hojas y las capturas;
- medir cuando haga falta;
- escribir una valoración de composición: orden de atención, jerarquía, densidad, alineación,
  equilibrio, jerarquía de acciones, anchuras, claro y oscuro, fatiga diaria y claridad para la
  primera vez.

Generar las imágenes sin mirarlas, o pasar `test:visual`, no basta. Se escribe en
`definition-of-done.md`, `testing.md` y `change-lifecycle.md`.

### D20. Aceptación visual del apply

- **Hallazgos:**
  - V4 de la barra superior cerrado;
  - V4 de formularios cerrado para el editor;
  - 0 V4/V5 y 0 V3 nuevos en la base y en el editor.
- **Revisión UX:** operador diario, primera vez y usuario ocasional en 4/5 o más.
- **Aparte:** los S3 que dependan del backend (`SERVER_TOTAL_PREVIEW_GAP`) se informan por separado.

### D21. Ambiente: identidad global compacta y aviso contextual (aprobada)

- **Global:** el indicador de la zona derecha de la barra es el aviso persistente del ambiente.

  | Ambiente | Texto visible | Icono y tono | Nombre accesible | Al enfocarlo, señalarlo o tocarlo |
  | --- | --- | --- | --- | --- |
  | Pruebas | «Pruebas» | Advertencia, tono de ambiente | «Ambiente de Pruebas: los comprobantes no tienen validez tributaria» | Una explicación breve en un popover: sin validez tributaria, y que un administrador cambia el ambiente en Configuración › Ambiente |
  | Producción | «Producción» | Icono de contexto, `emphasis` neutro, nunca éxito | «Ambiente de Producción» | — |
  | Sin confirmar | «Sin confirmar» | Advertencia | «No pudimos confirmar el ambiente» | Explica que no se pudo confirmar si los comprobantes tienen validez tributaria |

  - Es un botón con popover, no un tooltip, para que funcione con el tacto y el teclado.
  - No se puede cerrar ni ocultar.
  - RF-004 y RF-005 se cumplen con este indicador: es inequívoco, persistente y una advertencia.
- **Se retira** `EnvironmentNotice` (la franja de ancho completo). `NoticeStrip` sigue para el
  vencimiento de la firma.
- **Contextual:** un componente compartido, `EmissionEnvironmentNotice` en `features/company`, con
  icono y texto, que nunca comunica solo con color.
  - Pruebas: «Pruebas · este comprobante no tendrá validez tributaria», con la palabra del tipo:
    factura, nota de crédito y demás.
  - Sin confirmar: «No pudimos confirmar el ambiente».
  - Producción: nada junto a la acción; en la confirmación, «Producción» como contexto.
- **Dónde va:**
  - en el editor de facturas, encima de las acciones (D8) y dentro de la confirmación (D15);
  - en los editores de nota de crédito, nota de débito, retención, guía y liquidación, junto a su
    «Emitir» y dentro de su confirmación, insertado sin recomponer esas pantallas (spec
    `document-emission`, «Aviso de Pruebas al emitir»).
- **Por qué:** la advertencia está donde se toma la decisión fiscal, y deja de cansar en cada
  pantalla de lectura.
- **Alternativa descartada:** conservar la franja global y añadir el aviso contextual. Duplica la
  señal, que es el hallazgo de fatiga de la auditoría.

### D22. Revisión visual antes de tocar el código

- **Antes:** en el apply, el grupo 1 se completa y se commitea antes de cualquier cambio de código
  de ejecución:
  - la herramienta;
  - las capturas «antes»;
  - abrirlas y mirarlas, junto con las hojas y la geometría;
  - `review-antes.md` con hallazgos concretos.
- **Después:** al terminar se captura la misma matriz, se compara y se escribe `review-despues.md`
  con conclusiones basadas en la evidencia.
- **Qué no basta:** generar capturas, o pasar `test:visual`. La valoración cubre jerarquía
  visual, densidad, alineación, prioridad de acciones, anchuras, claro y oscuro, y uso operativo.

## Trazabilidad de la plantilla

Origen relativo a `../template-shadcn-premium/src/app/(main)/dashboard/` (MIT de «Studio Admin»);
avisos en `frontend/THIRD_PARTY_NOTICES.md`.

| Origen | Destino | Clase | Qué se toma |
| --- | --- | --- | --- |
| `invoice/_components/invoice-items.tsx` | Líneas del editor | Visual portado | Fila de encabezados en rejilla, acción «Agregar» en la cabecera de la sección (sin arrastrar ni total de línea del cliente) |
| `invoice/_components/client-selector.tsx` | Campo «Comprador» | Visual portado | Selección con etiqueta pequeña y control a todo el ancho de su columna |
| `invoice/_components/invoice-adjustments.tsx` | `StickySummaryPanel` | Visual portado | Filas de importe con columna numérica alineada a la derecha |
| `invoice/_components/invoice-details.tsx` | `FormGrid` | Visual portado | Dos columnas por contenedor en datos de cabecera |
| `src/components/ui/toggle-group.tsx` (variante por defecto) | `SegmentedControl` | Visual portado | Pieza elevada dentro de una pista neutra |

## Brechas del backend (fuera de este cambio)

| Brecha | Efecto | Mientras tanto |
| --- | --- | --- |
| `SERVER_TOTAL_PREVIEW_GAP`: no hay vista previa de totales sin guardar (aceptada en PO-2) | Tras editar no se ven totales vigentes hasta guardar | Resumen veraz A–D (D8) y guardar como acción principal (D14) |
| `UNSAVED_CHANGES_GAP`, parte de navegación interna | Un enlace interno con cambios sin guardar los pierde | Indicador visible y aviso al cerrar o recargar (D16) |

## Operaciones sensibles

- **Emisión:** sin cambios en el tenant (empresa de la sesión), la propiedad (borrador de la empresa),
  la idempotencia (`Idempotency-Key` por versión), las restricciones (versión y problemas), la
  auditoría ni las vías de fuga (un borrador ajeno es 404, «El borrador no existe»).
- **Guardar borrador:** sin cambios en `expectedVersion` ni en el conflicto de versión.
- **Ninguna operación nueva.** La revisión visual no llama a la API real ni al SRI.

## Risks / Trade-offs

- **[El botón deshabilitado y la selección neutra cambian pantallas heredadas]** → Es intencional y
  queda listado (D9, D10). Las capturas afectadas se revisan una por una antes de aceptarlas.
- **[Retirar los enlaces «volver» en pantallas fuera del alcance]** → Cambio mecánico, con las migas
  como sustituto exacto en la misma posición. Sus pruebas se ajustan para buscar la miga.
- **[PO-1 cambia el destino de las rutas de factura]** → Lo decide el propietario antes del apply. Se
  actualizan la prueba de la creación rápida y la de `ux.spec.ts`.
- **[Barra de acciones fija al pie tapa contenido o foco]** → Reserva de alto y comprobación de foco
  en la matriz de revisión.
- **[Todas las capturas del shell cambian]** → La barra superior sale distinta y desaparece la
  franja en las 26 capturas. Se revisan las diferencias y se acepta solo lo esperado (barra, migas,
  ambiente y botones).
- **[Retirar la franja reduce la advertencia en pantallas sin emisión]** → El indicador compacto
  sigue en todas las pantallas como advertencia persistente con su explicación, y el aviso contextual
  aparece donde se emite, en los seis editores. Las pruebas de `taxpayer-setup` y del shell se
  actualizan a la forma compacta.
- **[Tocar los cinco editores heredados para el aviso contextual]** → Inserción de un componente
  junto a «Emitir» y en la confirmación, sin cambiar su composición ni su comportamiento. Una prueba
  por editor.
- **[El último total guardado se confunde con el vigente]** → Se rotula como «Último total guardado»,
  se atenúa y se muestra solo como referencia junto a «Guarda para recalcular».

## Migration Plan

- **Rama y orden:** todo en `redesign-frontend`, con un commit por grupo de tareas:
  1. capturas «antes» y la medición previa;
  2. la herramienta de revisión;
  3. el sistema (botón, selección, estado vacío, anchos);
  4. el shell (barra, migas, tema, ambiente compacto y aviso contextual, rutas de factura);
  5. `PageHeader`;
  6. los primitivos de formulario;
  7. el editor;
  8. los documentos y la verificación.
- **Reversión:** cada grupo se revierte por separado. Sin migraciones ni cambios de API.
- **Cierre:** sin despliegue. Ni archivo, ni fusión en `main`, ni subida sin la revisión del
  propietario. El CI alojado sigue bloqueado: `verify` en sala limpia.
