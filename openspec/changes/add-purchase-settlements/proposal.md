# Proposal

## Why

Una empresa que compra bienes muebles o servicios a una persona natural que, por su nivel cultural o
rusticidad, no puede emitirle un comprobante de venta (por ejemplo, un pequeño productor sin RUC)
necesita documentar esa compra con una liquidación de compra de bienes y prestación de servicios que
emite ella misma como adquirente. Sin ese comprobante, la compra queda sin número, sin XML
autorizado y sin evidencia, y no puede sustentar crédito tributario ni costos. El Reglamento de
Comprobantes de Venta fija cuándo procede (art. 13) y qué contiene (art. 22), y fuera de esos casos
la liquidación es tributariamente incorrecta aunque el XML valide (CTX R7). Es el cambio 14 de
`capabilities.md`. Q-12 está resuelta: el MVP soporta solo el caso c) del art. 13 vigente, y el XSD
1.1.0 se verificó contra el portal del SRI (2026-10-07).

## What Changes

- **Liquidación de compra 1.1.0** (`codDoc` 03, raíz `liquidacionCompra`): un comprobante propio con su secuencial independiente por ambiente, establecimiento, punto y tipo, su clave de acceso y su snapshot inmutable. Su XML es determinista y se valida contra `LiquidacionCompra_V1.1.0.xsd`. Después siguen la firma, la transmisión, la reconciliación, la autorización, el RIDE y el archivo, con el pipeline compartido. La emite siempre la empresa como adquirente.
- **Procedencia del caso c) del art. 13** (Q-12), política `PURCHASE_SETTLEMENT_ELIGIBILITY_V1` (`ART_13_C_RUSTICITY_NO_ACTIVE_RUC`): la liquidación no es una alternativa genérica a la factura. Antes de reservar, quien emite confirma cuatro declaraciones separadas, cada una con su identificador, la versión de la política, el actor y el momento, presentadas siempre como declaradas por el usuario y nunca como verificadas:
  - el proveedor es una persona natural no obligada a llevar contabilidad;
  - no está inscrito en el RUC o lo tiene suspendido a la fecha de la transacción;
  - por su nivel cultural o rusticidad no puede emitir comprobantes de venta;
  - la operación es la adquisición de bienes muebles o servicios.

  El sistema verifica lo que conoce: la empresa y su configuración, el tercero activo con el rol de proveedor, su identificación, el cálculo, los catálogos, el secuencial y la clave. No consulta el estado del RUC.
- **Proveedor:** un tercero activo de la empresa con el rol de proveedor, que la liquidación nunca asigna (el alta en línea permite marcarlo de forma explícita), identificado con cédula o pasaporte; el RUC, el consumidor final y la identificación del exterior se rechazan en el MVP, como restricción que materializa el caso c). Su dirección es obligatoria.
- **Líneas:** producto opcional, solo para sugerir su código y su nombre, o línea libre; el precio es siempre el de la operación. Código cuando exista, descripción, unidad de medida cuando corresponda, cantidad, precio unitario, descuento (siempre presente, incluso 0.00) e IVA, con decimales exactos.
- **Solo IVA:** el código y la tarifa salen del catálogo vigente en la fecha de emisión y se congelan con su referencia. Un cálculo versionado es la única autoridad de la vista previa, el snapshot, el XML y el RIDE.
- **Pagos:** uno o más, cada uno con su forma de pago del catálogo, su total, su plazo y su unidad de tiempo; la suma de los pagos es exactamente el importe total. Moneda `DOLAR`.
- **Retención:** el caso c) obliga a retener el IVA y la renta para sustentar crédito y costos, pero el comprobante de retención es otro documento. La liquidación no lo emite, no lo espera y no se fusiona con él: muestra un aviso de la obligación después de la vista previa y en su detalle, sin presentarlo como evidencia de que la retención ya se emitió.
- **Sin inventario ni compras:** la liquidación no reserva, aumenta ni ajusta stock ni crea movimientos, aunque una línea tenga un producto bien; tampoco crea órdenes de compra, cuentas por pagar ni facturas recibidas.
- **Límites de recursos configurables:** líneas por liquidación (100, hasta 1000) y pagos por liquidación (10, hasta 20); el cuerpo de las rutas que reciben el borrador completo admite hasta 4 MiB para que esos máximos sean alcanzables. Son defensas del producto, no límites del SRI, del XSD ni del XML, ni una interpretación de Q-47.
- **Pipeline compartido:** reserva, perfil de firma, registro de esquemas, firmador, jobs durables, SOAP, respuesta guardada antes de clasificar, reconciliación, bandeja, descargas, RIDE e historial de entregas, sin un pipeline paralelo. La factura, las notas, la retención y la guía no cambian, byte a byte.
- **RIDE propio** con la distribución oficial (ficha v2.34, anexo 2, página 65), sin campos que la liquidación no tiene.
- **Pantallas:** Liquidaciones de compra con lista, borrador con vista previa, emisión con las cuatro declaraciones y detalle con transmisión, documentos y el aviso de la retención; la liquidación en Comprobantes, con el proveedor rotulado como tal.
- **Permisos:** `purchaseSettlements.read`, `purchaseSettlements.draft`, `purchaseSettlements.emit` y `purchaseSettlements.retrySigning` para administrador y operador, y `purchaseSettlements.reconcile` solo para el administrador. La empresa sale siempre de la sesión.
- **Corrección documental:** donde el sistema dice que una liquidación de compra usada como documento sustento de una retención la "emite el proveedor", pasa a decir que la emite el adquirente en los casos que la normativa permite, sin cambiar el comportamiento de la retención.

