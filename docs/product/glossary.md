# Glosario

Vocabulario del producto. La interfaz usa el término del SRI en español; el código usa el
identificador en inglés, alineado con el modelo conceptual del ERS (§13).

Las fuentes se citan con prefijo, porque ambos documentos usan los mismos identificadores
`SRI-0x` para documentos distintos:

- `ERS`: `project-requirements.md`, requisitos y alcance del producto.
- `CTX`: `project-sri-integration.md`, contexto técnico de integración con el SRI.

## Contribuyente y estructura de emisión

| Término (UI)            | Identificador en código         | Significado                                                                                                                              |
| ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Empresa / Contribuyente | `company`                       | Contribuyente emisor configurado en la instalación. Es el tenant de todos los datos privados (ADR 0009).                                 |
| RUC                     | `ruc`                           | Registro Único de Contribuyentes: 13 dígitos terminados en `001` (XSD). No se rechaza por un dígito verificador local (CTX §9.1).        |
| Razón social            | `legalName`                     | Nombre legal de la empresa o de un tercero.                                                                                              |
| Nombre comercial        | `tradeName`                     | Nombre comercial opcional.                                                                                                               |
| Dirección matriz        | `headOfficeAddress`             | Dirección principal registrada en el SRI.                                                                                                |
| Atributos tributarios   | `taxProfile`                    | Obligado a llevar contabilidad, contribuyente especial, agente de retención, gran contribuyente, régimen RIMPE y demás leyendas que exija la ficha vigente (CTX §5). Los declara el administrador; nunca se infieren. |
| Agente de retención     | `withholdingAgentResolution`    | Número de la resolución que designa al agente de retención (XSD `agenteRetencion`, hasta 8 dígitos; C-10).                               |
| RUC proveedor           | `providerRuc`                   | RUC del proveedor del sistema de facturación, exigido por el Anexo 26 cuando el contribuyente usa un sistema de un tercero. Opcional; nunca se llena con un valor ficticio (CTX §37). |
| Establecimiento         | `establishment`                 | Local registrado en el SRI, con código de tres dígitos.                                                                                  |
| Punto de emisión        | `emissionPoint`                 | Punto de un establecimiento desde el que se emite, con código de tres dígitos. Disponible solo si él y su establecimiento están activos.  |
| Secuencial              | `fiscalSequence` / `sequential` | Número de nueve dígitos por ambiente, establecimiento, punto y tipo de comprobante: cada ambiente tiene su propio contador y la unicidad incluye el ambiente (CTX §5, ADR 0003). |
| Número de comprobante   | `documentNumber`                | `EEE-PPP-SSSSSSSSS`: establecimiento, punto de emisión y secuencial.                                                                     |
| Ambiente                | `environment`                   | `Pruebas` (`TEST`) o `Producción` (`PRODUCTION`). Solo Producción tiene validez tributaria.                                              |
| Preparación para emitir | `emissionReadiness`             | Verificación que habilita la emisión: datos de la empresa registrados, al menos un punto de emisión disponible y certificado vigente. El ambiente siempre está definido, Pruebas por defecto. |
| Identidad tributaria bloqueada | `taxIdentityLocked`      | Estado permanente tras el cual el RUC de la empresa ya no puede cambiar; otro RUC exige otra empresa (Q-31). El cambio de emisión fija la transición que lo activa. |
| Versión de configuración | `companyConfigVersion`         | Fotografía inmutable y completa de los datos, atributos, ambiente y logo de la empresa; los comprobantes referencian la vigente al emitir (CTX §39). |
| Asset de configuración  | `configurationAsset`            | Contenido inmutable de la configuración, como el logo, con tipo, tamaño y SHA-256; lo referencian las versiones de configuración (ADR 0017). |

## Comprobantes

