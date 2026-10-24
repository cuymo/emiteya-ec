# Capacidades

Mapa de las capacidades del MVP, su trazabilidad a las fuentes (`ERS`, `CTX`) y el orden
propuesto de los cambios OpenSpec que las construirán. Una capacidad se convierte en
`openspec/specs/<capacidad>/` solo cuando se archiva un cambio que la implementa; este
documento no especifica comportamiento.

## Mapa

| Capacidad              | Qué permite                                                                                       | Fuentes                                                        | Aceptación    | Preguntas abiertas             |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- | ------------------------------ |
| `user-access`          | Iniciar sesión, roles Administrador y Operador, alta y desactivación de usuarios por el administrador. | ERS RF-001, RF-002, RF-409, SEC-001, SEC-005                  | Falta (Q-32)  | Q-41                           |
| `taxpayer-setup`       | Datos de empresa, atributos tributarios, logo, ambiente, establecimientos, puntos, punto predeterminado por usuario y preparación para emitir. El aviso persistente del ambiente (RF-004, RF-005) es una franja de ancho completo encima de la barra superior mientras la empresa está en Pruebas. | ERS RF-004, RF-005, RF-101..113; CTX §5, §6, §37 | AC-01 | — (Q-23, Q-31 y Q-42 resueltas) |
| `fiscal-numbering`     | Secuenciales atómicos y únicos, y su ajuste administrativo auditado.                              | ERS RF-120..125, RNF-003; CTX §5, §28                          | AC-04         | — (Q-02 resuelta)               |
| `signing-certificate`  | Cargar, validar, reemplazar y vigilar el vencimiento de la firma, y restablecer su custodia con la clave configurada. | ERS RF-130..135, SEC-002, SEC-004; CTX §20                     | AC-02         | — (Q-17 resuelta)              |
| `fiscal-catalogs`      | Catálogos oficiales versionados, política de consumidor final, registro de esquemas y matriz de casos especiales. | ERS RF-234, SRI-REQ-12; CTX §3.1, §18, §19.3, §35, §38 | AC-03      | — (Q-25 y Q-38 resueltas)      |
| `parties`              | Catálogo único de terceros con roles y búsqueda, y el consumidor final del sistema.               | ERS RF-320..323; CTX §9                                        | AC-02, AC-03  | — (Q-26 parcial: volumen de terceros medido) |
| `products`             | Productos y servicios con precio exacto, referencias fiscales, estado tributario derivado y búsqueda. | ERS RF-301..305; CTX §12.4, §12.5                          | AC-08         | — (Q-26 parcial: volumen de productos medido) |
| `document-emission`    | Núcleo común: emisión idempotente, snapshot, máquina local `RESERVED` → `SIGNED`, clave de acceso, XML, XSD y firma, hasta el artefacto firmado. En Pruebas, o con el ambiente sin confirmar, cada editor que emite lo avisa junto a «Emitir» y en la confirmación, sin cambiar las condiciones ni el resultado de la emisión (`productize-invoice-editor-and-composition-foundation`). | ERS RF-006..010, RF-520..525, SRI-REQ-02..05, SRI-REQ-11; CTX §4, §8, §10, §11, §19–21, §39, §41 | AC-02, AC-05 | — (Q-08, Q-14, Q-29, Q-30, Q-35, Q-38, Q-39 y Q-44 resueltas; de Q-34 quedan el SOAP y el PDF; Q-26 parcial: emisión medida con `bench:emission`) |
| `sri-transmission`     | Transmisión con jobs desde `SIGNED`: recepción, autorización asíncrona, errores 43/45/70, reconciliación por clave de los resultados inciertos (automática o del administrador), revisión manual, política conservadora de tamaño (`PRODUCT_CONSERVATIVE_POLICY_V1`: menos de 40 000 bytes en el XML firmado, su base64 y el SOAP, en Pruebas y Producción) y respuestas originales inmutables. Nace apagada. Sin observación de anulaciones (Q-16) ni corrección de devueltos (BR-28). | ERS SRI-REQ-01, SRI-REQ-06..10, RNF-004; CTX §7, §22–27, §29, §32–34, §44, §52 | AC-02, AC-06 | — (Q-06, Q-07 y Q-48 resueltas; Q-47 resuelta por política de producto; Q-16 diferida; Q-34 SOAP resuelta) |
| `correct-returned-document` | Corregir un comprobante `DEVUELTA` (BR-28) con revisión o versionado de solo agregado, si la norma permite conservar la misma identidad. Capacidad futura, separada de `sri-transmission`. | ERS §12.1 (`RETURNED` corregible); CTX §26.1, §27.1 | — | Q-08 (fecha), Q-07 (resuelta) |
| `cancellation-observation` | Detectar anulaciones de comprobantes autorizados con la consulta de validez (`PENDIENTE DE ANULAR`, `ANULADO`), incluidas las de documentos complementarios como la nota de débito, que regulan las resoluciones NAC-DGERCGC25-00000014 y 00000017. Capacidad futura, fuera de `sri-transmission` y de la emisión de `debit-notes`. | CTX §24, §36; Res. NAC-DGERCGC25-00000014 y 00000017 | — | Q-16 |
| `invoices`             | Factura con consumidor final, líneas, pagos y totales; borradores editables antes de emitir; lista con vistas «Todas» y «Requiere atención», filtro de estado, búsqueda, estado en la dirección, marca de ambiente por factura y acciones sin efectos fiscales (`productize-invoice-list-and-shared-table-foundation`); editor que pertenece a Facturas, con guardar siempre disponible salvo durante un guardado y emitir solo con la versión guardada, sin cambios, sin problemas y con permiso; la acción principal según la situación; totales solo del servidor, rotulados como del último guardado mientras hay cambios; aviso de ambiente junto a la emisión y en la confirmación; cambios sin guardar visibles y con aviso al cerrar la pestaña; y lectura a cualquier anchura (`productize-invoice-editor-and-composition-foundation`). | ERS RF-010, RF-201..206; CTX §12, §35                          | AC-02, AC-08  | Q-45, Q-46 (Q-18 y Q-19 resueltas) |
| `credit-notes`         | Nota de crédito 1.1.0 contra una factura propia autorizada, con causas `TOTAL_ANNULMENT` y `RETURN` (parcial o total, por líneas de la factura), crédito acumulado nunca mayor que la factura con capacidades acreditable y devolvible independientes que fallan cerradas (reservadas al emitir, aplicadas o liberadas solo al concluir), un único cálculo versionado desde el snapshot de la factura, declaraciones del usuario sobre las exclusiones que el sistema no comprueba, devolución de stock opcional solo por el retorno físico declarado por línea al autorizar la nota, la transmisión y la reconciliación de la factura, su RIDE propio en la bandeja y sus pantallas. Sin descuentos ni bonificaciones ni documentos sustento externos. Medido con `bench:credit-notes`. | ERS RF-210..213, RF-212; CTX §13; Res. NAC-DGERCGC25-00000014 y 00000017 | AC-03         | — (Q-10 y Q-20 resueltas)      |
| `credit-note-discounts-bonuses` | Notas de crédito por descuentos o bonificaciones posteriores a la venta, con su modelo de importes, su asignación tributaria y su redondeo. Capacidad futura, separada de `credit-notes`. | Reglamento de Comprobantes, art. 15 | — | — |
| `external-supporting-documents` | Notas de crédito y de débito (y otros documentos relacionados) contra comprobantes emitidos fuera del sistema: externos, en papel o importados. Capacidad futura, solo si se necesita. No incluye los documentos sustento del comprobante de retención, que son referencias externas por diseño desde `add-withholding-receipts` (Q-50). Incluye el comprobante de venta externo como sustento de una guía de remisión (Q-51). | ERS RF-210, RF-243; CTX §13.4 | — | — |
| `debit-notes`          | Nota de débito 1.0.0 contra una factura propia autorizada del mismo ambiente, por las causas oficiales del artículo 16 (intereses de mora y costos o gastos posteriores), con uno o más conceptos, cada uno con un tratamiento de IVA que ya existía en la factura y su impuesto exacto, la declaración del usuario sobre la factura comercial negociable, su transmisión, su RIDE en la bandeja y sus pantallas. No aumenta la capacidad acreditable de la factura ni mueve inventario. Sin facturas externas ni anulación de la nota. | ERS RF-220..222; CTX §14; Reglamento de Comprobantes de Venta, art. 16 | AC-03         | — (Q-49 resuelta)              |
| `withholding-receipts` | Comprobante de retención 2.0.0 de renta (conceptos de residentes con porcentaje fijo del Catálogo ATS) e IVA (tabla 20), sin ISD, a un proveedor residente identificado, con `parteRel` declarado, período fiscal explícito y uno o más documentos sustento externos (factura, nota de venta o liquidación de compra) con sus impuestos y pagos; base ingresada por el usuario y valor retenido calculado por el servidor desde el porcentaje oficial congelado. Sin inventario ni pagos al exterior. | ERS RF-230..234; CTX §16; ficha v2.34, tablas 19 y 20 y anexo 10; Catálogo ATS; Reglamento de Comprobantes, arts. 8 y 40 | AC-03         | — (Q-50 resuelta)              |
| `withholding-isd` | Retención del impuesto a la salida de divisas (código `6`). Capacidad futura, pendiente de una fuente oficial que determine cuándo aplica cada código y tarifa vigente (la ficha v2.34 publica 4580 al 5 % y 4586 al 2,5 %, ambos sin fecha de fin). | Ficha v2.34, tabla 20; Q-50 | — | Pendiente de evidencia |
| `withholding-foreign-payments` | Retenciones por pagos al exterior: `pagoLocExt` 02, régimen fiscal, país del pago, convenios de doble tributación, sujeto con identificación del exterior y `tipoSujetoRetenido`, y los conceptos de renta para no residentes. Capacidad futura. | Ficha v2.34, anexo 10; Catálogo ATS, tablas 14 a 19 y 3.10; Q-50 | — | — |
| `withholding-special-supports` | Retenciones con estructuras especiales del ATS: reembolsos (sustento 41), dividendos (sustento 10), compra de cajas de banano y autorretenciones (anexo 19). Capacidad futura. | Ficha v2.34, anexos 10 y 19; Q-50 | — | — |
| `withholding-variable-rate-concepts` | Conceptos de renta cuyo porcentaje no es un número fijo en el Catálogo ATS (textuales, rangos, "varios porcentajes", por mil o dependientes de convenio), con su propia regla de selección. Capacidad futura. | Catálogo ATS, tabla 3.10; Q-50 | — | — |
| `purchase-settlement-other-cases` | Liquidación de compra en los demás casos oficiales: art. 13 a), b) y g) a j) (servicios de no residentes y sociedades extranjeras, servicios importados y digitales, arrendamientos al exterior), d) (reembolsos con `reembolsos`), e) y f) (sector público) y k) (economía popular y solidaria). Capacidad futura: cada caso tiene su identificación, sus datos y su retención. | Reglamento, art. 13; LRTI art. 70; RALRTI; Q-12 | — | — |
| `internal-purchase-settlement-withholding-link` | Asociación interna entre un comprobante de retención y una liquidación de compra propia autorizada, con la precarga de sus datos inmutables. Capacidad futura: nunca reescribirá snapshots históricos. | Reglamento, art. 13; Q-50; Q-12 | — | — |
| `inventory-entry-from-purchase-settlement` | Entrada de inventario por una liquidación de compra autorizada. Capacidad futura: el inventario mínimo no tiene una entrada por compra (ERS RF-311), y no se usará una entrada manual automática como atajo. | ERS RF-311; Q-12 | — | — |
| `shipping-guide-additional-details` | `detallesAdicionales` en los detalles de la guía de remisión (hasta tres pares de nombre y valor por detalle), con su snapshot, su XML y su RIDE. Capacidad futura. | XSD `GuiaRemision_V1.1.0.xsd`; Q-51 | — | — |
| `shipping-guide-multiple-vehicles` | Traslados con varios medios de transporte, placas o conductores (Reglamento de Comprobantes de Venta, art. 30). Capacidad futura: el XML 1.1.0 expresa un solo transportista y una sola placa. | Reglamento, art. 30; Q-51 | — | — |
| `location-stock` | Stock por establecimiento o ubicación y logística de traslados. Capacidad futura: el inventario actual es stock fiscal agregado por empresa, y la guía de remisión no lo mueve. | ERS RF-315; Q-51 | — | — |
| `shipping-guides`      | Guía de remisión 1.1.0 de la propia empresa como remitente: transportista propio (`SELF`) o tercero con el rol `CARRIER` (`PARTY`) y una placa; uno o más destinatarios con su dirección, su motivo y su detalle; por destinatario, una factura propia autorizada o una excepción declarada del artículo 30 del Reglamento. Sin precios, impuestos, total monetario ni inventario. | ERS RF-240..243; CTX §15; ficha v2.34, anexos 2 y 3; Reglamento, arts. 27–38 | AC-03 | — (Q-51 resuelta) |
| `purchase-settlements` | Liquidación de compra 1.1.0, separada de la factura, solo en el caso c) del artículo 13 del Reglamento vigente (Q-12): proveedor `SUPPLIER` con cédula o pasaporte y dirección, cuatro declaraciones del usuario, líneas con IVA, pagos con plazo; sin inventario, sin compras y sin emitir la retención. | ERS RF-250..253; CTX §17; Reglamento, arts. 13 y 22 | AC-03 | — |
| `inventory`            | Stock opcional contabilizado por hechos fiscales autorizados, no reserva de disponibilidad: inicialización única con `INICIAL`; la salida de una factura nace al entrar en `AUTHORIZED` con la decisión congelada en su snapshot (Q-18) y el saldo puede quedar negativo (Q-19); entradas y ajustes idempotentes; movimientos inmutables y kárdex; control fail-closed y no retroactivo; aviso orientativo en el borrador; la `DEVOLUCION_NC` de una nota de crédito autorizada por su retorno físico (`add-credit-notes`). Sin stock reservado ni comprometido. Medido con `bench:inventory`. | ERS RF-310..315, RF-205, RF-206, RF-212                        | AC-08         | — (Q-18, Q-19, Q-20 y Q-21 resueltas) |
| `document-archive`     | Bandeja única de los comprobantes desde la reserva, con filtros; RIDE generado una vez desde el XML autorizado (o el firmado transmitido, con su procedencia) para la factura 1.1.0 y la nota de crédito 1.1.0 (`add-credit-notes`, con su propia distribución) que el sistema emite, con el filtro de tipo; descargas verificadas por hash del RIDE y de los XML; impresión como acción explícita; historial de entregas observables (`DOWNLOAD`, `PRINT_REQUESTED`). El correo es la capacidad `email-delivery` (Q-24). | ERS RF-401..409; CTX §30, §31, §45, §46                        | AC-07         | Q-16 (futura), Q-27 (go-live) (Q-24 y Q-39 resueltas; el PDF de Q-34, con S-4 y el ADR 0022) |
| `email-delivery`       | Entrega por correo de los comprobantes autorizados con el XML autorizado y el RIDE, con el servidor SMTP de cada empresa: envío automático tras guardar el RIDE, receptores por tipo (también el transportista de la guía), solo el correo de prueba en Pruebas, estados basados en la evidencia del servidor, reintentos, reenvío idempotente, historial y avisos; hasta tres correos por tercero (`add-email-delivery`). | Res. NAC-DGERCGC18-00000233, arts. 5 y 6 (reforma NAC-DGERCGC25-00000014); ERS RF-406 | — | Q-24 (resuelta); el aviso de cambio de estado al receptor, futuro (Q-16) |
| `reports`              | Reportes filtrables exportados a XLSX.                                                            | ERS RF-501..505                                                | AC-09         | Q-26                           |
| `dashboard`            | Tablero de Inicio: ventas autorizadas del mes con su variación y de seis meses, facturas autorizadas sobre las emitidas, problemas de autorización, borradores, comprobantes por tipo, mejores clientes y productos, estado de facturación electrónica (firma, conexión con el SRI leída de lo guardado y entrega por correo) y últimos comprobantes, en el ambiente vigente. | ERS RF-004 (ambiente visible) | — | — |
| `audit-trail`          | Auditoría de cambios críticos y de transiciones de estado.                                        | ERS RF-003, RF-105, RF-525, SEC-007, RNF-006                   | Falta (Q-32)  | —                              |
| `data-portability`     | Exportar los datos y artefactos del contribuyente en un paquete autodescriptivo y versionado (`PORTABILITY_FORMAT_V1`), solo el administrador. No es un respaldo ni se importa. | ERS SEC-010 | Falta (Q-32); AC-10 es del respaldo operativo | — (Q-28 resuelta) |
| `web-security-policy`  | Política de seguridad que el navegador aplica a los documentos de la interfaz: CSP aplicada con un nonce por documento y `'strict-dynamic'`, sin enmarcado, cabeceras del documento, documentos fuera de las cachés compartidas y flujos legítimos sin violaciones. Next.js es su única autoridad, y HSTS queda en el borde TLS (`enforce-frontend-security-headers-csp`, ADR 0025). | ERS SEC-006; `../security/hardening.md`; H-02 de `../quality/manual-mvp-test-2026-10-09.md` | Go-Live v1.0 (H-02, capa de aplicación) | — (HSTS en el hardening del despliegue) |
| `api-request-protection` | Protección de las peticiones HTTP antes del dominio: las mutaciones de `/api/v1` exigen el origen canónico de `BETTER_AUTH_URL`, Fetch Metadata rechaza `same-site` y `cross-site`, sin CORS, y el cuerpo de `/api/auth` se limita a 8192 bytes de JSON. Defensa en profundidad: no sustituye la sesión, el rol ni la empresa (`enforce-api-origin-and-body-limits`). | ERS SEC-006; `../security/hardening.md`; H-03 de `../quality/manual-mvp-test-2026-10-09.md` | Go-Live v1.0 (H-03, capa de aplicación) | — (techo de cuerpo del proxy en el hardening del despliegue) |
| `production-configuration` | Configuración que solo tiene sentido en un despliegue real, exigida y validada antes de aceptar tráfico o de construir el frontend: `NODE_ENV` declarado sin valor por defecto; en producción, un `DATA_EXPORT_DIRECTORY` preexistente, propio y utilizable, un `TRUST_PROXY` explícito con una gramática estrecha y un `BETTER_AUTH_URL` en `https:` salvo el bucle local exacto; y un `API_INTERNAL_URL` obligatorio en el build y en la ejecución de producción del frontend. Los rechazos no revelan secretos. El reloj lo sincroniza la infraestructura: la aplicación no mide la desviación (`harden-production-configuration-and-clock-ownership`). | ERS RNF-008; CTX §20.5; `../architecture/deployment.md` | Go-Live v1.0 (capa de aplicación) | — (aprovisionamiento del volumen, del proxy, de `TRUST_PROXY` y evidencia del reloj en el hardening del despliegue) |
| `production-deployment` | Despliegue de producción de referencia (`deploy/compose.yaml`): nginx como único servicio público, con TLS, redirección de HTTP, una sola HSTS y `/api` directo a la API; la interfaz, la API y PostgreSQL 17 en una red privada sin salida a Internet; `TRUST_PROXY` como la IP explícita del borde; techo de cuerpo y espera propia de la descarga de portabilidad; estado persistente al recrear los contenedores; y respaldo `pg_dump -Fc` con su SHA-256, restaurado solo en una base vacía, con la clave maestra aparte (`harden-deployment-proxy-and-recovery`, ADR 0027). | ERS RNF-007, SEC-006, SEC-008; AC-10; CTX §20.5 | Go-Live v1.0 (borde y recuperación de referencia) | — (certificado real, reloj del host y cifrado de los respaldos: evidencia del operador en la revisión final del go-live) |
| `web-application-shell` | Shell autenticado de la interfaz web: navegación por grupos según el rol, con Configuración como un solo destino cuyas secciones son pestañas de una página y el destino actual siempre a la vista; barra superior estable en una línea, con las migas de la pantalla a la izquierda y el contexto global a la derecha; contexto de la empresa de solo lectura y acotado; aviso del ambiente en una franja de ancho completo encima de la barra superior en Pruebas o sin confirmar, que explica la falta de validez tributaria y nunca se presenta como Producción; migas jerárquicas desde Inicio en la barra superior, sin enlaces «volver»; jerarquía de acciones con un solo destacado, deshabilitados y selecciones neutros; creación rápida y paleta de comandos que declara su alcance; tema accesible en el menú de cuenta; menú de cuenta; y estados de carga, error, dirección inexistente y destino no permitido (`adopt-premium-design-foundation-and-shell`, ADR 0028; `productize-invoice-editor-and-composition-foundation`). | ERS RF-004, RF-005 (ambiente visible), SEC-001 (navegación según el rol, sin sustituir la autorización de la API) | Rediseño del frontend (base de diseño y shell) | — (tablas, formularios, tablero y estados fiscales compartidos: cambios siguientes del rediseño) |

