# Proposal

## Why

Un contribuyente que factura con el sistema no tiene cómo corregir una venta autorizada: la norma
solo le deja anular en línea hasta el día 7 del mes siguiente, y después únicamente con una nota de
crédito (Res. NAC-DGERCGC25-00000014, art. 3, reformado). Sin notas de crédito, una devolución o
una venta anulada queda fuera del sistema y el stock contabilizado no recupera la mercadería que
regresó. Es el cambio 10 de `capabilities.md`, con Q-10 y Q-20 resueltas (2026-10-04).

## What Changes

- **Nota de crédito 1.1.0** (`codDoc` 04): un comprobante propio contra una factura emitida por el sistema, de la misma empresa y autorizada, con su secuencial por establecimiento, punto y tipo, su clave de acceso, su snapshot inmutable, su XML validado contra `NotaCredito_V1.1.0.xsd`, su firma, su transmisión, su reconciliación, su autorización y su RIDE.
- **Dos causas cerradas:**
  - `TOTAL_ANNULMENT`: acredita el total exacto de la factura, solo si no tiene ningún crédito previo, reservado o aplicado;
  - `RETURN`: parcial o total, por líneas de la factura con la cantidad que se acredita.
  - El motivo es texto del comprobante y nunca selecciona comportamiento.
- **Borrador y vista previa:** el usuario elige una factura elegible, la causa, las líneas y cantidades (en `RETURN`), el retorno físico donde corresponde, el motivo y las dos declaraciones legales, y ve antes de emitir los importes, lo que queda por acreditar, lo que vuelve al inventario y los problemas que bloquean.
- **Importes exactos** desde el snapshot de la factura original: proporción por cantidad con decimal exacto y la última nota que completa una línea toma el remanente exacto, para que la suma de las notas nunca difiera del documento original.
- **Capacidad acreditable** de cada factura (original, reservada, aplicada) que se reserva bajo el bloqueo de la factura en la misma transacción que reserva la nota, con defensa en la base; pasa a aplicada al autorizar la nota y se libera, de forma transaccional e idempotente, si la nota termina devuelta o no autorizada. El crédito acumulado nunca supera la factura (política conservadora del producto).
- **Declaraciones del usuario** antes de reservar: la factura no es una factura comercial negociable negociada y no sustentó una devolución de impuestos. Se guardan en el snapshot de la nota como elegibilidad declarada, no verificada, y nunca anulan una exclusión que el sistema conoce.
- **Exclusión automática de consumidor final** (requisito oficial desde el 01/01/2026), validada antes de consumir secuencial, clave, firma o llamada al SRI.
- **Devolución de stock** (`DEVOLUCION_NC`, Q-20): solo por el retorno físico declarado, solo de las líneas que en el snapshot de la factura tenían `inventoryAffectsStock = true`, y solo cuando la nota entra en `AUTHORIZED`, en la misma transacción, por un seguidor de las transiciones. Una capacidad devolvible por factura y producto (salida original, reservada, aplicada) impide devolver más de lo que salió, también con notas simultáneas.
- **Pipeline compartido:** la firma, la reserva del comprobante, la transmisión, la reconciliación, la bandeja y el RIDE se reutilizan por tipo de comprobante; se generaliza la firma, hoy atada a la factura, sin cambiar el comportamiento de la factura.
- **RIDE de la nota de crédito** con la distribución oficial de la ficha v2.34 (anexo 2, página 61), sobre las primitivas del RIDE de la factura.
- **Pantallas:** Notas de crédito (lista, borrador y detalle con transmisión y documentos), la acción desde el detalle de la factura y la nota en la bandeja de Comprobantes.
- **Permisos** `creditNotes.read`, `creditNotes.draft`, `creditNotes.emit` y `creditNotes.retrySigning` para administrador y operador (ERS: el operador emite comprobantes), y `creditNotes.reconcile` para el administrador, como la reconciliación de facturas.

**Fuera de alcance:**

- Descuentos y bonificaciones posteriores (capacidad futura `credit-note-discounts-bonuses`; la norma los permite, es alcance del MVP).
- Documentos sustento externos, en papel, importados o ingresados a mano (capacidad futura `external-supporting-documents`).
- Notas contra facturas de consumidor final o no autorizadas (`RESERVED`, `SIGNED`, `RECEIVED`, `SEND_UNKNOWN`, `MANUAL_REVIEW`, `RETURNED`, `NOT_AUTHORIZED`) y contra borradores.
- Cualquier plazo para emitir la nota: la NAC-DGERCGC25-00000017 eliminó el de doce meses.
- Corrección de una nota devuelta (`correct-returned-document`), notas de débito y los demás documentos.
- Anulación en línea en el SRI y su observación (Q-16).
- Notas históricas, migración de créditos anteriores al sistema y cualquier cambio a la factura original o a sus artefactos.

## Capabilities

### New Capabilities

- `credit-notes`: notas de crédito contra facturas propias autorizadas: elegibilidad, causas, borrador y vista previa, cálculo exacto, capacidad acreditable, declaraciones, devolución física declarada, consulta, reintento de firma, reconciliación manual, permisos y aislamiento.

### Modified Capabilities

- `document-emission`: los tipos de comprobante que el sistema emite (factura y nota de crédito) y el contenido del snapshot de una nota de crédito.
- `sri-transmission`: la transmisión trata igual la factura y la nota de crédito, y la reconciliación manual se pide sobre cualquiera de las dos.
- `document-archive`: la bandeja y los documentos incluyen la nota de crédito, y su RIDE sigue su formato oficial.
- `inventory`: la nota de crédito autorizada registra `DEVOLUCION_NC` por el retorno físico declarado, limitado por la salida original pendiente de devolver.
- `audit-trail`: la emisión, la firma, el reintento y la reconciliación manual de una nota de crédito se auditan como las de la factura, con su causa y sus declaraciones.

## Impact

- **Backend:** módulo nuevo `credit-notes` (dominio, cálculo, capacidad, borradores, emisión, consultas, rutas); `fiscal` gana la firma genérica por tipo y la reserva compartida del comprobante; `sri-engine` gana el builder `notaCredito` 1.1.0 y la lectura y la distribución del RIDE de la nota; `inventory` gana la capacidad devolvible y el seguidor de la devolución; `invoices` exporta la lectura del snapshot de una factura para la nota. `fiscal` e `invoices` no importan `credit-notes` ni `inventory`.
- **Base de datos:** borradores de nota, capacidad acreditable por factura y línea con sus reservas, capacidad devolvible por factura y producto con sus reservas, y la operación `credit_note.emit` en el registro de idempotencia.
- **API:** `/api/v1/credit-notes` (borradores, vista previa, emisión, consulta, reintento de firma, transmisión y reconciliación) y la lectura de facturas elegibles; la bandeja `/documents` sin rutas nuevas.
- **Frontend:** pantallas de Notas de crédito, acción en el detalle de la factura y la nota en Comprobantes.
- **Rendimiento:** `bench:credit-notes`, fuera de `verify`, con facturas elegibles, vista previa, reserva con créditos previos, cálculo de devoluciones parciales, consumo concurrente de capacidad y RIDE de la nota.
- **Documentación:** `fiscal-emission.md`, `backend.md`, `ARCHITECTURE.md`, `database.md`, `access-control.md`, `observability.md`, `domain-model.md`, `glossary.md` y `capabilities.md`.
- **Fuentes:** Reglamento de Comprobantes de Venta (art. 15), Res. NAC-DGERCGC25-00000014 y 00000017, XSD `NotaCredito_V1.1.0`, ficha v2.34 (anexos 2 y 3), ERS RF-210..213 y CTX §13.
