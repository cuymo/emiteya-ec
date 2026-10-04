# Proposal

## Why

Una factura autorizada hoy se queda en la base de datos: el administrador y el operador no pueden
descargar su RIDE ni sus XML, buscarla en una bandeja documental ni saber qué se entregó. Sin eso
no se cumplen ERS AC-07 (documento autorizado descargable después, con XML, RIDE y trazabilidad) ni
la parte del RIDE de AC-02. El cambio 7 dejó el comprobante autorizado con su XML y su autorización
inmutables, el spike S-4 y el ADR 0022 validaron cómo producir el RIDE, y Q-24 quedó resuelta: el
correo no entra.

## What Changes

- **Bandeja de comprobantes.** Lista los comprobantes fiscales persistidos de la empresa desde que se reservan, nunca los borradores.
  - Muestra todos los estados: reservado, firmado, los de transmisión, autorizado, no autorizado, devuelto y revisión manual.
  - Filtros de ERS RF-402: fecha, tipo, estado, identificación, número, establecimiento y punto.
  - Muestra el estado visible y los documentos disponibles. Las acciones dependen del estado.
  - Se diseña sobre el comprobante genérico; hoy solo existe la factura.
  - El detalle y el historial de transmisión reutilizan los de la factura.
- **RIDE generado una vez y persistido.**
  - Un trabajo durable, deduplicado por comprobante, queda programado en la misma operación que autoriza el comprobante.
  - Un barrido idempotente cubre los autorizados sin RIDE y respeta las generaciones detenidas.
  - El RIDE se dibuja en un pool de workers acotado, nunca en una petición HTTP.
  - Se guarda como artefacto inmutable `RIDE_PDF`, con:
    - sus bytes exactos, su hash, su tamaño y su tipo;
    - las versiones del renderer, del código de barras y de las fuentes;
    - el artefacto de origen y su hash.

    Nunca se regenera: un RIDE histórico no cambia cuando cambian las librerías o la fuente.
  - Un fallo al generar es un estado operativo del trabajo, nunca del comprobante, que sigue autorizado. Una generación detenida se puede reintentar mientras no exista el RIDE.
- **Fuente del RIDE.** Sale del XML autorizado y de los metadatos inmutables de la autorización.
  - Si el SRI autorizó de forma concluyente sin devolver el comprobante, sale del XML firmado: es el mismo artefacto transmitido, con su integridad verificada.
  - La procedencia queda registrada como `AUTHORIZED_XML` o `SIGNED_XML_FALLBACK`.
  - Nunca se leen terceros, productos, configuración tributaria ni catálogos vigentes.
  - Lo que el XML no trae (denominación de la forma de pago, logo) sale solo del snapshot o de la configuración inmutable ya asociados al comprobante.
- **Contenido** del anexo 2 de la ficha v2.34 (ADR 0022), para la factura 1.1.0 que el sistema emite, con IVA:
  - la clave de acceso como texto y como Code128 que se decodifica exactamente igual;
  - fuentes embebidas, sin sustitución silenciosa de caracteres;
  - importes tomados del texto exacto del XML, sin convertirlos ni recalcularlos.
  - Un comprobante con contenido que el sistema no emite (ICE, IRBPNR, propina, información adicional) no recibe RIDE, en lugar de perder ese contenido. El RIDE no amplía lo que la emisión soporta.
- **Descargas verificadas.**
  - Qué se puede descargar:
    - el RIDE, solo autorizado y con RIDE generado;
    - el XML autorizado, solo si el SRI lo devolvió;
    - el XML firmado, siempre presentado como XML firmado, nunca como autorizado.
  - Antes de servir, se comprueban la empresa, la asociación con el comprobante, el hash y el tamaño.
  - Se sirven los bytes guardados, con un nombre de archivo determinista y seguro.
- **Impresión** del mismo RIDE guardado, sin versión propia. La solicitud es una acción explícita, distinta de la lectura del RIDE: registra que se pidió, nunca que se imprimió, y ninguna lectura la registra.
- **Historial de entregas observables**, de solo agregado y separado de la auditoría.
  - Eventos: `DOWNLOAD` (la aplicación inició una respuesta autorizada con el documento, no que el cliente lo guardó) y `PRINT_REQUESTED` (un usuario pidió imprimir).
  - Cada evento guarda el comprobante, el tipo y el hash del artefacto, el actor y el momento, nunca sus bytes.
  - Ningún evento significa que el receptor recibió el documento.
