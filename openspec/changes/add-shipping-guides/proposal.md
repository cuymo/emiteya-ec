# Proposal

## Why

Una empresa que traslada mercadería, porque vende y entrega, mueve bienes entre sus
establecimientos, los envía en consignación o los lleva a una exhibición, no puede emitir con el
sistema la guía de remisión que sustenta ese traslado dentro del país. El Reglamento de Comprobantes
de Venta exige la guía antes del traslado y define su contenido (arts. 27 a 38), y hoy queda fuera
del sistema: sin número, sin XML autorizado y sin evidencia. Es el cambio 13 de `capabilities.md`.
Q-51 está resuelta (P1 a P10) y el XSD 1.1.0 se verificó contra el portal del SRI (2026-10-06).

## What Changes

- **Guía de remisión 1.1.0** (`codDoc` 06, raíz `guiaRemision`): un comprobante propio con su secuencial independiente por establecimiento, punto y tipo, su clave de acceso y su snapshot inmutable. Su XML es determinista y se valida contra `GuiaRemision_V1.1.0.xsd`. Después siguen la firma, la transmisión, la reconciliación, la autorización, el RIDE y el archivo, con el pipeline compartido. La emite siempre la empresa como remitente.
- **Transportista con origen explícito** (P4):
  - `SELF`: transporte propio con la identidad tributaria de la empresa (RUC, tipo 04, razón social), sin un tercero artificial;
  - `PARTY`: un tercero activo con el rol de transportista, identificado con RUC, cédula o pasaporte, con una identificación de hasta 13 caracteres (ficha v2.34, anexo 3). Un tercero sin ese rol no se puede elegir hasta que el usuario lo configure; la guía nunca asigna roles.
- **Una placa** por guía (P5): texto fiscal de hasta 20 caracteres, sin formato vehicular inventado.
- **Fechas del transporte:** la de inicio no es anterior a la fecha de emisión de la guía (requisito oficial, error 82 de la ficha) y la de fin no es anterior a la de inicio (validación del proyecto), sin duración máxima.
- **Partida:** un establecimiento propio activo elegido como origen, del que se deriva y congela la dirección, o un texto libre que el borrador propone desde el establecimiento del punto.
- **Uno o más destinatarios** (P3), cada uno con su dirección, su motivo del traslado (texto libre), su ruta opcional y su detalle:
  - un tercero activo identificado con RUC, cédula o pasaporte, sin rol obligatorio y sin asignarle el de cliente; nunca el consumidor final ni una identificación del exterior;
  - o la propia empresa, en un traslado entre establecimientos propios (P2): la guía elige un establecimiento de origen y el destinatario uno de destino, ambos propios, activos y distintos, sin compararlos con el establecimiento emisor; la partida sale del origen y la dirección y el código de destino, del destino. Una dirección libre no registrada no prueba este caso.
- **Sustento tipado por destinatario** (P1), exactamente uno de:
  - una factura propia (`INTERNAL_INVOICE`), de la misma empresa y del mismo ambiente, autorizada e íntegra, de la que el sistema toma el tipo, el número, la autorización y la fecha;
  - una excepción declarada por el usuario (`DECLARED_EXCEPTION`) del art. 30, numeral 8, del Reglamento: cantidad o precio determinado después del traslado, consignación, traslado entre establecimientos propios o exhibición y demostración, con su caso, la versión de la política, el actor y el momento, fuera del XML.

  Varias guías pueden referenciar una factura y una guía puede llevar facturas distintas en destinatarios distintos. Una factura a consumidor final es sustento con un destinatario identificado, sin copiar al consumidor final (política del MVP). No hay saldo por despachar ni cambios en la factura.
- **Detalle sin precios** (P6, P7): descripción obligatoria con la unidad y las características, producto opcional (activo y de tipo bien) con sus códigos congelados, o una línea libre; cantidad decimal exacta mayor que cero, de hasta 6 decimales, sin redondeo. Las mercancías de una factura se pueden cargar como sugerencia no autoritativa: las líneas que hoy se resuelven como bien se proponen, las demás se ofrecen como línea libre con sus datos históricos, y el usuario confirma lo que realmente se traslada.
- **Sin total monetario ni receptor único** (P10): el comprobante genérico guarda la guía sin total y sin un receptor que la represente; la bandeja muestra el nombre de su único destinatario o "N destinatarios", sin importe, y el filtro por identificación encuentra la guía por cualquiera de sus destinatarios. Los demás tipos siguen exigiendo su total y su receptor.
- **Sin inventario** (P8): la guía no reserva, descuenta, devuelve ni ajusta stock ni crea movimientos.
- **Límites de recursos configurables y compuestos** (P9): destinatarios por guía (10, hasta 50), detalles por destinatario (50, hasta 100) y detalles por guía (100, hasta 300). Son defensas del producto, no límites del SRI ni del XSD, y no interpretan Q-47. Una segunda capa, de transporte, acompaña a esos límites: las dos rutas que reciben el borrador completo (crearlo y actualizarlo) admiten un cuerpo JSON de hasta 2 MiB, para que los máximos absolutos sean alcanzables por HTTP; el resto de la API conserva su límite global de 100 KB. Tampoco es un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47.
- **Pipeline compartido:** reserva, perfil de firma, registro de esquemas, firmador, jobs durables, SOAP, respuesta guardada antes de clasificar, reconciliación, bandeja, descargas, RIDE e historial de entregas, sin un pipeline paralelo. La factura, las notas y la retención no cambian, byte a byte.
- **RIDE propio** con la distribución oficial (ficha v2.34, anexo 2, página 64): transporte, un bloque por destinatario con su sustento y su detalle, sin importes.
- **Pantallas:** Guías de remisión con lista, borrador con vista previa, emisión con la declaración de las excepciones y detalle con transmisión y documentos; la acción "Nueva guía de remisión" desde una factura autorizada; la guía en Comprobantes.
- **Permisos:** `shippingGuides.read`, `shippingGuides.draft`, `shippingGuides.emit` y `shippingGuides.retrySigning` para administrador y operador, y `shippingGuides.reconcile` solo para el administrador. La empresa sale siempre de la sesión.

