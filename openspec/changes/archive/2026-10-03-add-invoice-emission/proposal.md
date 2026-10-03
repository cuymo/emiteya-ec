# Proposal

## Why

Con la empresa configurada, la numeración, la firma, los catálogos, los terceros y los productos
listos, el contribuyente todavía no puede emitir una factura. Este cambio crea el núcleo fiscal
común y la primera factura, hasta el XML firmado y persistido. Es el paso que desbloquea la
transmisión al SRI (cambio 7) y cierra la idempotencia de la emisión (ERS AC-05).

## What Changes

- **Borradores de factura (ERS RF-010).** Un usuario guarda, corrige y elimina borradores sin consumir el secuencial.
  - El borrador lleva el punto de emisión, el comprador (cliente o consumidor final), las líneas de productos y las formas de pago.
  - Muestra totales de vista previa calculados por el servidor.
  - No es un estado fiscal.
- **Emisión de la factura.** La acción explícita de emitir un borrador:
  - captura la fecha de emisión una vez (Q-08);
  - valida todo lo funcional antes de reservar;
  - crea en una sola transacción la factura `RESERVED`, con su snapshot inmutable, secuencial definitivo, clave de acceso e identidad tributaria bloqueada;
  - construye el XML con un builder propio (Q-44), lo valida contra el XSD registrado, lo firma, vuelve a validarlo y persiste los bytes exactos firmados. Con eso llega a `SIGNED` y termina.
- **Cálculo fiscal exacto (Q-14).**
  - Los importes se calculan con decimal exacto y se redondean HALF_UP solo al materializar cada campo a la escala de su XSD.
  - Los totales se construyen con valores ya materializados.
- **Reglas de la primera factura:**
  - impuestos de los productos resueltos por la fecha del documento;
  - rechazo antes de reservar de ICE, IRBPNR e IVA diferenciado sin datos de cálculo;
  - consumidor final hasta el monto de la política vigente, sobre `importeTotal`;
  - formas de pago del catálogo;
  - campos del emisor de la matriz de casos especiales: `agenteRetencion`, `contribuyenteRimpe`, contribuyente especial y obligado a llevar contabilidad;
  - casos especiales no soportados rechazados antes de reservar.
- **Idempotencia durable (Q-30, ERS RF-520..522).**
  - `Idempotency-Key` obligatoria, con alcance empresa, operación y clave, y la huella canónica de la solicitud.
  - Repetir la solicitud devuelve o reanuda la misma factura y nunca reserva otro número. Otra solicitud con la misma clave es `409 IDEMPOTENCY_KEY_REUSED`.
- **Recuperación de `RESERVED`.**
  - Un fallo después del commit deja la factura en `RESERVED`, con el diagnóstico del último intento separado del estado fiscal.
  - Un reintento autorizado reutiliza la factura, el snapshot, el secuencial y la clave. No hay reintentos automáticos.
- **Validación XSD empaquetada.**
  - Los XSD oficiales y el import de la firma se empaquetan con el artefacto de build y se verifican por hash.
  - El registro de esquemas incluye todos los archivos que resuelven una validación.
  - La validación tiene concurrencia, cola y plazo acotados.
- **Consulta de facturas.** Listado y detalle bajo `/api/v1/invoices`, con el estado, el número, la clave y el diagnóstico.
- **Pantallas.** `Facturas` y `Borradores`: editor de borrador a página completa, emisión con confirmación, listado y detalle con reintento.
- **Benchmark de la emisión (Q-26).** Ruta local hasta `SIGNED` con 100 000 facturas por empresa y 10 usuarios concurrentes, medida por etapa en un entorno registrado.

