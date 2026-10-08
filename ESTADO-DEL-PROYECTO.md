# Estado del proyecto

Corte: 2026-10-08. `main` incluye los cambios 0 a 15, el último `add-reports-export`. El detalle
de cada decisión vive en `docs/` y en `openspec/`; este archivo resume dónde estamos, qué falta y
qué se necesita del dueño del producto para cada paso pendiente.

## Hecho

### Cambios archivados en `main`

| # | Cambio | Archivado | Cierra |
| --- | --- | --- | --- |
| 0 | `bootstrap-application` | 2026-10-02 | Base del monorepo, verificación y CI |
| 1 | `add-user-access` | 2026-10-02 | Usuarios, sesiones y auditoría base |
| 2 | `add-taxpayer-setup` | 2026-10-02 | AC-01 parcial |
| 3 | `add-fiscal-numbering` | 2026-10-02 | AC-04 |
| 4 | `add-signing-certificate` | 2026-10-02 | AC-01 |
| 5a | `add-fiscal-catalogs` | 2026-10-03 | Catálogos oficiales versionados |
| 5b | `add-parties-and-products` | 2026-10-03 | Terceros y productos |
| 6 | `add-invoice-emission` | 2026-10-03 | AC-05 |
| 7 | `add-sri-transmission` | 2026-10-04 | AC-06; AC-02 parcial |
| 8 | `add-document-archive` | 2026-10-04 | AC-07 |
| 9 | `add-minimal-inventory` | 2026-10-04 | AC-08 |
| 10 | `add-credit-notes` | 2026-10-05 | AC-03 parcial |
| 11 | `add-debit-notes` | 2026-10-05 | AC-03 parcial |
| 12 | `add-withholding-receipts` | 2026-10-06 | AC-03 parcial |
| 13 | `add-shipping-guides` | 2026-10-07 | AC-03 parcial |
| 14 | `add-purchase-settlements` | 2026-10-08 | AC-03 (los seis comprobantes off-line) |
| 15 | `add-reports-export` | 2026-10-08 | AC-09 |

### Cambio 15 `add-reports-export`

- Archivado en `openspec/changes/archive/2026-10-08-add-reports-export/`, con su spec en
  `openspec/specs/reports/` y el requisito de su auditoría en `openspec/specs/audit-trail/`. Resumen
  en `docs/product/capabilities.md` (Trazabilidad de `reports`) y detalle en
  `docs/architecture/reports.md`.
- Cinco reportes del ERS §11 como listados, sin totales ni compensación: Documentos emitidos,
  Facturas, Retenciones, Inventario (Existencias y Movimientos) y Terceros. Filtros mínimos en la
  URL, todos los estados por defecto en Documentos emitidos y los autorizados en Facturas y
  Retenciones, y el ambiente vigente de la empresa por defecto. Las fuentes viven en sus módulos
  dueños y leen lo congelado por cada comprobante; el inventario lee su saldo y su kárdex.
- Exportación a XLSX, único formato, con los mismos registros que la lista completa (AC-09):
  escritor OOXML propio sobre `node:zlib` (ADR 0023), sin dependencias de producción nuevas;
  identificaciones y números como texto; importes como números hasta 15 dígitos significativos y,
  por encima, como texto decimal canónico; texto de los usuarios sin fórmulas; fechas fiscales sin
  zona horaria y momentos en America/Guayaquil. La generación termina en un temporal privado `0600`
  dentro de una transacción `REPEATABLE READ, READ ONLY`, se audita (`report.exported`) y solo
  después se entrega; el temporal se borra siempre y no queda ningún artefacto permanente.
- Límites de recursos del proyecto, fijados por `bench:reports`: 100 000 filas por exportación
  (rango de 1 a 250 000, `409` al superarlo) y 2 exportaciones simultáneas por instancia (rango de 1
  a 4, `503` con `Retry-After`). Ninguno es un límite fiscal ni del ERS.
- Cierre: 22/22 tareas, 17/17 requisitos y 54/54 escenarios, `/opsx:verify` sin problemas críticos
  ni advertencias (dos sugerencias aceptadas como cobertura opcional), `corepack pnpm verify` en
  verde sobre el HEAD final (2 967 pruebas en 353 archivos, más AC-04), revisión de la interfaz
  166/166 (`ui-review.md` del cambio archivado), prueba end-to-end sobre `main.ts` y `bench:reports`
  con todas las listas dentro de RNF-005 (`docs/quality/benchmarks/reports-2026-10-08.md`).

## Falta

### 1. Cambios pendientes de la secuencia

| # | Cambio | Capacidad | Cierra | Bloqueante antes de proponer |
| --- | --- | --- | --- | --- |
| 16 | `add-data-portability` | Portabilidad de datos | SEC-010 | Ninguno: Q-28 resuelta y readiness aprobado (2026-10-08) |