- **Permisos** para consultar la bandeja, descargar e imprimir, y reintentar una generación detenida. Siguen la matriz vigente ("Consultar la bandeja y descargar XML y RIDE"): administrador y operador.
- **Observabilidad segura:**
  - trabajos de RIDE pendientes y su antigüedad;
  - duración del render, separada de la espera en cola;
  - fallos y autorizados sin RIDE;
  - cuentas de descargas y solicitudes de impresión.

  Nunca bytes, XML, claves completas ni datos del comprador.
- **Puerto de notificación** como punto de extensión para el correo futuro, sin implementación.

Fuera de alcance:
- **Correo** (Q-24, P1): ningún proveedor SMTP, envío, plantillas, reintentos ni rebotes.
- **Anulaciones** (Q-16) y **corrección de devueltos** (BR-28).
- **Los otros cinco comprobantes**: la bandeja y los artefactos se diseñan sobre el comprobante genérico, pero solo la factura existe hoy.
- **Regenerar** un RIDE ya generado, o generar RIDE para comprobantes no autorizados.
- **Descarga de las respuestas originales del SRI**: siguen siendo evidencia interna.
- Reportes y exportación XLSX (cambio de reportes) y exportación de datos (portabilidad).

## Capabilities

### New Capabilities

- `document-archive`: bandeja documental y conservación de los documentos de cada comprobante.
  - Bandeja de comprobantes fiscales con filtros y estado visible.
  - RIDE generado una vez desde la fuente canónica y guardado como artefacto inmutable.
  - Descargas verificadas del RIDE y de los XML, e impresión del mismo RIDE.
  - Historial de entregas observables y sus permisos.

### Modified Capabilities

Ninguna. La consulta de la factura y su historial de transmisión (`invoices`, `sri-transmission`) se
reutilizan sin cambiar sus requisitos. La generación del RIDE al autorizar es un requisito de
`document-archive`.

## Impact

- **Backend:**
  - `sri-engine`: la lectura del XML para el RIDE y el renderer (pdfmake, bwip-js), con las fuentes y sus hashes (ADR 0022);
  - `fiscal`: el trabajo `document.render_ride`, su programación al autorizar, el barrido, el artefacto `RIDE_PDF`, la bandeja, las descargas y el historial de entregas;
  - la programación al autorizar entra por un seguidor genérico de las transiciones, compuesto al arrancar: la transmisión no depende del archivo;
  - `platform/workers`: una primitiva de pool genérica con dos instancias independientes, la criptográfica existente y la del RIDE.
- **Comprobaciones del artefacto de ejecución:** `check:ride-assets` (fuentes y manifiesto), separado de `check:xsd-artifact`, y readiness propia del RIDE.
- **Base de datos:**
  - el tipo de artefacto `RIDE_PDF` con su tipo de medio;
  - una tabla de entregas de solo agregado;
  - el tipo de trabajo nuevo;
  - índices para los filtros de la bandeja.
- **API** bajo `/api/v1/documents`: la bandeja, el resumen de documentos de un comprobante, las descargas del RIDE y de los XML, la solicitud de impresión, el historial de entregas y el reintento de una generación detenida. Sin endpoints técnicos de generación.
- **Permisos:** `archive.read`, `archive.download` y `archive.retryRide`.
- **Configuración:** workers, cola y plazo del render, e intentos y espera de su trabajo. Es configuración operativa.
- **Frontend:**
  - la pantalla `Comprobantes` (bandeja) en "Operación";
  - en el detalle de la factura, la sección de documentos con la descarga, la impresión y el historial de entregas.
- **Dependencias:** pdfmake 0.3.11, bwip-js 4.11.4 y fontkit 2.0.4 en runtime. En pruebas, pdfjs-dist 6.3.289, @napi-rs/canvas 1.0.10 y zxing-wasm 3.1.4. Todas con versión exacta (ADR 0022).
- **Documentación:**
  - `fiscal-emission.md`, `backend.md`, `database.md`, `deployment.md`, `observability.md`, `stack.md` y `ARCHITECTURE.md`;
  - `access-control.md`, `domain-model.md`, `glossary.md` y `capabilities.md`.