Requisitos transversales que no forman una capacidad propia y aplican a todos los cambios:
API (ERS API-001..006, CTX §40–41), seguridad (ERS SEC-003, SEC-004, SEC-006, SEC-008,
SEC-009; CTX §47) y no funcionales (ERS RNF-001..012). Ver
`../architecture/non-functional-requirements.md`.

## Secuencia propuesta de cambios OpenSpec

Cada cambio es una unidad revisable que entrega comportamiento verificable. El orden sigue
las dependencias: nada se emite sin empresa, numeración, firma y catálogos, y los cinco
comprobantes restantes reutilizan el núcleo que construye la factura.

| #   | Cambio                     | Capacidades                                           | Depende de     | Cierra        |
| --- | -------------------------- | ----------------------------------------------------- | -------------- | ------------- |
| 0   | `bootstrap-application`    | Ninguna (`skip_specs: true`): monorepo, Express y Next.js sin autenticación, Prisma y PostgreSQL, validación de entorno, logger, salud, pruebas, verificación y CI. Excluye Better Auth, el aprovisionamiento y el shell autenticado, que son de `add-user-access`. Fija Prisma 7.x, porque Better Auth 1.7.7 no admite Prisma 8. | — | — |
| 1   | `add-user-access`          | `user-access`, `audit-trail` (base); crea el registro único de la empresa al instalar (ADR 0009) | 0 | —  |
| 2   | `add-taxpayer-setup`       | `taxpayer-setup`                                      | 1              | AC-01 parcial |
| 3   | `add-fiscal-numbering`     | `fiscal-numbering`                                    | 2              | AC-04         |
| 4   | `add-signing-certificate`  | `signing-certificate`                                 | 2              | AC-01         |
| 5a  | `add-fiscal-catalogs`      | `fiscal-catalogs`: catálogos oficiales versionados, política decimal común, política de consumidor final, registro de esquemas y matriz de casos especiales | 1 | —  |
| 5b  | `add-parties-and-products` | `parties`, `products`: consumen `fiscal-catalogs` como dependencia canónica | 5a | — |
| —   | Spikes técnicos, sin OpenSpec | Validación de `facturacion-electronica-ec`: XSD (S-2, ejecutado, ADR 0021), factura offline (S-3 offline, ejecutado con el builder propio de Q-44), autorización en Pruebas (S-3 online, compuerta de go-live, cumplida el 2026-10-11) y PDF (S-4) (Q-34, ADR 0018) | 0 | ADRs de dependencias |
| 6   | `add-invoice-emission`     | `document-emission`, `invoices`                       | 3, 4, 5a, 5b, spike | AC-05    |
| 7   | `add-sri-transmission`     | `sri-transmission`                                    | 6              | AC-06; AC-02 parcial (el RIDE llega con el cambio 8 y la autorización real con S-3 online) |
| 8   | `add-document-archive`     | `document-archive`                                    | 7              | AC-07; completa AC-02 con S-3 online |
| 9   | `add-minimal-inventory`    | `inventory`                                           | 7              | AC-08         |
| 10  | `add-credit-notes`         | `credit-notes`                                        | 7, 9           | AC-03 parcial |
| 11  | `add-debit-notes`          | `debit-notes`                                         | 7, 8, 10       | AC-03 parcial |
| 12  | `add-withholding-receipts` | `withholding-receipts`                                | 7              | AC-03 parcial |
| 13  | `add-shipping-guides`      | `shipping-guides`                                     | 7              | AC-03 parcial |
| 14  | `add-purchase-settlements` | `purchase-settlements`                                | 7              | AC-03         |
| 15  | `add-reports-export`       | `reports`                                             | 8              | AC-09         |
| 16  | `add-data-portability`     | `data-portability`                                    | 8              | SEC-010 (AC-10 es del respaldo operativo) |