**Fuera de alcance:**

- Los demás casos oficiales de la liquidación (`purchase-settlement-other-cases`): art. 13 a), b) y g) a j), del exterior; d), reembolsos; e) y f), sector público; k), economía popular y solidaria; l), sin fuente primaria suficiente. Tampoco proveedores con RUC activo ni los casos derogados (negocios populares, RISE). Sin campos parciales.
- La emisión, la precarga o la asociación interna del comprobante de retención (`internal-purchase-settlement-withholding-link`).
- Entradas de inventario por la liquidación (`inventory-entry-from-purchase-settlement`); compras, órdenes de compra, cuentas por pagar y facturas recibidas.
- `reembolsos`, `maquinaFiscal`, `tipoNegociable`, subsidios (`precioSinSubsidio`), `detallesAdicionales`, información adicional, ICE e IRBPNR.
- La firma del RIDE por el proveedor, la carga de un RIDE firmado o una aceptación del proveedor (Q-53).
- Notas de crédito o de débito sobre una liquidación, y la liquidación como sustento de una guía de remisión.
- Una representación neutral de la contraparte en el comprobante genérico (deuda técnica registrada), la corrección de un devuelto (`correct-returned-document`) y la anulación (`cancellation-observation`, Q-16).

## Capabilities

### New Capabilities

- `purchase-settlements`: liquidaciones de compra de la empresa como adquirente en el caso c) del art. 13. Cubre la procedencia y sus declaraciones, el proveedor y su dirección, las líneas con producto opcional o libres, el IVA y el cálculo, los pagos con su plazo, el aviso de la retención, el borrador y la vista previa, la reserva, la idempotencia, la consulta, el reintento de firma, la independencia del inventario, de las compras y de la retención, los límites de recursos, los permisos y el aislamiento.

### Modified Capabilities

- `document-emission`: los tipos que el sistema emite incluyen la liquidación de compra 1.1.0, con su secuencial independiente y su snapshot propio.
- `document-archive`: la bandeja muestra la liquidación con su proveedor y su total, y su RIDE sigue el formato oficial.
- `sri-transmission`: la transmisión y la reconciliación manual atienden la liquidación de compra como los demás tipos.
- `audit-trail`: se auditan la reserva (con las declaraciones de procedencia), la firma, el reintento y la reconciliación manual de una liquidación de compra.
- `withholding-receipts`: la descripción del documento sustento de tipo liquidación de compra dice que la emite el adquirente, sin cambiar el comportamiento.

## Impact

- **Backend:**
  - módulo nuevo `purchase-settlements` (dominio, evaluación, cálculo, borradores, emisión, consultas y rutas), con lecturas de terceros y productos inyectadas por `main.ts`;
  - las primitivas matemáticas de los importes de la factura pasan a un módulo fiscal neutral que comparten la factura y la liquidación, sin cambiar los importes de la factura;
  - `fiscal` elige la auditoría de la reconciliación del tipo 03;
  - `sri-engine` gana el builder `liquidacionCompra` 1.1.0, el mapeo del firmador para el tipo 03 y la lectura y la distribución del RIDE.

  `fiscal`, `invoices`, `inventory`, `credit-notes`, `debit-notes`, `withholding-receipts` y `shipping-guides` no importan `purchase-settlements`, y `purchase-settlements` no importa `invoices`, `inventory` ni otro comprobante.
- **Base de datos:** los borradores de liquidación; el registro inmutable de cada liquidación con su proveedor y sus cuatro declaraciones, con defensa en la base; la operación `purchase_settlement.emit` en el registro de idempotencia. Sin backfill ni cambios en comprobantes existentes, capacidades ni movimientos.
- **API:** `/api/v1/purchase-settlements` (proveedores, opciones, borradores con vista previa, emisión, consulta, transmisión, reintento de firma y reconciliación).
- **Frontend:** pantallas de Liquidaciones de compra y el tipo 03 en Comprobantes.
- **Configuración:** variables nuevas para los límites de líneas y pagos, con sus valores por defecto.
- **Rendimiento:** `bench:purchase-settlements`, fuera de `verify`, antes de cerrar el apply.
- **Documentación:** `fiscal-emission.md`, `backend.md`, `ARCHITECTURE.md`, `database.md`, `access-control.md`, `observability.md`, `performance.md`, `deployment.md`, `decimal-policy.md`, `domain-model.md`, `glossary.md` y `capabilities.md`.
- **Fuentes** (`docs/product/sri-catalogs/fuentes/`):
  - XSD `LiquidacionCompra_V1.1.0` y su verificación (`liquidacion-compra-xsd-verificacion.txt`);
  - ficha técnica v2.34 (`ficha-v2.34-liquidacion-de-compra.txt`): tablas 3, 6, 16, 17 y 24, anexo 17 (páginas 115 a 122) y anexo 2 (página 65);
  - Reglamento de Comprobantes de Venta vigente, arts. 1, 8, 13, 17, 22 y 40 (`reglamento-comprobantes-liquidacion-de-compra.txt`);
  - LRTI, RALRTI y resoluciones de retención y de emisión electrónica (`normativa-liquidacion-retenciones.txt`);
  - ERS RF-250..253, CTX §17 y Q-12.