| Término (UI)             | Identificador        | Código SRI | Significado                                                                             |
| ------------------------ | -------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Comprobante electrónico  | `electronicDocument` | —          | Cualquiera de los seis documentos del alcance.                                          |
| Factura                  | `invoice`            | `01`       | Venta de bienes o prestación de servicios.                                              |
| Liquidación de compra    | `purchaseSettlement` | `03`       | Compra de bienes o servicios en los casos que la normativa permite.                     |
| Nota de crédito          | `creditNote`         | `04`       | Corrección o anulación permitida de un comprobante.                                     |
| Nota de débito           | `debitNote`          | `05`       | Cobro adicional asociado a un comprobante.                                              |
| Guía de remisión         | `shippingGuide`      | `06`       | Traslado de mercadería.                                                                 |
| Comprobante de retención | `withholdingReceipt` | `07`       | Registro de retenciones efectuadas.                                                     |
| Documento modificado     | `modifiedDocument`   | —          | Comprobante que una nota de crédito o de débito corrige o complementa.                  |
| Documento sustento       | `supportingDocument` | —          | Comprobante sobre el cual se practica una retención; normalmente lo emitió un proveedor. |
| Comprobante relacionado  | `relatedDocument`    | —          | Comprobante de venta asociado a una guía de remisión.                                   |
| Borrador                 | `draft`              | —          | Comprobante editable, sin secuencial ni efectos fiscales.                               |
| Emitir                   | `emit`               | —          | Acción que congela el borrador, reserva el secuencial e inicia el proceso fiscal.       |
| Clave de acceso          | `accessKey`          | —          | Identificador de 49 dígitos del comprobante ante el SRI. El usuario lo ve: aparece en el RIDE. |
| Código numérico          | `numericCode`        | —          | Ocho dígitos dentro de la clave de acceso. Se genera una sola vez por comprobante.      |
| Tipo de emisión          | `emissionType`       | —          | Normal en el esquema off-line.                                                          |
| Forma de pago            | `paymentMethod`      | —          | Código del catálogo fiscal de formas de pago.                                           |
| Periodo fiscal           | `fiscalPeriod`       | —          | Mes y año de una retención (`MM/AAAA`).                                                 |
| Transportista            | `carrier`            | —          | Tercero que traslada la mercadería de una guía.                                         |
| Destinatario             | `consignee`          | —          | Tercero que recibe la mercadería trasladada.                                            |
| Sujeto retenido          | `withheldParty`      | —          | Tercero al que se le practica una retención.                                            |

## Proceso fiscal