La secuencia 0 a 16 del MVP está completa: el cambio 16 se archivó el 2026-10-08. La revisión
manual integral se hizo el 2026-10-09 con una pasada autónoma de extremo a extremo en navegador
contra un SRI simulado: 75 casos en PASS, sin BLOCKER ni MAJOR
(`../quality/manual-mvp-test-2026-10-09.md`). Eso no es una certificación con el SRI ni declara el
producto listo para producción. Lo que sigue no es un cambio de la secuencia. La certificación con
el SRI en Pruebas (S-3 online) quedó completa el 2026-10-11: al menos un comprobante de cada uno de
los seis tipos `AUTHORIZED`, AC-03 cumplido (`../quality/sri-certification.md`, sección 13). Quedan las
compuertas del go-live (`../quality/definition-of-done.md`, Go-Live v1.0).

Capacidades futuras sin número en la secuencia, decididas en la revisión de readiness del cambio 7
(2026-10-03): `correct-returned-document` (corrección de un devuelto, BR-28) y
`cancellation-observation` (observación de anulaciones, Q-16). Ninguna amplía `add-sri-transmission`.
En la revisión de readiness del cambio 10 (2026-10-04) se suman `credit-note-discounts-bonuses`
(la norma permite esa causa, pero el MVP no la implementa todavía) y `external-supporting-documents`
(el MVP solo acepta como documento modificado una factura propia autorizada). Ninguna amplía
`add-credit-notes`.
En la revisión de readiness del cambio 12 (2026-10-05) se suman `withholding-isd` (evidencia
insuficiente para elegir la tarifa), `withholding-foreign-payments`, `withholding-special-supports` y
`withholding-variable-rate-concepts`. Ninguna amplía `add-withholding-receipts`.
En la revisión de readiness del cambio 13 (2026-10-06) se suman `shipping-guide-additional-details`,
`shipping-guide-multiple-vehicles` y `location-stock`, y `external-supporting-documents` abarca
también el comprobante de venta externo de una guía. Ninguna amplía `add-shipping-guides`.
En la revisión de readiness del cambio 14 (2026-10-07) se suman `purchase-settlement-other-cases`,
`internal-purchase-settlement-withholding-link` y `inventory-entry-from-purchase-settlement`. Ninguna
amplía `add-purchase-settlements`.