**Fuera de alcance:**

- La venta itinerante y los comprobantes de venta externos como sustento (`external-supporting-documents`), y la liquidación de compra propia como sustento, que puede llegar después de `add-purchase-settlements`.
- `detallesAdicionales` (`shipping-guide-additional-details`).
- Varios vehículos, placas o conductores (`shipping-guide-multiple-vehicles`).
- Stock por establecimiento o ubicación y logística (`location-stock`); saldo por despachar de una factura.
- Guías emitidas por el transportista o el destinatario en nombre de un tercero, y un campo de conductor aparte del transportista que el XML 1.1.0 no expresa.
- Traslados entre una bodega no registrada y un establecimiento como excepción de establecimientos propios.
- Identificación del exterior, documento aduanero, importación, exportación y regímenes especiales; combustibles; máquina fiscal; factura sustitutiva de guía; emisor itinerante; interrupción del transporte. Sin campos parciales.
- Información adicional en el XML, la referencia de la factura a la guía (`infoFactura/guiaRemision`), la corrección de una guía devuelta (`correct-returned-document`) y la anulación (`cancellation-observation`, Q-16).

## Capabilities

### New Capabilities

- `shipping-guides`: guías de remisión de la empresa como remitente. Cubre el transportista propio o tercero, la placa, las fechas y la dirección de partida, los destinatarios externos o la propia empresa, el motivo, la ruta y el establecimiento de destino, el sustento por factura propia o por excepción declarada, el detalle sin precios y sus cantidades, el borrador y la vista previa, la reserva, la idempotencia, la consulta, el reintento de firma, la independencia del inventario y de las facturas, los límites de recursos, los permisos y el aislamiento.

### Modified Capabilities

- `document-emission`: los tipos que el sistema emite incluyen la guía de remisión 1.1.0, con su secuencial independiente y su snapshot propio; la guía no tiene total monetario ni un receptor único.
- `document-archive`: la bandeja muestra la guía sin total y con sus destinatarios, el filtro por identificación la encuentra por cualquiera de ellos, y el RIDE de la guía sigue su formato oficial.
- `sri-transmission`: la transmisión y la reconciliación manual atienden la guía de remisión como los demás tipos.
- `audit-trail`: se auditan la reserva (con las excepciones declaradas), la firma, el reintento y la reconciliación manual de una guía de remisión.

## Impact

- **Backend:**
  - módulo nuevo `shipping-guides` (dominio, evaluación, borradores, emisión, consultas y rutas), con lecturas de terceros, de facturas y de establecimientos inyectadas por `main.ts`;
  - `fiscal` admite un comprobante sin total ni comprador, guarda sus destinatarios para la bandeja y elige la auditoría de la reconciliación del tipo 06;
  - `sri-engine` gana el builder `guiaRemision` 1.1.0 y la lectura y la distribución del RIDE.

  `fiscal`, `invoices`, `inventory`, `credit-notes`, `debit-notes` y `withholding-receipts` no importan `shipping-guides`, y `shipping-guides` no importa `inventory` ni otro comprobante.
- **Base de datos:** el total y el comprador del comprobante genérico pasan a ser nulos solo para el tipo 06, con su invariante para los demás; los destinatarios de un comprobante para la bandeja; los borradores de guía; el registro inmutable de cada guía y de sus destinatarios con su sustento, con defensa en la base; la operación `shipping_guide.emit` en el registro de idempotencia. Sin backfill ni cambios en comprobantes existentes, capacidades ni movimientos.
- **API:** `/api/v1/shipping-guides` (transportistas, destinatarios, facturas elegibles y sus bienes, opciones, borradores con vista previa, emisión, consulta, transmisión, reintento de firma y reconciliación). La bandeja `/documents` cambia su contrato: total y comprador nulos para la guía y un resumen de destinatarios.
- **Frontend:** pantallas de Guías de remisión, la acción desde la factura y el tipo 06 en Comprobantes.
- **Configuración:** variables nuevas para los límites de recursos, con sus valores por defecto.
- **Rendimiento:** `bench:shipping-guides`, fuera de `verify`, antes de cerrar el apply.
- **Documentación:** `fiscal-emission.md`, `backend.md`, `ARCHITECTURE.md`, `database.md`, `access-control.md`, `observability.md`, `performance.md`, `deployment.md`, `decimal-policy.md`, `domain-model.md`, `glossary.md` y `capabilities.md`.
- **Fuentes** (`docs/product/sri-catalogs/fuentes/`):
  - XSD `GuiaRemision_V1.1.0` y su verificación (`guia-remision-xsd-verificacion.txt`);
  - ficha técnica v2.34 (`ficha-v2.34-guia-de-remision.txt`): tablas 3 y 6, tablas 13 y 15 del facturador gratuito, error 82, anexo 2 (página 64) y anexo 3 (páginas 70 y 71);
  - Reglamento de Comprobantes, arts. 27 a 38 (`reglamento-comprobantes-arts-27-38.txt`);
  - ERS RF-240..243, CTX §15 y Q-51.