| Término                         | Identificador          | Significado                                                                                                                                 |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Esquema off-line                | —                      | Modalidad vigente: el emisor firma, envía al SRI y el SRI autoriza de forma asíncrona.                                                       |
| Ficha técnica                   | `technicalSpecVersion` | Documento del SRI que define XML, clave de acceso, validaciones y servicios. Referencia vigente: v2.34, julio de 2026.                        |
| Versión XSD                     | `schemaVersion`        | Versión del esquema XML aplicada a un tipo de comprobante. Se registra en cada comprobante.                                                  |
| Firma electrónica / Certificado | `signingCertificate`   | Archivo P12/PFX y su contraseña, propiedad del contribuyente. Nunca sale del servidor.                                                       |
| XAdES-BES                       | —                      | Formato de firma XML que exige el SRI.                                                                                                      |
| Recepción                       | `reception`            | Servicio del SRI que acepta (`RECIBIDA`) o devuelve (`DEVUELTA`) el comprobante, con mensajes identificados por código.                     |
| Autorización                    | `authorization`        | Servicio del SRI consultado por clave de acceso: en procesamiento (`PPR`), `AUTORIZADO` (`AUT`) o `NO AUTORIZADO` (`NAT`). Puede tardar hasta 24 horas desde `RECIBIDA`. |
| Número de autorización          | `authorizationNumber`  | En el esquema off-line coincide con la clave de acceso del comprobante autorizado.                                                          |
| Consulta de validez             | `documentQuery`        | Servicio `ConsultaComprobante` del SRI: `AUTORIZADO`, `NO AUTORIZADO`, `PENDIENTE DE ANULAR` o `ANULADO`. Detecta anulaciones (CTX §24), una capacidad futura (Q-16). `add-sri-transmission` reconcilia con la consulta de autorización por clave y usa este servicio solo como guarda antes de un reenvío: un estado informado lo impide. |
| Reconciliación                  | `reconciliation`       | Consulta por la misma clave de acceso para resolver un resultado ambiguo antes de cualquier reenvío. Automática desde el job, o pedida por el administrador con un motivo ("Reconciliar con el SRI"). |
| Transmisión detenida            | `stopped`              | El job de la transmisión agotó sus límites o encontró un problema que no se corrige reintentando. No cambia el estado fiscal; espera una reconciliación del administrador. |
| Ventana de conclusión           | `conclusionWindow`     | Plazo para que el SRI concluya, 24 horas por defecto desde la primera evidencia de recepción (CTX §23.1). Al agotarlo sin conclusión, el comprobante pasa a revisión manual. |
| Requiere atención               | `attention`            | Filtro de facturas que esperan a una persona o se verifican con el SRI: `SEND_UNKNOWN`, `MANUAL_REVIEW` o transmisión detenida. |
| Anulación                       | `cancellation`         | Proceso del SRI en línea para dejar sin efecto un comprobante autorizado. No es una nota de crédito, no tiene Web Service público y el sistema no lo inventa (CTX §36). |
| RIDE                            | `ride`                 | Representación Impresa del Documento Electrónico, en PDF. Se genera desde el comprobante autorizado.                                        |
| Artefacto                       | `artifact`             | Archivo conservado de un comprobante (XML firmado, XML autorizado, respuestas del SRI, RIDE) junto con su hash.                             |
| Snapshot fiscal                 | `fiscalSnapshot`       | Copia inmutable de emisor, receptor, ítems, impuestos, catálogos y versiones con que se emitió un comprobante (CTX §39).                     |
| Intento SRI                     | `sriAttempt`           | Registro de una llamada a recepción, autorización o consulta y de su resultado.                                                             |
| Entrega                         | `deliveryAttempt`      | Registro de la entrega del comprobante al receptor por descarga, impresión o correo. Su fallo no cambia el estado fiscal (CTX §46).         |
| Revisión manual                 | `manualReview`         | Estado de un comprobante que el sistema no puede resolver solo. Solo sale con una reconciliación manual con evidencia concluyente.        |
| Catálogo fiscal                 | `fiscalCatalog`        | Tablas oficiales versionadas con vigencia y fuente: impuestos y tarifas, códigos de retención, formas de pago, tipos de identificación y de documento sustento (CTX §18). |
| Registro de esquemas            | `schemaRegistry`       | Manifiesto de los XSD oficiales con tipo, versión, archivo, hash y origen. Sin entrada válida, no se emite (CTX §19).                        |
| Caso especial                   | `specialCase`          | Operación que exige un anexo de la ficha (exportación, reembolso, combustibles…). Cada uno tiene una categoría declarada: `CORE`, `CONDITIONAL_ISSUER_RULE`, `CONDITIONAL_GO_LIVE`, `NOT_APPLICABLE` u `OUT_OF_MVP` (ADR 0014). |
| Rastro de auditoría             | `auditTrail`           | Registro inmutable de los cambios exitosos de un actor conocido dentro de una empresa. Ver `../quality/observability.md`. |
| Evento de seguridad             | `securityEvent`        | Inicio de sesión fallido, límite de intentos o denegación de autorización. Puede no tener empresa; se emite como log y métrica, no en el rastro de auditoría. |
| Recuperación administrativa     | `breakGlassRecovery`   | Comando de emergencia en el servidor con el que el administrador técnico restablece el acceso de un administrador. Nunca está expuesto en la API. |
| Cambio normativo                | `normativeChange`      | Ficha, XSD, resolución o catálogo nuevo del SRI que debe revisarse antes de un release (CTX §53).                                           |

## Catálogos e inventario