Obligaciones de `add-fiscal-catalogs` (5a) para `add-parties-and-products` (5b), que consume
`fiscal-catalogs` como dependencia canónica sin duplicar datasets ni reglas de vigencia:

- validar identificaciones con las reglas del dataset de tipos de identificación, con el tipo `07` reservado;
- crear el consumidor final de cada empresa como registro del sistema, con la identidad que publica la política de consumidor final;
- referenciar impuestos por `(catálogo, entryKey)`, resolverlos solo con `resolveCatalogEntry` y decidir si están disponibles con `effectiveEnablement` e `isUsable`;
- usar las especificaciones decimales `precioUnitario` e `importe` y `decimalString`;
- señalar los productos cuyo impuesto deja de estar vigente o habilitado;
- traer el contrato común de búsqueda y paginación, la prueba de volumen de Q-26 y el aviso de `Catálogos fiscales` sobre productos afectados al deshabilitar.

El cambio 5 se propuso como `add-business-catalogs` y, antes de implementarse, se dividió en 5a y 5b (2026-10-02): `catalogs` no depende de terceros ni productos, y cada parte queda revisable por separado. La propuesta original queda solo en el historial de git.

Estrategia técnica (ADR 0018): los cambios 4 a 14 reutilizan `facturacion-electronica-ec`, detrás de puertos propios, para los builders XML, la clave de acceso, la validación XSD, la firma XAdES-BES y el transporte SOAP, en lugar de reimplementarlos. La orquestación, la numeración, la persistencia, los estados, la idempotencia, los reintentos y la reconciliación siguen siendo de la aplicación. Ningún cambio está implementado por adoptar la librería.

Al terminar el cambio 8 existe una porción vertical completa: una factura configurada,
emitida, autorizada en Pruebas, con RIDE y descargable. Ese es el primer punto para validar
el producto con un contribuyente real.

Cada cambio que implemente un tipo de comprobante cumple la Definition of Done del motor
fiscal (CTX §58). El release v1.0 exige además los no negociables de
`../quality/definition-of-done.md` (sección Go-Live v1.0).

## Requisitos fuente diferidos

Requisitos del ERS que el cambio de su capacidad no implementó. Siguen pendientes y no forman
parte del spec actual de esa capacidad hasta que otro cambio los implemente.

| Requisito | Capacidad | Qué falta | Estado |
| --- | --- | --- | --- |
| ERS RF-202, "ingreso manual permitido" | `invoices` | Líneas de factura sin producto del catálogo. `add-invoice-emission` (cambio 6) solo admite líneas que refieren un producto activo. | Diferido; sus reglas son Q-46. No es Q-45, que trata de modificar el precio de un producto del catálogo. |

## Trazabilidad de `credit-notes`

Fuentes del cambio 10 y qué fija cada una. Los specs distinguen el requisito oficial de la política
del MVP.

| Regla | Origen | Fuente |
| --- | --- | --- |
| Causas: anular operaciones, aceptar devoluciones, conceder descuentos o bonificaciones; la nota consigna denominación, serie y número del comprobante modificado | Requisito oficial | Reglamento de Comprobantes de Venta, art. 15 (citado en la Res. NAC-DGERCGC25-00000014); art. 5 sustituido por la NAC-DGERCGC25-00000017 |
| Una factura con la leyenda "consumidor final" no admite nota de crédito | Requisito oficial, desde el 01/01/2026 | Res. NAC-DGERCGC25-00000014, art. 3, último inciso; disposición final reformada por la 00000017 |
| Sin nota de crédito para facturas comerciales negociables negociadas ni para comprobantes que sustentan una devolución de impuestos | Requisito oficial | Res. NAC-DGERCGC25-00000014, disposiciones generales segunda y tercera |
| Sin plazo para emitir la nota (el de doce meses se eliminó) | Requisito oficial vigente | Res. NAC-DGERCGC25-00000017, art. 1, literal c |
| Anular un comprobante de venta en línea o mediante nota de crédito | Requisito oficial | Res. NAC-DGERCGC25-00000014, art. 2 |
| XML `notaCredito` 1.1.0 y su RIDE | Requisito oficial | `docs/product/sri-xsd/NotaCredito_V1.1.0.xsd`; ficha v2.34, anexo 3 y anexo 2 (página 61) |
| Documento modificado: tipo, número completo, fecha, motivo, valor e impuestos coherentes con él | Contexto técnico | CTX §13.2–13.4 |
| Solo facturas propias autorizadas, del mismo ambiente que la nota, como documento modificado | Política del MVP | Q-10 |
| Causas `TOTAL_ANNULMENT` y `RETURN`; descuentos y bonificaciones diferidos | Política del MVP (alcance) | Q-10 |
| Crédito acumulado no mayor que la factura, y por línea no mayor que su cantidad | Política conservadora del producto | Q-10 |
| Declaraciones del usuario para las exclusiones no comprobables | Política del MVP | Q-10 |
| Devolución de stock al autorizar la nota, por el retorno físico declarado y limitada a la salida original pendiente | Política del producto sobre ERS RF-212 | Q-20 |