Fuera de alcance:
- **Transmisión:** envío al SRI, recepción, autorización, polling, jobs, reconciliación y reintentos de red (cambio 7).
- **Documentos y archivo:** RIDE, descarga del XML y bandeja documental (cambio 8), y los otros cinco comprobantes.
- **Inventario:** descuento de stock (ERS RF-205, RF-206, cambio 9).
- **Contenido de la factura no admitido:**
  - ICE, IRBPNR e IVA diferenciado mientras sus datos de cálculo sigan incompletos;
  - la línea manual sin producto del catálogo (ERS RF-202): requisito fuente diferido, cuyas reglas no están definidas (Q-46); es distinta de modificar el precio de un producto (Q-45);
  - `infoAdicional`, porque no hay requisito fuente;
  - reembolsos, exportación, propina, plazo de pago y factura 2.0.0 o 2.1.0.
- **Compuertas del cambio 7, previas a la transmisión:** el vector oficial de la clave de acceso, la parte online de S-3, un P12 ecuatoriano real y un RUC habilitado en el ambiente de Pruebas del SRI. No bloquean este cambio, que no transmite.

## Capabilities

### New Capabilities

- `document-emission`: emisión local de un comprobante electrónico hasta el artefacto firmado.
  - Validación completa antes de reservar y fecha capturada una vez.
  - `RESERVED` atómico con snapshot inmutable, secuencial, clave de acceso e identidad tributaria bloqueada.
  - XML validado contra el XSD registrado, firma y artefacto firmado exacto que define `SIGNED`.
  - Idempotencia durable, recuperación de `RESERVED` y registro de transiciones.
- `invoices`: la factura (código `01`, XSD 1.1.0):
  - borradores y su contenido, y el cálculo exacto;
  - impuestos por la fecha del documento, consumidor final y formas de pago;
  - campos del emisor e importes exactos en el XML;
  - consulta, permisos y aislamiento por empresa.

### Modified Capabilities

- `fiscal-catalogs`: el registro de esquemas XSD incluye todos los archivos necesarios para resolver una validación, también el import `xmldsig-core-schema.xsd`, con su fuente, revisión, hash y ruta lógica.
- `audit-trail`: auditoría de la emisión de facturas: reserva, firma y cada intento de firma que un usuario inicia sobre una factura reservada.

## Impact

- **Backend:**
  - Módulo nuevo `invoices`: borradores, emisión de la factura, snapshot, cálculo y API.
  - Núcleo de documentos en `fiscal`: comprobante, transiciones y artefacto firmado.
  - Registro de idempotencia en `platform`.
  - `sri-engine`: builder propio, clave de acceso, validador XSD conectado y tarea de firma de XML en el pool criptográfico.
  - Lecturas internas nuevas en `taxpayer`, `parties`, `products`, `catalogs` y `signing`.
  - Primitivas exactas en `platform/decimal`.
- **Base de datos:**
  - Tablas nuevas de borradores (cabecera, líneas y pagos), comprobante electrónico, transiciones, artefacto y registro de idempotencia.
  - Cambio del registro de esquemas para incluir los imports.
  - Triggers de inmutabilidad, de solo agregado y de `SIGNED` con artefacto.
- **Datasets:** `schema-registry` versión 2.
- **API:**
  - `/api/v1/invoices/drafts`, `/api/v1/invoices`, `/api/v1/invoices/{id}` y `/api/v1/invoices/{id}/signing-attempts`, en OpenAPI.
  - La vista del registro de esquemas muestra los imports.
- **Permisos:** `invoices.read`, `invoices.draft`, `invoices.emit` e `invoices.retrySigning`.
- **Frontend:** `Facturas` y `Borradores` en el grupo `Operación`, y un selector con búsqueda compartido.
- **Build:** los XSD se copian al artefacto del backend, con una comprobación posterior al build.
- **Dependencias:** ninguna nueva. Se usan `facturacion-electronica-ec` (clave de acceso y firma, ADR 0018) y `xmllint-wasm` (ADR 0021), ya fijadas.
- **Documentación:**
  - `fiscal-emission.md`, `database.md`, `decimal-policy.md`, `access-control.md` e `idempotency.md` (se alinea con Q-30);
  - `capabilities.md` y el benchmark de la emisión.
