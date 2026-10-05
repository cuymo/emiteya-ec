# Proposal

## Why

Un contribuyente que factura con el sistema no puede cobrar después de la venta los intereses
por un pago tardío ni recuperar los costos y gastos en que incurrió después de emitir la factura.
El Reglamento de Comprobantes de Venta exige para eso una nota de débito (art. 16), y hoy ese
cobro queda fuera del sistema: sin número, sin XML autorizado y sin evidencia. Es el cambio 11 de
`capabilities.md`. Q-49 está resuelta y el XSD 1.0.0 se verificó contra el portal del SRI
(2026-10-05).

## What Changes

- **Nota de débito 1.0.0** (`codDoc` 05): un comprobante propio contra una factura emitida por el sistema, de la misma empresa, del mismo ambiente, autorizada y con su snapshot y sus artefactos íntegros. Tiene su secuencial por establecimiento, punto y tipo, su clave de acceso y su snapshot inmutable. Su XML es determinista y se valida contra `NotaDebito_V1.0.0.xsd`. Después sigue la firma, la transmisión, la reconciliación, la autorización, el RIDE y el archivo.
- **Dos causas cerradas** del artículo 16:
  - `LATE_PAYMENT_INTEREST`: intereses de mora;
  - `POST_INVOICE_COST_EXPENSE`: costos o gastos posteriores a la factura.
- **Uno o más conceptos.** Cada uno lleva su causa, una descripción documental que nunca selecciona comportamiento, un importe exacto mayor que cero y uno de los tratamientos de IVA que ya tenía la factura. No hay conceptos vacíos ni en cero.
- **IVA de la factura original.**
  - Solo se ofrecen y se aceptan los tratamientos (código, código de porcentaje y tarifa) congelados en el snapshot de la factura. Nunca se usa una tarifa vigente del catálogo, el producto ni el tercero.
  - Una factura con varias tarifas no se reduce a una sola: cada concepto elige la suya.
  - **SOURCE STATUS: official SRI guidance identified / durable source copy/text still pending.** No bloquea este propose. Antes de cerrar APPLY se intenta conservar evidencia oficial durable, y si no se logra se informa de forma explícita (design D6).
- **Un solo cálculo versionado** (`calculateDebitNoteAmounts`), con decimal exacto y sin `number`:
  - los conceptos se agrupan por tratamiento;
  - el impuesto se materializa una vez sobre la base total de cada tratamiento;
  - el XML lleva un impuesto por tratamiento.

  La vista previa, el snapshot, el XML y el RIDE usan exactamente ese resultado.
- **Forma de pago.** La ficha técnica v2.34 marca `pagos` como obligatorio en la nota de débito y su RIDE oficial la muestra (design D8). El usuario elige una forma de pago vigente, que cubre el valor total.
- **Declaración del usuario antes de reservar:** la factura no es una factura comercial negociable efectivamente negociada (`NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE`, requisito oficial del artículo 16). El snapshot la guarda con su versión, el actor y el momento como declarada por el usuario, nunca como verificada por el sistema.
- **Consumidor final excluido por política del proyecto** (BR-32: receptor identificado), no por la NAC-DGERCGC25-00000014. Se valida antes de reservar secuencial, crear la clave, firmar o llamar al SRI.
- **Sin plazo de emisión:** las fuentes oficiales revisadas no establecen un plazo de emisión que este sistema deba imponer.
- **Documento complementario separado:**
  - no cambia la capacidad acreditable de la factura (una factura de 100 sigue con 100 acreditables);
  - una nota de crédito no puede tener una nota de débito como documento sustento;
  - no mueve inventario.
- **Pipeline compartido de `add-credit-notes`:** la reserva, la firma, el firmador, la transmisión SOAP, la cola, la máquina de estados, la reconciliación, la bandeja y el RIDE se reutilizan. Son propios de la nota de débito solo el borrador, el cálculo, el snapshot, el builder del XML, la distribución del RIDE, las rutas y las pantallas. La factura y la nota de crédito no cambian, byte a byte.
- **RIDE propio** con la distribución oficial de la ficha v2.34 (anexo 2, página 62). La bandeja `/documents` trata los tipos 01, 04 y 05 con su filtro y su detalle.
- **Pantallas:**
  - Notas de débito, con lista, borrador con vista previa y detalle con transmisión y documentos;
  - la acción desde el detalle de la factura;
  - la nota en Comprobantes.
