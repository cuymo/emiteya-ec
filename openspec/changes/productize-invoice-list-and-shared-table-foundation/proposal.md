# Proposal

## Why

Facturas es la pantalla diaria del operador y hoy es la más visible de las heredadas dentro del
shell nuevo:
- no tiene una acción principal de página;
- siete chips del mismo peso compiten con lo que requiere atención;
- el número y el estado quedan en extremos opuestos, y el número y el total se parten a 1024 px;
- «Requiere revisión» se lee como un rechazo;
- muestra «0-0» mientras carga.

La revisión UX del 2026-10-14 registró estos defectos para este corte (`technical-debt.md`).
Facturas es el piloto que prueba una base compartida de página y tabla para las listas
siguientes.

## What Changes

- **Facturas como herramienta de trabajo diario** (`/facturas`):
  - encabezado de página con «Nueva factura» como única acción principal (la creación rápida
    del shell sigue siendo secundaria);
  - columnas mínimas para decidir: número junto al estado, comprador, fecha y total, con el número
    y el total en una sola línea a 1024 px;
  - abrir la factura desde su número o desde la fila, y un menú de acciones secundarias por fila
    con solo acciones que existen hoy;
  - vistas «Todas» y «Requiere atención» con su conteo, y un filtro de estado compacto con los
    ocho estados del glosario, en lugar de siete chips del mismo peso;
  - búsqueda que dice lo que busca de verdad: número, comprador o identificación;
  - estado de la lista en la URL: recargar, compartir y volver conservan la vista;
  - «Limpiar filtros» solo con filtros activos, y los filtros activos visibles y removibles;
  - carga, vacío inicial, vacío por filtros y error dentro de la superficie de la tabla, sin «0-0»
    ni paginación vacía;
  - en pantallas estrechas: columnas priorizadas y desplazamiento dentro de la tabla, sin tarjetas.
- **Presentación del estado de los comprobantes.** Un distintivo de estado sobre el `Badge` de la
  base, con el mapeo aprobado por el propietario:
  - información: Procesando, Pendiente de envío, Verificando con el SRI y Pendiente de autorización;
  - éxito: Autorizado;
  - advertencia: Requiere revisión;
  - destructivo: Devuelto y No autorizado.

  «Verificando con el SRI» nunca se presenta como fallo y explica que no hay que volver a emitir
  la venta. La transmisión detenida sigue como indicador aparte.
- **Base compartida y reutilizable**, con lo que Facturas necesita y nada más:
  - encabezado de página;
  - tabla de datos con su barra de herramientas;
  - vistas, filtro de opciones, filtros activos, búsqueda, paginación y menú de acciones por fila;
  - un hook de estado de lista en la URL, que corrige la pérdida de cambios rápidos registrada en
    la deuda.
- **Sin cambios** en el backend, la API, la base de datos ni la lógica fiscal. TanStack Table sigue
  en 8.21.3 y no hay dependencias nuevas de ejecución.

### Fuera de alcance

- **Otras pantallas:** el editor de facturas (`/borradores/nuevo`, `/borradores/[id]`), el detalle
  (`/facturas/[id]`) y las demás listas (Archivo de comprobantes, notas de crédito y débito,
  retenciones, guías, liquidaciones, productos, terceros, inventario y usuarios). Siguen sobre la
  tabla heredada hasta su propio corte.
- **Funciones de tabla:** vistas guardadas, acciones masivas, casillas de selección, columnas
  configurables y ordenar por columna (la API no ordena).
- **Acciones fiscales desde la lista** (reintentar la firma, reconciliar, anular, reenviar o
  duplicar). Siguen en el detalle, con su contexto.
- **Cambios en el backend.** Lo que la UI necesitaría y la API no ofrece queda como brecha del
  backend registrada, sin implementarse aquí.
- **TanStack Table v9, Recharts, selectores de fecha y librerías de estado.**

## Capabilities

### New Capabilities

Ninguna. El comportamiento observable pertenece a la consulta de facturas y al shell. La base
compartida es arquitectura de componentes y vive en el design y en la documentación.

### Modified Capabilities

- `invoices`: se añaden los requisitos de la lista de facturas para el trabajo diario:
  - la acción principal;
  - las vistas, el filtro de estado y la búsqueda con su alcance real;
  - el estado de la lista en la URL;
  - la presentación de los estados;
  - la apertura de una factura y sus acciones por fila;
  - la carga, el vacío y el error;
  - la lectura a cualquier anchura.

  «Consulta de facturas» no cambia.
- `web-application-shell`: el escenario «Pantalla autenticada» ya no afirma que el contenido de
  Facturas es el mismo que antes del shell nuevo.

## Impact

- **Frontend, nuevo:**
  - `components/layout/` (encabezado de página);
  - en `components/data-table/`: la tabla, la barra de herramientas, las vistas, el filtro, los
    filtros activos, la búsqueda, la paginación y las acciones por fila;
  - primitivos derivados `ui/table` y `ui/toggle-group`;
  - el distintivo de estado de comprobantes;
  - el hook de estado de lista en la URL.
- **Frontend, cambia:**
  - `features/invoices/invoices-screen.tsx` y sus pruebas;
  - la presentación del estado que comparten las pantallas de comprobantes (decisión del
    propietario en el design).
- **Sigue heredado:** `AppDataTable`, `ChipGroup`, `SearchInput` y `TablePagination`, mientras
  otras pantallas los usan (deuda con criterio de salida).
- **Pruebas:**
  - unitarias de la base y de la pantalla;
  - harness de navegador para teclado, axe y anchuras;
  - capturas nuevas de Facturas;
  - revisión de las capturas del shell que se toman sobre `/facturas`;
  - medición de la carga antes y después.
- **Documentación:**
  - `data-tables.md`, `component-system.md`, `frontend.md`, `feedback-and-states.md`,
    `testing.md`;
  - `technical-debt.md`, con las brechas del backend;
  - `THIRD_PARTY_NOTICES.md`.
- **Backend, API, base de datos, lógica fiscal y SRI:** sin cambios y sin tráfico al SRI.