Capacidades futuras sin número, ya decididas fuera del MVP actual: `correct-returned-document`
(BR-28), `cancellation-observation` (Q-16), `credit-note-discounts-bonuses`,
`external-supporting-documents`, `withholding-isd`, `withholding-foreign-payments`,
`withholding-special-supports`, `withholding-variable-rate-concepts`,
`shipping-guide-additional-details`, `shipping-guide-multiple-vehicles`, `location-stock`,
`purchase-settlement-other-cases`, `internal-purchase-settlement-withholding-link` e
`inventory-entry-from-purchase-settlement`.

Seguimientos separados, que no reabren los cambios archivados:

- Q-52 `regulatory-source-refresh`: revisar la trazabilidad de los cambios 11 a 13 con la edición
  vigente del Reglamento de Comprobantes de Venta, después del cambio 16.
- Q-53: confirmar con la fuente oficial si la liquidación de compra se entrega en dos ejemplares del
  RIDE firmados por el proveedor, en la revisión operativa previa al go-live.
- Rendimiento: medir el RIDE de la factura por encima de 120 líneas (admite hasta 1000); no bloquea
  ningún cambio (`docs/quality/performance.md`).

### 2. Compuertas previas a la transmisión real y al go-live

Ninguna bloquea proponer cambios; todas bloquean producción (`docs/quality/sri-certification.md`).

| Compuerta | Estado |
| --- | --- |
| Cifra exacta en bytes del límite de tamaño por comprobante (Q-47) | Pendiente de evidencia oficial: la ficha dice "320 Kb" sin fijar la conversión. La transmisión habilitada no queda lista sin la política publicada. |
| P12 ecuatoriano real validado | Pendiente |
| RUC habilitado en el ambiente de Pruebas | Pendiente |
| S-3 online: diez facturas autorizadas en Pruebas | Pendiente |
| RUC del proveedor del sistema en `infoAdicional` (anexo 26, Q-37) | Abierta: si una instalación queda obligada, el campo se escribe en la factura y en las dos notas, en su propio cambio |
| RIDE de la liquidación firmado por el proveedor (Q-53) | Abierta: confirmar la fuente oficial; el sistema no implementa firma manuscrita ni carga del RIDE firmado |
| Licencia open source (Q-33) | Abierta; decidir antes del primer release |
| Conservación de artefactos (Q-27) | Parcial: nunca purgar en v1 |
| Restauración probada del respaldo operativo (AC-10, RNF-007, SEC-008) | Pendiente: volcado, artefactos y clave maestra por separado (`docs/architecture/deployment.md`); la portabilidad no la reemplaza |
| Registro de cambios normativos (Q-40) | Abierta, sin bloquear cambios |

### 3. Preguntas abiertas que no bloquean el siguiente cambio

Q-16 (observación de anulaciones), Q-32 (criterios de aceptación fuera del ERS §19, se escriben en
cada cambio), Q-45 (precio unitario editable), Q-46 (línea manual sin producto), Q-52 (revisión
normativa, después del cambio 16), Q-53 (antes del go-live), Q-22 y Q-26 (parciales). Detalle en
`docs/product/open-questions.md`.

### 4. Deuda técnica y mantenimiento

- Deuda activa registrada en `docs/quality/technical-debt.md` (lint de accesibilidad para JSX,
  pruebas sensibles a la carga, runner de CI, paginación de establecimientos, entre otras).
- `bench:credit-notes` no fija `RIDE_SWEEP_INTERVAL_SECONDS` (registrado en la deuda técnica).
- La base de pruebas conserva esquemas temporales: `nd_ddl_scratch` (creado durante
  `add-debit-notes` para generar el DDL), tres `t_bench_ride_*` de ejecuciones anteriores de
  `bench:ride` y otros 17 `t_*` de pruebas interrumpidas en sesiones anteriores.

## Lo que se necesita del dueño del producto

Ninguno de estos datos se guarda en el repositorio, la CI ni los registros.

| Paso | Qué se necesita | Por qué |
| --- | --- | --- |
| Borrar los esquemas temporales de la base de pruebas | Consentimiento para `DROP SCHEMA` de `nd_ddl_scratch` y de los `t_*` sobrantes | Es una operación destructiva |
| Certificación S-3 online | Después de cerrar el cambio 16, en el entorno del operador: un P12 ecuatoriano real y su contraseña, un RUC habilitado en Pruebas y la clave maestra de la custodia (`CERTIFICATE_MASTER_KEY`); después, ejecutar `docs/quality/sri-certification.md` con los seis tipos de comprobante, incluida una liquidación de compra | Las respuestas del SRI de las pruebas son sintéticas; solo Pruebas confirma la autorización real. Las reglas de la fuente, como `infoAdicional`, ya están resueltas y no dependen de ese resultado |
| Política de tamaño (Q-47) | El texto oficial del SRI que fije la cifra en bytes (o la unidad de "320 Kb"), con su URL | No se infiere ni se inventa la conversión; se publica en un cambio OpenSpec pequeño |
| Aviso del cambio de tarifa del 14 % al 12 % (opcional) | Su URL o PDF oficial del SRI, si se tiene | No se encontró en el portal; la regla ya tiene su evidencia primaria en la ficha v2.34 |
| Primer release | Decisión sobre Q-33: licencia open source | La exigen ERS API-006 y el go-live |