Lo que implementa `add-credit-notes` (detalle en `../architecture/fiscal-emission.md`,
`../architecture/database.md` y `../security/access-control.md`):

- **Rutas y permisos:** `GET /api/v1/credit-notes/eligible-invoices` y los borradores (`GET/POST /api/v1/credit-notes/drafts`, `GET/PUT/DELETE /api/v1/credit-notes/drafts/{draftId}`) con `creditNotes.draft`; `POST /api/v1/credit-notes` (con `Idempotency-Key` y las declaraciones) con `creditNotes.emit`; `GET /api/v1/credit-notes`, `GET /api/v1/credit-notes/{creditNoteId}`, `GET /api/v1/credit-notes/{creditNoteId}/transmission` y `GET /api/v1/credit-notes/invoices/{invoiceId}/credit` con `creditNotes.read`; `POST /api/v1/credit-notes/{creditNoteId}/signing-attempts` con `creditNotes.retrySigning`; y `POST /api/v1/credit-notes/{creditNoteId}/reconciliations` con `creditNotes.reconcile`, solo del administrador. La bandeja filtra con `GET /api/v1/documents?documentType=04`.
- **Códigos de error:** `CREDIT_NOTE_NOT_FOUND`, `CREDIT_NOTE_DRAFT_NOT_FOUND`, `CREDIT_NOTE_INVOICE_NOT_FOUND`, `CREDIT_NOTE_DRAFT_CHANGED`, `CREDIT_NOTE_DRAFT_ALREADY_EMITTED`, `CREDIT_NOTE_DRAFT_INCOMPLETE`, `CREDIT_NOTE_INVOICE_NOT_ELIGIBLE`, `CREDIT_NOTE_CONSUMER_FINAL`, `CREDIT_NOTE_INVOICE_INTEGRITY`, `CREDIT_NOTE_CAUSE_INVALID`, `CREDIT_NOTE_REASON_REQUIRED`, `CREDIT_NOTE_LINE_INVALID`, `CREDIT_NOTE_QUANTITY_EXCEEDED`, `CREDIT_NOTE_AMOUNT_EXCEEDED`, `CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE`, `CREDIT_NOTE_PHYSICAL_RETURN_INVALID`, `CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED`, `CREDIT_NOTE_LINE_AMOUNT_NEGATIVE`, `CREDIT_NOTE_DECLARATIONS_REQUIRED` y `CREDIT_NOTE_NOT_RECONCILABLE`, más los de la emisión compartidos con la factura (`IDEMPOTENCY_KEY_*`, firma, punto, esquema, secuencia y `SRI_INTERACTION_IN_PROGRESS`).
- **Métricas:** `credit_note_reservations_total{cause}`, `credit_note_reservation_conflicts_total{reason}`, `credit_note_reservations_unconcluded_over_24h` (la señal de la alerta) e `inventory_movements_total{type="DEVOLUCION_NC"}` (`../quality/observability.md`).
- **Pantallas:** `Notas de crédito` (`/notas-credito`), el borrador con la confirmación de las declaraciones, el detalle, el crédito en el detalle de la factura y el filtro de tipo en `Comprobantes`.
- **Rendimiento:** `bench:credit-notes` (`../quality/performance.md`).

## Trazabilidad de `debit-notes`

Estado: `add-debit-notes` archivado el 2026-10-05 (`openspec/changes/archive/2026-10-05-add-debit-notes/`).

Fuentes del cambio 11 y qué fija cada una (Q-49). Los specs distinguirán el requisito oficial de la
política del MVP.

| Regla | Origen | Fuente |
| --- | --- | --- |
| Causas: cobro de intereses de mora y recuperación de costos y gastos posteriores a la emisión del comprobante; la nota consigna denominación, serie y número del comprobante modificado | Requisito oficial | Reglamento de Comprobantes de Venta, art. 16 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-15-16.txt`) |
| Una factura comercial negociable efectivamente negociada no admite nota de débito | Requisito oficial; el usuario lo declara mientras el sistema no pueda comprobarlo | Reglamento de Comprobantes de Venta, art. 16 |
| IVA del comprobante original, no el vigente a la fecha de la nota | Requisito oficial, con fuente durable archivada | Primaria: ficha v2.34, página 58, "la tarifa de IVA corresponderá a la fecha de emisión del documento de sustento" (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`). Complementaria: la pregunta 11 de las preguntas frecuentes del SRI del cambio de tarifa de 2016 (`sri-catalogs/fuentes/sri-preguntas-frecuentes-tarifa-iva-2016.txt`); el aviso del cambio del 14 % al 12 % no se encontró en el portal y no se archiva. Q-49 |
| XML `notaDebito` 1.0.0 y su RIDE | Requisito oficial | `docs/product/sri-xsd/NotaDebito_V1.0.0.xsd`, verificado contra el portal el 2026-10-05 (`sri-catalogs/fuentes/nota-de-debito-xsd-verificacion.txt`); CTX §14 |
| `pagos` obligatorio en la nota de débito, con su forma de pago y su total | Requisito oficial | Ficha v2.34, páginas 58 y 59 (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`) |
| Exactamente un `pago`, por el valor total exacto, de una forma de pago vigente y habilitada del catálogo | Política del MVP del proyecto, no un límite del SRI; varias formas de pago serían una extensión compatible | Design D8 de `add-debit-notes` |
| Distribución del RIDE de la nota de débito | Requisito oficial | Ficha v2.34, anexo 2, página 62 |
| `infoAdicional` solo cuando corresponde un campo adicional definido por una fuente (hoy ninguno); nunca con contenido inventado | Requisito oficial: la fila "Obligatorio" de la página 59 es el contenedor de campos que la misma tabla marca "Obligatorio cuando corresponda" | Ficha v2.34, páginas 29, 51–59, 69–74 y 135 (`sri-catalogs/fuentes/ficha-v2.34-nota-de-debito.txt`, Resolución de `infoAdicional`); el anexo 26 sigue en Q-37 |
| Sin plazo de emisión impuesto | Las fuentes oficiales vigentes revisadas no lo establecen; no se extrapola el art. 5 reformado de la NAC-DGERCGC25-00000017, que rige las notas de crédito | Q-49 |
| Solo facturas propias autorizadas, del mismo ambiente, como documento modificado | Política del MVP | Q-11, Q-49 |
| Causas cerradas `LATE_PAYMENT_INTEREST` y `POST_INVOICE_COST_EXPENSE`; cada concepto con un tratamiento de IVA de la factura | Política del MVP sobre el art. 16 | Q-49 |
| Factura a consumidor final no admite nota de débito | Política del producto (receptor identificado, BR-32), no la NAC-DGERCGC25-00000014 | Q-49 |
| No aumenta la capacidad acreditable de la factura ni mueve inventario; una nota de crédito no modifica una nota de débito | Política del producto | Q-49 |
| La anulación de una nota de débito ya emitida queda fuera | Las resoluciones NAC-DGERCGC25-00000014 y 00000017 regulan la anulación de documentos complementarios; es una capacidad futura | Q-16 |

Lo que implementa `add-debit-notes` (detalle en `../architecture/fiscal-emission.md`,
`../architecture/database.md` y `../security/access-control.md`):

- **Rutas y permisos:** `GET /api/v1/debit-notes/eligible-invoices` y los borradores (`GET/POST /api/v1/debit-notes/drafts`, `GET/PUT/DELETE /api/v1/debit-notes/drafts/{draftId}`) con `debitNotes.draft`; `POST /api/v1/debit-notes` (con `Idempotency-Key` y la declaración) con `debitNotes.emit`; `GET /api/v1/debit-notes`, `GET /api/v1/debit-notes/{debitNoteId}` y `GET /api/v1/debit-notes/{debitNoteId}/transmission` con `debitNotes.read`; `POST /api/v1/debit-notes/{debitNoteId}/signing-attempts` con `debitNotes.retrySigning`; y `POST /api/v1/debit-notes/{debitNoteId}/reconciliations` con `debitNotes.reconcile`, solo del administrador. La bandeja filtra con `GET /api/v1/documents?documentType=05`.
- **Códigos de error:** los `DEBIT_NOTE_*` de `packages/contracts/src/debit-notes.ts`, entre ellos `DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE`, `DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE`, `DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH` y `DEBIT_NOTE_DECLARATION_REQUIRED`, más los de la emisión compartidos con la factura.
- **Métricas:** `debit_note_reservations_total` y `debit_note_concepts_total{cause}` (`../quality/observability.md`).
- **Pantallas:** `Notas de débito` (`/notas-debito`), la nueva nota desde la factura o el selector, el borrador con la confirmación de la declaración, el detalle y el tipo `05` en `Comprobantes`.
- **Rendimiento:** `bench:debit-notes` (`../quality/performance.md`).

## Trazabilidad de `withholding-receipts`

Fuentes del cambio 12 y qué fija cada una (Q-50). Los specs distinguirán el requisito oficial de la
política del MVP.

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `comprobanteRetencion` 2.0.0 (ATS) | Requisito oficial | `docs/product/sri-xsd/ComprobanteRetencion_V2.0.0.xsd`, verificado contra el portal el 2026-10-05 (`sri-catalogs/fuentes/comprobante-retencion-xsd-verificacion.txt`); ficha v2.34, anexo 10 |
| Sujeto retenido identificado, nunca consumidor final | Requisito oficial | Ficha v2.34, página 13, notas de la tabla 6 |
| Contenido: sujeto, impuesto, comprobante que motiva la retención, base, porcentaje, valor, ejercicio fiscal y fecha de emisión; totalizado y cerrado individualmente | Requisito oficial | Reglamento de Comprobantes, art. 40 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-3-8-40.txt`) |
| Se emite al pagar o acreditar en cuenta; el catálogo se resuelve con la fecha de emisión | Requisito oficial (art. 8) y política del MVP (fecha efectiva) | Reglamento de Comprobantes, art. 8; Q-50 |
| Impuestos a retener y retención del IVA | Requisito oficial | Ficha v2.34, tablas 19 y 20 |
| Conceptos y porcentajes de la renta; tablas de sustento, tipo de comprobante y formas de pago | Requisito oficial | Catálogo ATS (06/08/2026), referido por la ficha v2.34, página 34 y anexo 10 |
| Renta: solo residentes con porcentaje fijo; IVA sí; ISD no | Política del MVP | Q-50 |
| Período fiscal explícito, editable antes de reservar, nunca posterior al mes de emisión | Política del MVP (la fuente solo exige el ejercicio fiscal de la retención) | Q-50 |
| Uno o más documentos sustento externos de los tipos 01, 02 y 03 | Política del MVP sobre el XSD, que no fija máximo | Q-50 |
| Base ingresada por el usuario; porcentaje del catálogo; valor retenido del servidor con HALF_UP a 2 decimales | Política del MVP y política decimal del proyecto | Q-50, `../architecture/decimal-policy.md` |
| `parteRel` declarado por el usuario | Requisito oficial (obligatorio en el XSD), declarado por el usuario | Q-50 |
| Sin pagos al exterior, reembolsos, dividendos, banano ni autorretenciones | Política del MVP | Q-50; matriz de casos especiales (anexo 19 fuera del MVP) |
| Sin inventario ni capacidad acreditable | Política del producto | Q-50 |

