# Tasks

**Reglas para todos los grupos:**
- **Commits.** Un commit por grupo en `redesign-frontend`, sin push, sin archivar y sin publicar en
  `main`.
- **SRI.** Ningún grupo contacta al SRI de Pruebas ni de Producción. `SRI_TRANSMISSION_ENABLED`
  sigue desactivado. Este cambio es solo de interfaz.
- **Backend.** Sin cambios en el backend, la API, la base de datos ni la lógica fiscal. TanStack
  Table sigue en 8.21.3 y no entran dependencias de ejecución nuevas.
- **Código de la plantilla.** Se copia desde `../template-shadcn-premium/` (fuera del repositorio),
  con su fila en `frontend/THIRD_PARTY_NOTICES.md`, y nunca se versiona la plantilla.
- **Pantallas fuera del alcance.** Conservan su estructura. La única excepción es la insignia de
  estado de los comprobantes (decisión PO-1 del design).
- **Pruebas existentes.** Ninguna prueba de comportamiento se borra. Cada aserción que cambia queda
  explicada en el commit que la cambia.
- **Decisiones del propietario** (2026-10-14, registradas en el design): PO-1, PO-2, PO-4 y PO-5
  aprobadas. PO-3 modificada: en la fila, solo «Ver factura» y «Copiar número».

## 1. Arnés y medición previa

- [x] 1.1 Hacer que los datos del harness (`frontend/visual/fixtures.ts`) respondan según los
  parámetros de consulta de `/api/v1/invoices`:
  - `attention`, `state`, `search`, `page` y `pageSize`;
  - un conjunto determinista que cubra los ocho estados, una transmisión detenida, un total de
    cuatro cifras y facturas de Pruebas para una empresa en Producción;
  - un escenario sin facturas.

  Verificar que `corepack pnpm test:visual` sigue en verde sin cambiar ninguna captura.
- [x] 1.2 Medir `/facturas` antes del cambio con `corepack pnpm test:visual:bundle` (JavaScript, CSS
  y fuente) y guardar el «antes» en `docs/quality/benchmarks/frontend-facturas-<fecha>.{md,json}`.

  Verificar que el informe nombra el commit, el entorno y los bytes por tipo.

## 2. Primitivos derivados de la plantilla

- [x] 2.1 Derivar `components/ui/table.tsx` de `src/components/ui/table.tsx` de la plantilla, con
  comentario de procedencia y su fila en `THIRD_PARTY_NOTICES.md`.

  Verificar con una prueba unitaria la semántica (`table`, `caption`, `th` con `scope`) y el
  contenedor con desplazamiento horizontal.
- [x] 2.2 Derivar `components/ui/toggle.tsx` y `components/ui/toggle-group.tsx` (D3):
  - sin el atributo `style` de `--gap`, que la CSP bloquea; la separación va por clase;
  - con los estados de Radix 1.6.7;
  - con sus filas en `THIRD_PARTY_NOTICES.md`.

  Verificar con pruebas unitarias el radiogroup, las flechas y la selección única, y que el HTML
  del servidor no lleva atributos `style`.

## 3. Estado de la lista en la URL

- [x] 3.1 Crear `hooks/use-list-url-state.ts` (D9):
  - un esquema de parámetros con valores por defecto y alias;
  - cambios acumulados sobre el último pedido (la corrección de `archive/documents-screen.tsx`);
  - `router.replace` sin desplazar;
  - volver a la primera página al cambiar un filtro;
  - ir a la última página si la pedida queda fuera de rango.

  Verificar con pruebas unitarias:
  - dos cambios rápidos seguidos se aplican los dos;
  - el alias `estado=atencion` pasa a `vista=atencion`;
  - cambiar un filtro borra `pagina`;
  - una página fuera de rango va a la última con facturas.
- [x] 3.2 Marcar como resuelta, en `docs/quality/technical-debt.md`, la carrera del estado en la
  URL para las pantallas que usan el hook, y dejar pendientes las que aún no lo usan.

  Verificar que la fila nombra el hook y las pantallas pendientes.

## 4. Base de tabla compartida

- [x] 4.1 Crear en `components/data-table/` la tabla y su paginación (D5, D14), en TanStack 8.21.3
  (D2):
  - **`data-table.tsx`:** columnas tipadas, `rowCount`, paginación manual, la etiqueta accesible
    (`caption`), las filas esqueleto que conservan las columnas, los estados vacío y de error dentro
    de la superficie, `aria-busy` al recargar, y `onRowOpen`, que ignora los clics en elementos
    interactivos, las selecciones de texto y los modificadores;
  - **`data-table-pagination.tsx`:** «Mostrando A-B de N», «Filas por página», los botones
    primera, anterior, siguiente y última con su nombre, y «Página X de Y». No muestra cifras al
    cargar ni sin filas.

  Verificar con pruebas unitarias cada estado, el pie sin «0 de 0» y el comportamiento de
  `onRowOpen`.
