# Proposal

## Why

Un contribuyente designado agente de retención que paga a sus proveedores con el sistema no puede
emitir el comprobante que acredita las retenciones del impuesto a la renta y del IVA que practica.
El Reglamento de Comprobantes de Venta exige emitirlo al pagar o acreditar en cuenta (arts. 3, 8 y
40), y hoy queda fuera del sistema: sin número, sin XML autorizado y sin evidencia. Es el cambio 12
de `capabilities.md`; Q-50 está resuelta y el XSD 2.0.0 se verificó contra el portal del SRI
(2026-10-05).

## What Changes

- **Comprobante de retención 2.0.0** (`codDoc` 07, raíz `comprobanteRetencion`, esquema ATS): un comprobante propio con su secuencial por establecimiento, punto y tipo, su clave de acceso y su snapshot inmutable. Su XML es determinista y se valida contra `ComprobanteRetencion_V2.0.0.xsd`. Después siguen la firma, la transmisión, la reconciliación, la autorización, el RIDE y el archivo, con el pipeline compartido.
- **Sujeto retenido:** un proveedor residente registrado como tercero con el rol de proveedor, identificado con RUC, cédula o pasaporte. Nunca el consumidor final, que la ficha v2.34 excluye, ni una identificación del exterior. Se puede crear desde la retención con el diálogo de terceros existente.
- **`parteRel`:** declaración obligatoria SI/NO del usuario en cada comprobante, nunca inferida del tercero ni presentada como verificada.
- **Período fiscal** explícito (`MM/AAAA`), obligatorio:
  - la interfaz preselecciona el mes de la fecha de emisión y el usuario puede cambiarlo antes de reservar;
  - no puede ser posterior al mes de emisión (validación del proyecto);
  - si difiere del mes de emisión, se muestra antes de emitir y nunca se corrige.
- **Uno o más documentos sustento** por comprobante, como referencias estructuradas externas que el usuario declara:
  - tipos `01` factura, `02` nota de venta y `03` liquidación de compra (política del MVP);
  - cada uno con su tipo como código fiscal de dos caracteres (`01`, `02`, `03`), su código de sustento compatible según el Catálogo ATS, su número, su fecha, su autorización cuando corresponda, sus totales, sus impuestos (IVA, ICE e IRBPNR, como información tributaria declarada del documento) y sus formas de pago.

  El sistema no verifica su existencia ni crea facturas recibidas, compras ni cuentas por pagar.
- **Retenciones por documento sustento**, anidadas como en el esquema ATS: renta e IVA.
  - **Renta:** solo los conceptos para pagos a residentes con porcentaje numérico fijo del Catálogo ATS, vigentes en la fecha de emisión y fuera de las estructuras excluidas. El dataset oficial del 06/08/2026 da 59 seleccionables de 127 (design D7); el número sale del dataset, no del código.
  - **IVA:** los códigos de la tabla 20 de la ficha con porcentaje fijo, incluido el 7 de retención en cero, que produce una retención explícita de valor 0.00; el 8, "no procede retención", se conserva en el catálogo pero no es seleccionable porque la fuente no define su semántica dentro del comprobante (design D8).
  - ICE e IRBPNR solo aparecen como impuestos declarados del documento sustento: no se retienen.
  - El usuario elige el concepto y escribe la base. El servidor resuelve el código, la denominación, el porcentaje y su vigencia con la fecha de emisión, y calcula el valor retenido con un solo cálculo versionado. El cálculo es decimal exacto con HALF_UP a 2 decimales, el mismo para la vista previa, el snapshot, el XML y el RIDE.
- **Catálogos versionados** en `fiscal-catalogs`, sin sincronización en tiempo de ejecución:
  - impuestos a retener (tabla 19) y retención del IVA (tabla 20) de la ficha v2.34;
  - conceptos de la renta del Catálogo ATS, completos, cada uno con su clasificación de alcance;
  - tipos de documento sustento y códigos de sustento del Catálogo ATS, con su compatibilidad.

  Los impuestos del sustento y sus formas de pago reutilizan los catálogos existentes (`tax`, `iva-rate`, `ice-rate`, `irbpnr-rate` y `payment-method`, este último equivalente a la tabla 13 del ATS, comprobado). El Catálogo ATS oficial se archiva como extracto normalizado con su URL, su fecha, su SHA-256 y la derivación de cada dataset.
- **Límites de recursos configurables** para documentos sustento, retenciones, impuestos y pagos por documento: son defensas del producto, no límites del SRI, y no tienen relación con el límite de tamaño del envío (Q-47 sigue abierta y la transmisión real sigue cerrada). Sus valores por defecto se confirman con el benchmark de CPU, memoria y latencia.
- **Pipeline compartido:** reserva, firma, firmador, transmisión SOAP, cola, máquina de estados, reconciliación, bandeja, descargas y RIDE. La factura y las notas de crédito y de débito no cambian, byte a byte.
- **RIDE propio** con la distribución oficial (ficha v2.34, anexo 2, página 63), con una fila por retención y los datos de su documento sustento. La bandeja trata los tipos 01, 04, 05 y 07.
- **Pantallas:** Retenciones, con lista, borrador con vista previa y detalle con transmisión y documentos; la retención en Comprobantes.
- **Permisos:** `withholdings.read`, `withholdings.draft`, `withholdings.emit` y `withholdings.retrySigning` para administrador y operador, y `withholdings.reconcile` solo para el administrador. La empresa sale siempre de la sesión.