- **Permisos:** `debitNotes.read`, `debitNotes.draft`, `debitNotes.emit` y `debitNotes.retrySigning` para administrador y operador, y `debitNotes.reconcile` solo para el administrador. La empresa sale siempre de la sesión.

**Fuera de alcance:**

- Documentos sustento externos, en papel, importados o ingresados a mano (`external-supporting-documents`, Q-11), y comprobantes de venta distintos de la factura del sistema.
- Notas contra facturas de consumidor final, de otra empresa, de otro ambiente, no autorizadas o con snapshot o artefactos alterados.
- Causas distintas de las dos del artículo 16: corrección de precio, error de facturación, incrementos, penalidades u otros cargos.
- Un tratamiento de IVA que la factura no tenía, una tarifa vigente distinta de la original y una tarifa global única.
- Corrección de una nota de débito devuelta (`correct-returned-document`).
- Anulación de una nota de débito emitida (`cancellation-observation`, Q-16).
- Otras monedas: la nota se emite en dólares, como la factura.
- Cualquier plazo de emisión sin una fuente oficial que lo establezca.
- Compensaciones, `valorDevolucionIva`, máquina fiscal, RISE e información adicional del XML: el sistema no los emite hoy en ningún comprobante.

## Capabilities

### New Capabilities

- `debit-notes`: notas de débito contra facturas propias autorizadas. Cubre elegibilidad, causas, conceptos, tratamientos de IVA de la factura, cálculo exacto, forma de pago, declaración, borrador y vista previa, reserva, idempotencia, consulta, reintento de firma, independencia de la capacidad acreditable y del inventario, permisos y aislamiento.

### Modified Capabilities

- `document-emission`: los tipos que el sistema emite incluyen la nota de débito 1.0.0, y el snapshot de una nota de débito tiene su contenido propio.
- `sri-transmission`: la transmisión trata igual la factura, la nota de crédito y la nota de débito, y la reconciliación manual se pide sobre cualquiera de las tres.
- `document-archive`: el RIDE de la nota de débito sigue su formato oficial, y la bandeja y los documentos incluyen la nota de débito.
- `audit-trail`: se auditan la emisión, la firma, el reintento y la reconciliación manual de una nota de débito, con la factura, las causas y la declaración.

## Impact

- **Backend:**
  - módulo nuevo `debit-notes` (dominio, cálculo, borradores, emisión, consultas y rutas);
  - `sri-engine` gana el builder `notaDebito` 1.0.0 y la lectura y la distribución del RIDE de la nota;
  - `fiscal` elige la auditoría de la reconciliación de la nota de débito;
  - `invoices` no cambia: la nota lee la factura con la lectura inmutable que ya exporta.

  `fiscal`, `invoices`, `inventory` y `credit-notes` no importan `debit-notes`.
- **Base de datos:**
  - borradores de nota de débito y sus conceptos;
  - la relación de cada nota con su factura, con defensa en la base;
  - la operación `debit_note.emit` en el registro de idempotencia.

  Sin cambios a facturas, notas de crédito, capacidades ni movimientos.
- **API:** `/api/v1/debit-notes` (facturas elegibles, borradores con vista previa, emisión, consulta, transmisión, reintento de firma y reconciliación). La bandeja `/documents` no tiene rutas nuevas.
- **Frontend:** pantallas de Notas de débito, la acción en el detalle de la factura y el tipo 05 en Comprobantes.
- **Rendimiento:** `bench:debit-notes`, fuera de `verify`. Mide la búsqueda de facturas elegibles, la vista previa, el cálculo con muchos conceptos de una tarifa y de varias, la reserva y el RIDE de la nota.
- **Documentación:** `fiscal-emission.md`, `backend.md`, `ARCHITECTURE.md`, `database.md`, `access-control.md`, `observability.md`, `performance.md`, `domain-model.md`, `glossary.md`, `capabilities.md` y el extracto de la fuente del IVA en `sri-catalogs/fuentes/`.
- **Fuentes:**
  - Reglamento de Comprobantes de Venta, art. 16 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-15-16.txt`);
  - XSD `NotaDebito_V1.0.0` (`sri-catalogs/fuentes/nota-de-debito-xsd-verificacion.txt`);
  - ficha técnica v2.34: formato XML de la nota de débito, páginas 58 y 59, y RIDE, anexo 2, página 62;
  - ERS RF-220..222, CTX §14 y Q-49.