- [x] 4.2 Crear la barra de herramientas y sus controles:
  - **`data-table-toolbar.tsx`:** la anatomía de D5;
  - **`data-table-search.tsx`:** etiqueta accesible, espera configurable, `maxLength` y «Limpiar
    búsqueda»;
  - **`data-table-views.tsx`:** sobre `ui/toggle-group`, con selección neutra y un conteo
    accesible opcional;
  - **`data-table-option-filter.tsx`:** menú de opción única con «Quitar», sobre
    `ui/dropdown-menu`;
  - **`data-table-active-filters.tsx`:** filtros activos removibles, y «Limpiar filtros» solo si
    hay alguno.

  Verificar con pruebas unitarias los roles, la selección, la espera de la búsqueda, quitar un
  filtro y que «Limpiar filtros» no aparece sin filtros.
- [x] 4.3 Crear `row-actions-menu.tsx`: un botón de icono con nombre accesible propio y su ayuda,
  que abre un menú alineado al final, recibe elementos ya filtrados por el módulo y devuelve el foco
  al cerrar.

  Verificar con una prueba unitaria el nombre accesible, los elementos y la devolución del foco.
- [x] 4.4 Documentar la base:
  - en `docs/architecture/data-tables.md`: el contrato, las dos distribuciones por ancho de
    contenedor y su elección por tabla, y los estados;
  - en `component-system.md`: las piezas y la convivencia transitoria con `AppDataTable`;
  - en `frontend.md`: los contratos;
  - en `technical-debt.md`: `AppDataTable`, `ChipGroup`, `SearchInput` y `TablePagination`
    heredados, con su criterio de salida.

  Verificar que ningún documento describe a la vez dos contratos sin decir cuál es el heredado.

## 5. Encabezado de página

- [x] 5.1 Crear `components/layout/page-header.tsx` (D4): título como `h1`, descripción y contexto
  opcionales, una única ranura `primaryAction` y acciones secundarias, sin migas.

  Verificar con pruebas unitarias que hay un solo `h1` y como mucho un botón principal, y la
  disposición en pantallas estrechas.
- [x] 5.2 Documentar `PageHeader` en `component-system.md` y en `interface-design.md` (encabezado de
  módulo).

  Verificar que la documentación remite a una sola acción principal por pantalla.

## 6. Presentación del estado de los comprobantes

- [x] 6.1 Crear `features/documents/document-status-badge.tsx` (D12) sobre `ui/badge`:
  - el mapeo aprobado de texto, variante e icono;
  - el botón de ayuda de «Verificando con el SRI» con «El envío pudo haber llegado. No emitas esta
    venta nuevamente.»;
  - la insignia «Transmisión detenida»;
  - la marca discreta de «Requiere atención», calculada con `INVOICE_ATTENTION_STATES` o
    `transmissionStopped`.

  Verificar con pruebas unitarias:
  - la variante de cada estado;
  - SEND_UNKNOWN nunca destructivo y con su ayuda accesible;
  - MANUAL_REVIEW como advertencia, distinto de Devuelto y No autorizado;
  - siempre texto e icono.
- [x] 6.2 Según PO-1 (recomendado), convertir `StateCell` en una fachada que delega en
  `DocumentStatusBadge`, para que las pantallas de comprobantes que lo usan muestren el mismo mapeo
  sin cambiar su estructura. Actualizar las aserciones de estado que cambian
  (`invoice-transmission.test.tsx` y las de otras pantallas de comprobantes), explicándolas en el
  commit.

  Verificar con `corepack pnpm --filter @facturador/frontend test` que pasa todo.
- [x] 6.3 Actualizar `technical-debt.md`:
  - según PO-1, dar por resuelto el mapeo de colores de SEND_UNKNOWN, RESERVED y MANUAL_REVIEW;
  - conservar como pendiente que Producción se muestre en verde de éxito en la pantalla Ambiente,
    que va por `StatusBadge` y no por los estados de comprobantes;
  - conservar la guía tras un resultado fiscal.

  Verificar que las filas reflejan lo que queda.

## 7. Facturas sobre la base

- [x] 7.1 Componer `features/invoices/invoices-screen.tsx` con `PageHeader` («Facturas», «Nueva
  factura» solo con `invoices.draft`, a la pantalla de nueva factura existente) y `useListUrlState`:
  - vistas «Todas» y «Requiere atención» con su conteo, mediante una consulta
    `attention=true&pageSize=1` con clave propia, que no se repite por página, filas, estado ni
    búsqueda (PO-2);
  - filtro «Estado» con los ocho estados y el mapeo de D6, incluidos los alias;
  - búsqueda «Número, comprador o identificación».

  Verificar con pruebas de la pantalla:
  - la acción principal con y sin permiso;
  - cada vista y cada estado hacia su parámetro de la API;
  - el conteo;
  - la búsqueda con su espera;
  - restaurar desde la URL;
  - «Limpiar filtros» solo con filtros.
