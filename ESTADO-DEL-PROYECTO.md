# Estado del proyecto

Corte: 2026-10-08. `main` incluye los cambios 0 a 14, el último `add-purchase-settlements`. El
detalle de cada decisión vive en `docs/` y en `openspec/`; este archivo resume dónde estamos, qué
falta y qué se necesita del dueño del producto para cada paso pendiente.

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

### Cambio 14 `add-purchase-settlements`

- Archivado en `openspec/changes/archive/2026-10-08-add-purchase-settlements/` y su spec en
  `openspec/specs/purchase-settlements/`. Resumen en `docs/product/capabilities.md` (Trazabilidad de
  `purchase-settlements`) y detalle en `docs/architecture/fiscal-emission.md`.
- Liquidación de compra 1.1.0 (`codDoc` 03) solo en el caso c) del art. 13 del Reglamento de
  Comprobantes de Venta (Q-12, política `PURCHASE_SETTLEMENT_ELIGIBILITY_V1`): cuatro declaraciones
  del usuario, separadas y congeladas como `USER_DECLARED`, nunca verificadas ni escritas en el XML;
  proveedor con cédula o pasaporte y el rol de proveedor (RUC, consumidor final y exterior quedan
  fuera como restricción del MVP); líneas con producto opcional (solo propone código y descripción,
  nunca el precio) o libres; solo IVA; pagos con plazo y unidad de tiempo obligatorios y suma exacta;
  aviso de la retención sin automatizar el comprobante 07; sin efectos en el inventario.
- Pipeline compartido: reserva, firma (contrato del firmador para el 03 con
  `ec-sri-invoice-signer@1.8.2`), transmisión, reconciliación, RIDE propio (ficha v2.34, página 65),
  bandeja con la contraparte rotulada "Proveedor" y pantallas.
- Límites de recursos del proyecto: 100 líneas por defecto y 500 como máximo absoluto (corregido
  desde 1000 con la evidencia del benchmark: el RIDE de 1000 líneas con textos máximos superaba
  1 s), 10 pagos por defecto y 20 como máximo, y un cuerpo de 4 MiB solo para las rutas que guardan
  el borrador. Ninguno es un límite del SRI ni del XSD, ni guarda relación con Q-47.
- Cierre: 36/36 tareas, 35/35 requisitos y 196/196 escenarios, `/opsx:verify` sin problemas,
  `corepack pnpm verify` en verde sobre el HEAD final (2 859 pruebas en 339 archivos, más AC-04),
  revisión de la interfaz 94/94 (`ui-review.md` del cambio archivado), prueba end-to-end sobre
  `main.ts` con el SRI simulado, prueba de secuenciales independientes (01, 03, 04, 05, 06 y 07) y
  `bench:purchase-settlements` con todos los P95 dentro del objetivo
  (`docs/quality/benchmarks/purchase-settlements-2026-10-07.md`).
- Corrección documental sin cambio de comportamiento: la liquidación de compra usada como documento
  sustento de una retención la emite el adquirente (glosario y texto del editor de la retención).

## Falta

### 1. Cambios pendientes de la secuencia

| # | Cambio | Capacidad | Cierra | Bloqueante antes de proponer |
| --- | --- | --- | --- | --- |
| 15 | `add-reports-export` | Reportes y exportación | AC-09 | Ninguno; empieza por su revisión de readiness |
| 16 | `add-data-portability` | Portabilidad de datos | AC-10 | Q-28 (abierta) |

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
  `add-debit-notes` para generar el DDL) y tres `t_bench_ride_*` de ejecuciones anteriores de
  `bench:ride`.

## Lo que se necesita del dueño del producto

Ninguno de estos datos se guarda en el repositorio, la CI ni los registros.

| Paso | Qué se necesita | Por qué |
| --- | --- | --- |
| Borrar los esquemas temporales de la base de pruebas | Consentimiento para `DROP SCHEMA` de `nd_ddl_scratch` y de los tres `t_bench_ride_*` | Es una operación destructiva |
| Certificación S-3 online | Después de cerrar el cambio 16, en el entorno del operador: un P12 ecuatoriano real y su contraseña, un RUC habilitado en Pruebas y la clave maestra de la custodia (`CERTIFICATE_MASTER_KEY`); después, ejecutar `docs/quality/sri-certification.md` con los seis tipos de comprobante, incluida una liquidación de compra | Las respuestas del SRI de las pruebas son sintéticas; solo Pruebas confirma la autorización real. Las reglas de la fuente, como `infoAdicional`, ya están resueltas y no dependen de ese resultado |
| Política de tamaño (Q-47) | El texto oficial del SRI que fije la cifra en bytes (o la unidad de "320 Kb"), con su URL | No se infiere ni se inventa la conversión; se publica en un cambio OpenSpec pequeño |
| Aviso del cambio de tarifa del 14 % al 12 % (opcional) | Su URL o PDF oficial del SRI, si se tiene | No se encontró en el portal; la regla ya tiene su evidencia primaria en la ficha v2.34 |
| Proponer `add-data-portability` (16) | Decisión sobre Q-28: formato de la exportación | Define la portabilidad real fuera del sistema |
| Primer release | Decisión sobre Q-33: licencia open source | La exigen ERS API-006 y el go-live |
| Siguiente cambio (15) | Aprobar la revisión de readiness de `add-reports-export` antes de proponerlo | El alcance de AC-09 se cierra antes del proposal |