## Trazabilidad de `shipping-guides`

Fuentes del cambio 13 y qué fija cada una (Q-51). Los specs distinguirán el requisito oficial, la
política del MVP y la defensa de recursos.

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `guiaRemision` 1.1.0, codDoc `06` | Requisito oficial | `docs/product/sri-xsd/GuiaRemision_V1.1.0.xsd`, verificado contra el portal el 2026-10-06 (`sri-catalogs/fuentes/guia-remision-xsd-verificacion.txt`); ficha v2.34, tabla 3 y anexo 3 |
| Un transportista (identificación de hasta 13 caracteres) y una placa (hasta 20) por guía | Requisito oficial | XSD y ficha v2.34, anexo 3, página 70 (`sri-catalogs/fuentes/ficha-v2.34-guia-de-remision.txt`) |
| La fecha de inicio del transporte no es menor que la fecha de emisión de la guía | Requisito oficial | Ficha v2.34, página 38, error 82 (BR-37) |
| La fecha de fin no es anterior a la de inicio; sin duración máxima | Validación del proyecto | Q-51 |
| Destinatario identificado, partida, destinos, conductor, placa, mercadería con unidad y cantidad, motivo y fechas | Requisito oficial | Reglamento de Comprobantes de Venta, art. 30 (`sri-catalogs/fuentes/reglamento-comprobantes-arts-27-38.txt`) |
| Comprobante de venta salvo las excepciones a) a e) del art. 30, numeral 8 | Requisito oficial | Reglamento, art. 30 |
| Factura `01` propia, autorizada, del mismo ambiente, o excepción declarada b), c), d) o e); sin venta itinerante ni comprobantes externos | Política del MVP (P1) | Q-51 |
| Traslado entre establecimientos propios con la empresa como destinataria, origen y destino registrados, activos y distintos, y la partida derivada del origen | Requisito oficial ("traslado entre establecimientos de un mismo contribuyente") y política del MVP (P2) | Reglamento, art. 30, numeral 8, literal d; Q-51 |
| Factura a consumidor final como sustento con un destinatario identificado | Política del MVP | Q-51 |
| Mercancías de la factura como sugerencia no autoritativa | Política del MVP | Q-51 |
| Conductor (Reglamento, art. 30) frente a transportista (XSD, ficha y facturador gratuito): solo los campos del transportista del XML 1.1.0 | Requisito oficial con terminología distinta | Reglamento, art. 30; ficha v2.34, anexo 3 y tabla 15; Q-51 |
| Destinatario externo: tercero activo 04, 05 o 06, sin rol obligatorio | Política del MVP (P3) sobre el art. 30 | Q-51 |
| Transportista `SELF` (identidad tributaria) o `PARTY` (rol `CARRIER` obligatorio, 04, 05 o 06) | Política del MVP (P4) | Q-51 |
| Placa como texto fiscal, sin formato vehicular | Política del MVP (P5); la tabla 29 es de facturas de combustibles | Ficha v2.34, anexo 12; Q-51 |
| Sin `detallesAdicionales` | Política del MVP (P6) | Q-51 |
| Cantidad mayor que cero, exacta, de hasta 6 decimales | Política del MVP (P7) sobre el XSD, que admite 0 | Q-51, `../architecture/decimal-policy.md` |
| Sin movimientos de inventario | Política del producto (P8) | Q-51 |
| 10/50 destinatarios, 50/100 detalles por destinatario y 100/300 detalles por guía (por defecto/máximo) | Defensa de recursos del producto (P9), nunca un límite del SRI ni del XSD | Q-51 |
| Sin total monetario ni receptor único en la cabecera común | Política del producto (P10) | Q-51 |
| RIDE propio con la distribución del anexo 2 | Requisito oficial | Ficha v2.34, página 64 |
| Sin aduana, exterior, combustibles, máquina fiscal, factura sustitutiva, emisor itinerante, interrupción del transporte ni varios vehículos | Política del MVP | Reglamento, arts. 30 a 37; matriz de casos especiales; Q-51 |

## Trazabilidad de `purchase-settlements`

Estado: `add-purchase-settlements` archivado el 2026-10-08
(`openspec/changes/archive/2026-10-08-add-purchase-settlements/`).

Fuentes del cambio 14 y qué fija cada una (Q-12). Los specs distinguen el requisito oficial, la
política del MVP y la defensa de recursos.