- [x] 7.2 Definir las columnas de D10:
  - número y fecha, estado, comprador e identificación, total y acciones;
  - número y total sin partir, `tabular-nums`, sin encabezados ordenables;
  - la marca de ambiente para las facturas de un ambiente distinto del vigente (PO-4): «Pruebas ·
    sin validez tributaria» o «Producción» neutro, y las de Pruebas si el vigente es desconocido;
  - el clic de fila;
  - las acciones de la fila (PO-3): solo «Ver factura» y «Copiar número».

  Verificar con pruebas de la pantalla:
  - el enlace y el clic de fila, sin paradas de teclado duplicadas;
  - las dos acciones de la fila y la confirmación de copia;
  - que no hay «Descargar RIDE», notas ni acciones fiscales;
  - las marcas de ambiente y de atención;
  - que la tabla no pide nada por fila.
- [x] 7.3 Implementar los estados (D14) y las dos distribuciones (D15):
  - primera carga, recarga, vacío inicial, vacío por filtros, error y sin permiso;
  - la distribución amplia desde `@xl` del contenedor;
  - la compacta, con la identidad en líneas, el total y la fecha;
  - el desplazamiento solo dentro de la tabla.

  Verificar con pruebas de la pantalla cada estado sin paginación vacía, y que las pruebas
  existentes de Facturas siguen cubriendo sus comportamientos, con las aserciones cambiadas
  explicadas.
- [ ] 7.4 Ampliar `scripts/check-web-security-policy.ts` si el flujo de Facturas cambia algún nombre
  que use (abrir la lista y una factura), sin debilitar la política.

  Verificar con `corepack pnpm check:web-security-policy` (40 comprobaciones o las vigentes) en
  verde.

## 8. Lint escalonado y documentación de la pantalla

- [x] 8.1 Añadir a la lista estricta de `frontend/eslint.config.js` (D19):
  - `components/layout/**`;
  - los archivos nuevos de `components/data-table/`;
  - `features/documents/**`;
  - `hooks/use-list-url-state.ts`;
  - `features/invoices/invoices-screen.tsx`.

  Verificar con `corepack pnpm lint`, y con una prueba de lint escalonado, que la pantalla migrada
  no importa `@/components/states`, `radix-ui` ni tamaños `legacy-*`.
- [x] 8.2 Registrar las brechas del backend del design en `technical-debt.md`, y documentar Facturas
  en `fiscal-emission.md` o en el documento de la pantalla (vistas, estados, acciones y marca de
  ambiente).

  Verificar que cada brecha nombra su efecto y su paliativo actual.

## 9. Navegador, capturas y carga

- [ ] 9.1 Añadir al harness `visual/shell/facturas.spec.ts`:
  - **teclado:** acción principal, búsqueda, vistas con flechas, filtro, número y menú de fila con
    devolución del foco;
  - **axe:** claro, oscuro, vista de atención y móvil;
  - **anchuras:** a 1024 px con la barra expandida, el número y el total en una línea, medido por
    altura; a 390 px, número, comprador, estado y total dentro de la tabla, sin desbordar la
    página; a 320 px, desplazamiento solo de la tabla.

  Verificar que la spec pasa.
- [ ] 9.2 Capturar el conjunto canónico de Facturas (D17):
  - escritorio claro y oscuro con datos;
  - vista de atención;
  - vacío inicial y vacío por filtros;
  - carga y error;
  - 1024 px con la marca de ambiente;
  - 390 px.

  Sustituir la captura «lista heredada de facturas dentro del shell». Revisar a mano las diferencias
  de las capturas del shell tomadas sobre `/facturas` y actualizar solo las afectadas.

  Verificar que `corepack pnpm test:visual` pasa y que ninguna captura ajena cambió.
- [ ] 9.3 Medir de nuevo `/facturas` con `test:visual:bundle`, completar el «después» del benchmark y
  explicar cada diferencia.

  Verificar que no entra ninguna dependencia nueva y que el conteo no se repite por filtro.
- [ ] 9.4 Documentar en `docs/quality/testing.md` las capturas y las comprobaciones nuevas.

  Verificar que el recuento de capturas coincide con el harness.

## 10. Integración final

- [ ] 10.1 Revisar la pantalla con `docs/quality/frontend-checklist.md`:
  - 320, 768, 1024 y 1440 px, y zoom al 200 %;
  - teclado;
  - claro y oscuro;
  - administrador y operador;
  - Pruebas y Producción.

  Verificar que la lista queda marcada.
- [ ] 10.2 Hacer la revisión UX enfocada de Facturas (D20) con el operador diario, el usuario
  ocasional y el administrador nuevo, con datos del harness y sobre el despliegue local de
  revisión, reconstruido solo en su frontend con `SRI_TRANSMISSION_ENABLED=0`.

  Verificar:
  - sin hallazgos S4/S5;
  - sin S3 atribuibles a la base o al encabezado;
  - el operador diario en 4/5 o más;
  - los hallazgos heredados informados aparte.
- [ ] 10.3 Ejecutar, sin tráfico al SRI:
  - las pruebas enfocadas;
  - `openspec:validate`, `format:check`, `security:dependencies` y `security:secrets`;
  - `test:visual`;
  - `verify`, en sala limpia si el CI alojado sigue sin poder ejecutarse.

  Verificar que todo pasa. Si solo falla AC-04 por su inestabilidad registrada, informar la
  evidencia compuesta y no presentarla como verde.
