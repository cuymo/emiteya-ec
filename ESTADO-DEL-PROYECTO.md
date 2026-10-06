# Estado del proyecto

Corte: 2026-10-05. `main` incluye los cambios 0 a 11, el último `add-debit-notes`. El detalle de
cada decisión vive en `docs/` y en `openspec/`; este archivo resume dónde estamos, qué falta y qué se
necesita del dueño del producto para cada paso pendiente.

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

### Cambio 11 `add-debit-notes`

- Archivado en `openspec/changes/archive/2026-10-05-add-debit-notes/` y su spec en
  `openspec/specs/debit-notes/`. Resumen en `docs/product/capabilities.md` (Trazabilidad de
  `debit-notes`) y detalle en `docs/architecture/fiscal-emission.md`.
- Nota de débito 1.0.0 contra una factura propia autorizada del mismo ambiente, por las causas del
  artículo 16, con conceptos en los tratamientos de IVA de la factura, cálculo exacto por
  tratamiento, exactamente un `pago` (política del MVP) por el valor total, declaración del usuario,
  transmisión, reconciliación, RIDE propio, bandeja y pantallas.
- Cierre: 31/31 tareas, 27/27 requisitos y sus escenarios, `/opsx:verify` sin problemas,
  `corepack pnpm verify` en verde sobre el HEAD final (2 196 pruebas en 256 archivos, más AC-04),
  revisión de la interfaz 118/118 (`ui-review.md` del cambio archivado), prueba end-to-end sobre
  `main.ts` con el SRI simulado, prueba explícita de secuenciales independientes (factura, nota de
  crédito, nota de débito y factura) y `bench:debit-notes` final con todos los P95 dentro del
  objetivo (`docs/quality/benchmarks/debit-notes-2026-10-05.md`).
- `infoAdicional`, resuelto contra la ficha v2.34: la fila "Obligatorio" de la página 59 no exige el
  nodo cuando no corresponde ningún campo adicional, y ninguno corresponde hoy; nunca se escribe un
  campo inventado. Evidencia literal en
  `docs/product/sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt` (Resolución de
  `infoAdicional`) y decisión en el design D16 del cambio archivado.
- Fuentes archivadas: ficha técnica v2.34, páginas 29, 51–59, 62, 69–74 y 135, y como
  complementaria la pregunta 11 de las preguntas frecuentes del SRI del cambio de tarifa de 2016
  (`docs/product/sri-catalogs/fuentes/sri-preguntas-frecuentes-tarifa-iva-2016.txt`).

## Falta

### 1. Cambios pendientes de la secuencia

| # | Cambio | Capacidad | Cierra | Bloqueante antes de proponer |
| --- | --- | --- | --- | --- |
| 12 | `add-withholding-receipts` | Comprobante de retención | AC-03 parcial | Ninguno |
| 13 | `add-shipping-guides` | Guía de remisión | AC-03 parcial | Ninguno |
| 14 | `add-purchase-settlements` | Liquidación de compra | AC-03 | Q-12 (parcial) |
| 15 | `add-reports-export` | Reportes y exportación | AC-09 | Ninguno |
| 16 | `add-data-portability` | Portabilidad de datos | AC-10 | Q-28 (abierta) |

Capacidades futuras sin número, ya decididas fuera del MVP actual: `correct-returned-document`
(BR-28), `cancellation-observation` (Q-16), `credit-note-discounts-bonuses` y
`external-supporting-documents`.

### 2. Compuertas previas a la transmisión real y al go-live

Ninguna bloquea proponer cambios; todas bloquean producción (`docs/quality/sri-certification.md`).

| Compuerta | Estado |
| --- | --- |
| Cifra exacta en bytes del límite de tamaño por comprobante (Q-47) | Pendiente de evidencia oficial: la ficha dice "320 Kb" sin fijar la conversión. La transmisión habilitada no queda lista sin la política publicada. |
| P12 ecuatoriano real validado | Pendiente |
| RUC habilitado en el ambiente de Pruebas | Pendiente |
| S-3 online: diez facturas autorizadas en Pruebas | Pendiente |
| RUC del proveedor del sistema en `infoAdicional` (anexo 26, Q-37) | Abierta: si una instalación queda obligada, el campo se escribe en la factura y en las dos notas, en su propio cambio |
| Licencia open source (Q-33) | Abierta; decidir antes del primer release |
| Conservación de artefactos (Q-27) | Parcial: nunca purgar en v1 |
| Registro de cambios normativos (Q-40) | Abierta, sin bloquear cambios |

### 3. Preguntas abiertas que no bloquean el siguiente cambio

Q-16 (observación de anulaciones), Q-32 (criterios de aceptación fuera del ERS §19, se escriben en
cada cambio), Q-45 (precio unitario editable), Q-46 (línea manual sin producto), Q-22 y Q-26
(parciales). Detalle en `docs/product/open-questions.md`.

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
| Certificación S-3 online | En el entorno del operador: un P12 ecuatoriano real y su contraseña, un RUC habilitado en Pruebas y la clave maestra de la custodia (`CERTIFICATE_MASTER_KEY`); después, ejecutar `docs/quality/sri-certification.md` e incluir al menos una nota de débito | Las respuestas del SRI de las pruebas son sintéticas; solo Pruebas confirma la autorización real. Las reglas de la fuente, como `infoAdicional`, ya están resueltas y no dependen de ese resultado |
| Política de tamaño (Q-47) | El texto oficial del SRI que fije la cifra en bytes (o la unidad de "320 Kb"), con su URL | No se infiere ni se inventa la conversión; se publica en un cambio OpenSpec pequeño |
| Aviso del cambio de tarifa del 14 % al 12 % (opcional) | Su URL o PDF oficial del SRI, si se tiene | No se encontró en el portal; la regla ya tiene su evidencia primaria en la ficha v2.34 |
| Proponer `add-purchase-settlements` (14) | Decisión de producto sobre Q-12: en qué casos procede la liquidación de compra | Fuera de los casos permitidos es tributariamente incorrecta aunque el XML valide |
| Proponer `add-data-portability` (16) | Decisión sobre Q-28: formato de la exportación | Define la portabilidad real fuera del sistema |
| Primer release | Decisión sobre Q-33: licencia open source | La exigen ERS API-006 y el go-live |
| Siguiente cambio (12, 13 o 15) | Cuál proponer primero | No tienen bloqueantes; el orden de la secuencia es 12, 13, 15 |