| Término (UI)                | Identificador                  | Significado                                                                                                    |
| --------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Tercero                     | `party`                        | Persona u organización reutilizable en cualquier rol. Sus roles opcionales y combinables (cliente `CUSTOMER`, proveedor `SUPPLIER`, transportista `CARRIER`) solo clasifican; destinatario y sujeto retenido son usos en un comprobante. |
| Tipo de identificación      | `identificationType`           | RUC (`04`), cédula (`05`), pasaporte (`06`), venta a consumidor final (`07`) o identificación del exterior (`08`), según el catálogo fiscal (CTX §9). |
| Consumidor final            | `finalConsumer` (`systemRecord: CONSUMER_FINAL`) | Tercero del sistema, uno por empresa, con identificación `07` / `9999999999999` para ventas sin identificar al adquirente, hasta el monto vigente de la política. No se admite en liquidación de compra, nota de crédito, nota de débito ni retención. |
| Producto / Servicio         | `product` (`GOOD` / `SERVICE`) | Ítem del catálogo con precio e impuestos.                                                                      |
| Código principal / auxiliar | `mainCode` / `auxiliaryCode`   | Códigos del ítem; el principal es único.                                                                       |
| Control de stock            | `stockTracked`                 | Indica que el producto lleva existencias.                                                                      |
| Estado de la configuración tributaria | `taxConfiguration.status` | Estado derivado de las referencias fiscales de un producto en una fecha: `READY` (Listo), `REVIEW_REQUIRED` (Revisar impuestos: una referencia dejó de ser aplicable o habilitada) o `INCOMPLETE` (Incompleto: faltan datos normativos para calcular un impuesto). Nunca se guarda. |
| Movimiento de inventario    | `stockMovement`                | `INICIAL`, `ENTRADA_MANUAL`, `SALIDA_FACTURA`, `DEVOLUCION_NC` o `AJUSTE`. Inmutable.                          |
| Kárdex                      | `stockLedger`                  | Historial de movimientos de un producto en un rango de fechas.                                                 |

## Usuarios

| Término               | Identificador | Significado                                                                                          |
| --------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| Administrador         | `ADMIN`       | Rol con acceso total: configuración, firma, secuenciales, usuarios y catálogos.                      |
| Operador              | `OPERATOR`    | Rol que emite y consulta comprobantes y usa los catálogos según sus permisos.                        |
| Administrador técnico | —             | Persona que instala, actualiza, respalda y monitorea la instancia. Opera el servidor; no es un rol de la aplicación. |

## Estado fiscal visible

La interfaz nunca muestra el código interno del estado. La máquina de estados completa está
en `../architecture/fiscal-emission.md`.

| Estado interno                                | Etiqueta en la interfaz   |
| --------------------------------------------- | ------------------------- |
| `RESERVED`                                    | Procesando                |
| `SIGNED`                                      | Pendiente de envío        |
| Job `sri.*` en curso (no es estado fiscal)    | Junto al estado: "Hay una interacción con el SRI en curso" |
| `SEND_UNKNOWN`                                | Verificando con el SRI    |
| `RECEIVED`                                    | Pendiente de autorización |
| `AUTHORIZED`                                  | Autorizado                |
| `RETURNED`                                    | Devuelto                  |
| `NOT_AUTHORIZED`                              | No autorizado             |
| `MANUAL_REVIEW` (design D4, Q-06)             | Requiere revisión         |
| `CANCEL_PENDING` (capacidad futura, Q-16)     | Pendiente de anulación    |
| `CANCELLED` (capacidad futura, Q-16)          | Anulado                   |

`RESERVED` es un estado local del proyecto (Q-35). La máquina de transmisión se decidió el
2026-10-03:
- `SEND_PENDING` de CTX §26 no se adopta: el envío en curso es un estado del job.
- `RECEIVED` agrupa el `PENDING_AUTHORIZATION` de ERS §12.1.
- `MANUAL_REVIEW` es un estado fiscal: lo adoptó el design D4 de `add-sri-transmission` (Q-06).
- `CANCEL_PENDING` y `CANCELLED` pertenecen a la capacidad futura de anulaciones (Q-16).

## Naming Rules

- Use product language in UI copy: los términos del SRI en español de este glosario.
- Use domain language in use cases and entities: los identificadores en inglés de este glosario.
- Nombra las capacidades OpenSpec en kebab-case a partir de estos identificadores. Ver `capabilities.md`.
- "Catálogo" sin calificar se refiere a productos y terceros. Las tablas del SRI son "catálogo fiscal".
- Avoid provider/vendor names in user-facing text unless the user must know them. El SRI sí se nombra: el usuario lo necesita.
- La interfaz muestra el número de comprobante, la clave de acceso y el número de autorización, porque el usuario los usa ante el SRI y sus clientes. No muestra estados internos, claves de idempotencia, rutas de almacenamiento ni identificadores técnicos.