| Regla | Origen | Fuente |
| --- | --- | --- |
| XML `liquidacionCompra` 1.1.0, codDoc `03` | Requisito oficial | `docs/product/sri-xsd/LiquidacionCompra_V1.1.0.xsd`, verificado contra el portal el 2026-10-07 (`sri-catalogs/fuentes/liquidacion-compra-xsd-verificacion.txt`); ficha v2.34, tabla 3 y anexo 17 |
| Sin consumidor final como proveedor | Requisito oficial | Ficha v2.34, tabla 6 (`sri-catalogs/fuentes/ficha-v2.34-liquidacion-de-compra.txt`) |
| Casos de procedencia a) a f) | Requisito oficial | Reglamento de Comprobantes de Venta vigente (2023-12-29), art. 13 (`sri-catalogs/fuentes/reglamento-comprobantes-liquidacion-de-compra.txt`) |
| Solo el caso c), con cuatro declaraciones del usuario (`PURCHASE_SETTLEMENT_ELIGIBILITY_V1`) | Política del MVP sobre el art. 13 c) | Q-12 |
| Proveedor `SUPPLIER` con cédula (05) o pasaporte (06); 04, 07 y 08 rechazados | Política del MVP que materializa el caso c) | Reglamento, art. 22; Q-12 |
| Dirección del proveedor obligatoria (1 a 300) | Requisito oficial (art. 22) más estricto que el XSD, que la deja opcional | Reglamento, art. 22; XSD |
| Solo IVA en líneas y totales | Requisito oficial | XSD 1.1.0 (`codigo` 2) |
| Descuento por línea siempre presente | Requisito oficial | XSD 1.1.0 |
| Pagos 1..N con `plazo` y `unidadTiempo`, suma exacta igual al importe total | Requisito oficial (la ficha exige `pagos` y `plazo`) y política del MVP (suma exacta, `unidadTiempo` siempre) | Ficha v2.34, anexo 17; Q-12 |
| Moneda `DOLAR` | Política monetaria del proyecto | Ficha v2.34, anexo 17 (`moneda` obligatoria); Q-12 |
| Retención del 100 % del IVA y del 3 % de renta en el caso c), en un comprobante de retención separado que el cambio no emite | Requisito oficial; política del MVP (sin automatizar) | Reglamento, art. 13; NAC-DGERCGC20-00000061; NAC-DGERCGC26-00000009 (`normativa-liquidacion-retenciones.txt`); Q-12 |
| Sin movimientos de inventario | Política del producto | ERS RF-311; Q-12 |
| Sin compras, cuentas por pagar ni facturas recibidas | Política del producto | ERS §3 (fuera del alcance); Q-12 |
| 100/500 líneas y 10/20 pagos (por defecto/máximo) | Defensa de recursos del producto, nunca un límite del SRI ni del XSD | Q-12 |
| RIDE propio con la distribución del anexo 2 | Requisito oficial | Ficha v2.34, página 65 |
| Sin reembolsos, máquina fiscal, negociable, subsidios, ICE ni IRBPNR | Política del MVP | XSD 1.1.0; matriz de casos especiales; Q-12 |

## Trazabilidad de `reports`

Estado: `add-reports-export` archivado el 2026-10-08
(`openspec/changes/archive/2026-10-08-add-reports-export/`).

Decisiones de la revisión de readiness del cambio 15 (`add-reports-export`, 2026-10-08). Los specs
distinguen el requisito del ERS, la política del MVP y la defensa de recursos.

| Regla | Origen | Fuente |
| --- | --- | --- |
| Exactamente cinco reportes: Documentos emitidos, Facturas, Retenciones, Inventario y Terceros, con sus filtros mínimos y sus columnas orientativas | Requisito del ERS | ERS §11 |
| Exportación solo a XLSX; sin CSV, PDF, JSON exportado ni ZIP | Requisito del ERS (XLSX) y política del MVP (nada más) | ERS RF-501 |
| Identificaciones, claves, autorizaciones y números formateados como texto | Requisito del ERS | ERS RF-502 |
| Importes como números con formato monetario, y como texto canónico cuando superan la precisión segura de la hoja (unos 15 dígitos significativos): nunca un decimal exacto convertido a binario aproximado | Requisito del ERS y política del proyecto (exactitud antes que conveniencia) | ERS RF-503; política decimal |
| La exportación respeta los filtros: el mismo tipo de reporte con los mismos filtros da exactamente los registros de la lista completa paginada, en el mismo orden; el atajo mensual solo fija el rango de fechas | Requisito del ERS | ERS RF-504, AC-09 |
| Listados, no contabilidad: sin totales netos, sin compensar notas contra facturas, sin ventas netas, impuestos agregados, ATS, declaraciones, compras ni cartera | Requisito del ERS | ERS RF-505, §2.3, §21 |
| Notas de crédito y de débito, guías y liquidaciones de compra solo como filas de Documentos emitidos, con sus propios importes; Facturas solo factura; Retenciones, una fila por línea de retención | Política del MVP | ERS §11 |
| Documentos emitidos: por defecto, todos los estados desde que el comprobante reserva su número (nunca borradores), con el estado en cada fila | Política del MVP | Revisión de readiness del cambio 15 |
| Facturas y Retenciones: por defecto, solo las autorizadas; el usuario puede elegir otro estado | Política del MVP (semántica fiscal) | Revisión de readiness del cambio 15 |
| Columna y filtro de ambiente; por defecto, el ambiente vigente de la empresa, derivado en el servidor; Pruebas, Producción o todos solo por elección explícita, y la exportación usa el mismo filtro que la lista | Política del MVP | ERS RF-004; revisión de readiness del cambio 15 |
| Fuente histórica: el comprobante congelado y su snapshot por tipo; las tablas inmutables de la retención; el saldo y el kárdex del inventario; los datos vigentes de los terceros. Nunca el tercero, el producto ni el catálogo vigentes para reconstruir historia fiscal | Política del proyecto | ERS §13.1; BR-47 |
| Inventario en dos vistas: Existencias (saldo de los productos con inventario inicializado) y Movimientos (kárdex de la empresa, por producto, fechas y tipo de movimiento) | Política del MVP | ERS §11 |
| Exportación síncrona por streaming, sin job, artefacto, TTL ni URL firmada, con memoria acotada | Política del proyecto | Revisión de readiness del cambio 15 |
| `REPORT_EXPORT_MAX_ROWS` y `REPORT_EXPORT_MAX_CONCURRENT`, con sus valores fijados por el benchmark; superar el tope de filas pide acotar los filtros y nunca entrega un archivo truncado | Defensa de recursos del proyecto, nunca un límite del ERS | Q-26; revisión de readiness del cambio 15 |
| El texto escrito por el usuario va en celdas de texto, nunca como fórmula, sin alterar el valor visible | Seguridad del proyecto | `../security/threat-model.md` (archivos generados y exportaciones) |
| Toda exportación generada se audita (`report.exported`) con el actor, el tipo de reporte, el momento, el número de filas y los filtros no sensibles; de un filtro con un dato personal solo se registra que estuvo presente. Sin tabla `report_export` | Política del proyecto | ERS §13 (`report_export` opcional), RNF-006; revisión de readiness del cambio 15 |
| Ver reportes y exportar XLSX: administrador y operador | Política del MVP | `../security/access-control.md`; Q-22 |
| La portabilidad completa (XML, RIDE, artefactos, ZIP, todos los datos) es del cambio 16 | Frontera con `data-portability` | ERS SEC-010; Q-28 |

La revisión de readiness del cambio 15 no suma capacidades futuras: los dashboards, los indicadores,
los gráficos y los reportes agregados quedan fuera del MVP.

## Trazabilidad de `data-portability`

Estado: `add-data-portability` archivado el 2026-10-08
(`openspec/changes/archive/2026-10-08-add-data-portability/`). Cierra SEC-010; AC-10, RNF-007 y
SEC-008 siguen como compuertas del go-live del respaldo operativo.