**Fuera de alcance:**

- El ISD (`withholding-isd`, pendiente de evidencia para elegir la tarifa).
- Pagos al exterior, identificación del exterior, convenios de doble tributación y `tipoSujetoRetenido` (`withholding-foreign-payments`).
- Reembolsos, dividendos, compra de cajas de banano y autorretenciones (`withholding-special-supports`).
- Conceptos de renta con porcentaje variable, textual, por rango, por mil o dependiente de convenio (`withholding-variable-rate-concepts`), y los de no residentes.
- Retenciones de ICE o IRBPNR, documentos sustento distintos de 01, 02 y 03, y la asociación interna con una liquidación propia, que llegará con `add-purchase-settlements` sin cambiar la representación fiscal guardada.
- Los conceptos de renta `323 M`, `323 N`, `323 O` y `323 P`, cuya representación exacta del código la fuente no establece: pendientes de evidencia y de soporte futuro.
- Compras, cuentas por pagar, ATS y declaraciones (ERS §2.3).
- Corrección de una retención devuelta (`correct-returned-document`) y anulación (`cancellation-observation`, Q-16).
- Información adicional, máquina fiscal y fecha de registro contable en el XML.

## Capabilities

### New Capabilities

- `withholding-receipts`: comprobantes de retención de renta e IVA a proveedores residentes. Cubre el sujeto retenido, `parteRel`, el período fiscal, los documentos sustento externos con sus impuestos y pagos, las retenciones por documento con su concepto del catálogo, el cálculo exacto, el borrador y la vista previa, la reserva, la idempotencia, la consulta, el reintento de firma, la independencia del inventario y de las facturas, los límites de recursos, los permisos y el aislamiento.

### Modified Capabilities

- `fiscal-catalogs`: los catálogos oficiales incluyen los impuestos a retener, la retención del IVA, los conceptos de la renta con su clasificación de alcance, los tipos de documento sustento y los códigos de sustento, y la empresa puede habilitar o deshabilitar los conceptos de retención.
- `document-emission`: los tipos que el sistema emite incluyen el comprobante de retención 2.0.0, con su secuencial independiente y su snapshot propio.
- `sri-transmission`: la transmisión y la reconciliación manual atienden el comprobante de retención como los demás tipos.
- `document-archive`: el RIDE del comprobante de retención sigue su formato oficial, y la bandeja y los documentos lo incluyen.
- `audit-trail`: se auditan la reserva, la firma, el reintento y la reconciliación manual de un comprobante de retención.

## Impact

- **Backend:**
  - módulo nuevo `withholding-receipts` (dominio, cálculo, borradores, emisión, consultas y rutas);
  - `catalogs` gana los datasets y su cargador para los catálogos de retención;
  - `sri-engine` gana el builder `comprobanteRetencion` 2.0.0 y la lectura y la distribución del RIDE;
  - `fiscal` elige la auditoría de la reconciliación del tipo 07.

  `fiscal`, `invoices`, `inventory`, `credit-notes` y `debit-notes` no importan `withholding-receipts`.
- **Base de datos:**
  - borradores de retención;
  - el registro inmutable de cada comprobante con su período, su sujeto y sus líneas de retención, con defensa en la base;
  - los catálogos nuevos en las tablas de catálogos fiscales;
  - la operación `withholding_receipt.emit` en el registro de idempotencia.

  Sin cambios a facturas, notas, capacidades ni movimientos.
- **API:** `/api/v1/withholding-receipts` (proveedores, borradores con vista previa, emisión, consulta, transmisión, reintento de firma y reconciliación). La bandeja `/documents` no tiene rutas nuevas.
- **Frontend:** pantallas de Retenciones, el tipo 07 en Comprobantes y los catálogos de retención en Catálogos fiscales.
- **Configuración:** variables nuevas para los límites de recursos, con valores por defecto.
- **Rendimiento:** `bench:withholding-receipts`, fuera de `verify`.
- **Documentación:** `fiscal-emission.md`, `backend.md`, `ARCHITECTURE.md`, `database.md`, `access-control.md`, `observability.md`, `performance.md`, `deployment.md`, `decimal-policy.md`, `domain-model.md`, `glossary.md`, `capabilities.md` y `sri-catalogs/`.
- **Fuentes:**
  - XSD `ComprobanteRetencion_V2.0.0` y su verificación (`sri-catalogs/fuentes/comprobante-retencion-xsd-verificacion.txt`);
  - ficha técnica v2.34: página 13 (sujeto identificado), tablas 19 y 20 (páginas 32 y 33), página 34 (renta del Catálogo ATS), anexo 10 (páginas 104 a 108) y RIDE (anexo 2, página 63);
  - Catálogo ATS del 06/08/2026;
  - Reglamento de Comprobantes, arts. 3, 8 y 40 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-3-8-40.txt`);
  - ERS RF-230..234, CTX §16 y Q-50.