Decisiones de la revisión de readiness del cambio 16 (`add-data-portability`, 2026-10-08), aprobadas
por el dueño del producto como D1 a D9. El ERS pide "un mecanismo para exportar datos y artefactos del
contribuyente" (SEC-010) y ni el ERS ni el CTX fijan su formato: el formato es diseño de portabilidad
del proyecto (Q-28). Los specs distinguen el requisito del ERS, la política del proyecto y la
defensa de recursos.

| Regla | Origen | Fuente |
| --- | --- | --- |
| D1. El cambio 16 cierra SEC-010. No cierra AC-10, RNF-007 ni SEC-008: la restauración se verifica con el respaldo operativo (volcado, artefactos y clave maestra por separado) como compuerta de operación y del go-live. El paquete no se importa ni se restaura, y no hay ida y vuelta por la aplicación | Requisito del ERS (SEC-010) y política del proyecto: la portabilidad no es un respaldo | ERS SEC-010, AC-10, RNF-007, SEC-008; `../architecture/deployment.md` |
| D2. `PORTABILITY_FORMAT_V1`: `datos-AAAAMMDD-HHMMSS.zip` con `manifest.json`, `SHA256SUMS`, `LEEME.txt`, `data/` (empresa, terceros, productos, comprobantes, inventario y auditoría en XLSX), `documents/<produccion\|pruebas>/<tipo>/<documento>/` (el `snapshot.json` y los artefactos) y `assets/logos/`. Sin volcado de PostgreSQL. Las rutas salen solo de componentes generados y validados por el servidor: nunca el RUC, nombres de terceros, correos ni texto escrito por un usuario | Diseño de portabilidad del proyecto | Q-28 |
| El manifiesto contiene `formatVersion` ("1"), `generatedAt`, `snapshotAt`, la identidad fiscal de la empresa, el alcance, los conteos, los ambientes, las versiones de los formatos y de los snapshots, las exclusiones y los artefactos esperados pero ausentes con su motivo, nunca el inventario de archivos. `SHA256SUMS`, compatible con las herramientas estándar, es la autoridad del inventario y cubre todos los archivos interiores salvo él mismo. El SHA-256 del ZIP se calcula aparte y queda en el registro de la exportación, en la pantalla y en la auditoría | Diseño de portabilidad del proyecto | Q-28 |
| D3. Las respuestas originales del SRI se exportan como archivos separados, con sus bytes persistidos exactos, el orden del intento, si son de recepción o de autorización, su SHA-256, su tamaño y si se truncaron, verificadas antes de incluirlas. Nunca en celdas, nunca regeneradas ni consultadas otra vez al SRI, y sin el sobre SOAP saliente, que no se persiste | Requisito del ERS (artefactos del contribuyente) y diseño de portabilidad | ERS SEC-010, §1.2, §2.1; CTX §31; glosario (Artefacto) |
| D4. La auditoría entra en `data/auditoria.xlsx` con lo que su política conserva; nunca IP, user agent, secretos, XML o SOAP ni contraseñas o sus hashes | Política del proyecto | ERS §2.1; `../security/access-control.md` |
| D5. Los usuarios entran solo como metadatos de la organización (nombre, correo, rol y estado); nunca hashes de contraseña, cuentas internas de Better Auth, sesiones ni tokens | Seguridad del proyecto | spec `audit-trail`; `../architecture/authentication.md` |
| D6. Los borradores quedan fuera de la versión 1: el paquete exporta el estado fiscal y operativo durable y sus artefactos, no el espacio de trabajo incompleto. No afirma que los borradores no sean datos; se declara en el manifiesto, en `LEEME.txt` y en la pantalla, el paquete nunca se describe como un respaldo completo y la exclusión no borra nada | Política de portabilidad del proyecto | Readiness del cambio 16 |
| Excluidos siempre: el P12, cifrado o no, su contraseña, la clave de datos envuelta y sus datos de cifrado, y la clave maestra. De las firmas solo salen sus metadatos, y el paquete no permite reconstruir la firma | Seguridad del proyecto | spec `signing-certificate`; ADR 0011 |
| D7. Siempre los dos ambientes cuando tienen datos, separados en las rutas, las columnas y los conteos; nunca el ambiente vigente por defecto de los reportes | Política del proyecto | ERS RF-004 |
| D8. Job durable y registro de la exportación con estados explícitos (`QUEUED`, `GENERATING`, `READY`, `FAILED`, `EXPIRED`; `EXPIRED` solo por vencimiento o reemplazo, y un paquete listo perdido o alterado pasa a `FAILED`), paquete en un directorio privado del sistema de archivos (nunca en PostgreSQL), caducidad, descarga autenticada y el permiso `dataPortability.export` solo del administrador, verificado en el servidor al crear, listar, consultar y descargar; la empresa sale de la sesión. El job renueva su *lease* en lugar de usar uno enorme, y un worker que lo perdió nunca publica (fencing por intento) | Política del proyecto | Readiness del cambio 16; ADR 0012 |
| `DATA_EXPORT_TTL_HOURS` 24, contadas desde que el paquete queda listo, `DATA_EXPORT_MAX_CONCURRENT` 1 por instancia, una generación activa por empresa, sin paquetes vigentes ilimitados y una reserva de disco antes de copiar los artefactos. Sin máximo de filas: el paquete está completo o falla | Defensa de recursos del proyecto, hipótesis hasta `bench:data-portability` | Q-26 |
| D9. ZIP64 obligatorio (más de 65 535 entradas y más de 4 GiB). La primera tarea del apply es un spike y el ADR 0024 entre ampliar el contenedor propio y una biblioteca de producción mantenida; la dependencia queda preautorizada si el ADR demuestra todos sus criterios. El escritor XLSX pasa a una capa neutral sin cambiar su comportamiento | Decisión de arquitectura | ADR 0023; readiness del cambio 16 |
| Consistencia en dos fases: una transacción `REPEATABLE READ, READ ONLY` genera los XLSX y fija el inventario inmutable de artefactos con su tamaño y su SHA-256 (`snapshotAt`); después, fuera de transacción, se copian solo esos artefactos comprobando su tamaño y su hash. Un artefacto alterado hace fallar la exportación sin paquete parcial; uno legítimamente ausente se declara con su motivo | Política del proyecto | ERS RF-407; spec `document-archive` |
| Eventos `data_export.requested`, `data_export.completed`, `data_export.failed` y `data_export.download_started`, este justo antes del primer byte (si no se registra, no se entrega). Nunca un evento por comprobante ni un `downloaded` | Política del proyecto | ERS RNF-006 |
| Verificación del paquete con `SHA256SUMS` y lectores independientes (ZIP, XLSX, JSON y XSD), nunca con una reimportación | Política del proyecto | ERS SEC-010 |

La revisión de readiness del cambio 16 no suma capacidades futuras: la importación, la restauración
desde el paquete y la portabilidad de los borradores quedan fuera del MVP.

## Huecos de trazabilidad

El ERS §19 no asigna criterio de aceptación a estos requisitos. Cada cambio que los
implemente define escenarios propios en sus specs (Q-32):

- Autenticación, roles y usuarios (ERS RF-001, RF-002, RF-409).
- Punto de emisión predeterminado por usuario (ERS RF-113).
- Auditoría (ERS RF-003, RF-105, RF-525).
- Distinción de ambientes y advertencia de Pruebas (ERS RF-004, RF-005).
- Validación previa a la firma, decimal exacto, autoría y borradores (ERS RF-006..010): los escenarios de `document-emission` e `invoices` de `add-invoice-emission`.
- Alertas de vencimiento de la firma (ERS RF-135).
- API y OpenAPI (ERS API-001..006), cubiertos solo por "pruebas de contrato".
- Portabilidad de datos (ERS SEC-010): el ERS §18.2 no le asigna criterio; AC-10 es la restauración del respaldo operativo.

CTX sí aporta criterios verificables para el motor fiscal: invariantes I-01..I-20 (§61),
casos de recuperación A–E (§52), pruebas de propiedades (§51) y la matriz de certificación
(§49). Ver `../quality/testing.md`.
