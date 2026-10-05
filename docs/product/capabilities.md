# Capacidades

Mapa de las capacidades del MVP, su trazabilidad a las fuentes (`ERS`, `CTX`) y el orden
propuesto de los cambios OpenSpec que las construirán. Una capacidad se convierte en
`openspec/specs/<capacidad>/` solo cuando se archiva un cambio que la implementa; este
documento no especifica comportamiento.

## Mapa

| Capacidad              | Qué permite                                                                                       | Fuentes                                                        | Aceptación    | Preguntas abiertas             |
| ---------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------- | ------------------------------ |
| `user-access`          | Iniciar sesión, roles Administrador y Operador, alta y desactivación de usuarios por el administrador. | ERS RF-001, RF-002, RF-409, SEC-001, SEC-005                  | Falta (Q-32)  | Q-41                           |
| `taxpayer-setup`       | Datos de empresa, atributos tributarios, logo, ambiente, establecimientos, puntos, punto predeterminado por usuario y preparación para emitir. | ERS RF-004, RF-005, RF-101..113; CTX §5, §6, §37 | AC-01 | — (Q-23, Q-31 y Q-42 resueltas) |
| `fiscal-numbering`     | Secuenciales atómicos y únicos, y su ajuste administrativo auditado.                              | ERS RF-120..125, RNF-003; CTX §5, §28                          | AC-04         | — (Q-02 resuelta)               |
| `signing-certificate`  | Cargar, validar, reemplazar y vigilar el vencimiento de la firma.                                 | ERS RF-130..135, SEC-002, SEC-004; CTX §20                     | AC-02         | — (Q-17 resuelta)              |
| `fiscal-catalogs`      | Catálogos oficiales versionados, política de consumidor final, registro de esquemas y matriz de casos especiales. | ERS RF-234, SRI-REQ-12; CTX §3.1, §18, §19.3, §35, §38 | AC-03      | — (Q-25 y Q-38 resueltas)      |
| `parties`              | Catálogo único de terceros con roles y búsqueda, y el consumidor final del sistema.               | ERS RF-320..323; CTX §9                                        | AC-02, AC-03  | — (Q-26 parcial: volumen de terceros medido) |
| `products`             | Productos y servicios con precio exacto, referencias fiscales, estado tributario derivado y búsqueda. | ERS RF-301..305; CTX §12.4, §12.5                          | AC-08         | — (Q-26 parcial: volumen de productos medido) |
| `document-emission`    | Núcleo común: emisión idempotente, snapshot, máquina local `RESERVED` → `SIGNED`, clave de acceso, XML, XSD y firma, hasta el artefacto firmado. | ERS RF-006..010, RF-520..525, SRI-REQ-02..05, SRI-REQ-11; CTX §4, §8, §10, §11, §19–21, §39, §41 | AC-02, AC-05 | — (Q-08, Q-14, Q-29, Q-30, Q-35, Q-38, Q-39 y Q-44 resueltas; de Q-34 quedan el SOAP y el PDF; Q-26 parcial: emisión medida con `bench:emission`) |
| `sri-transmission`     | Transmisión con jobs desde `SIGNED`: recepción, autorización asíncrona, errores 43/45/70, reconciliación por clave de los resultados inciertos (automática o del administrador), revisión manual, límite de tamaño versionado y respuestas originales inmutables. Nace apagada. Sin observación de anulaciones (Q-16) ni corrección de devueltos (BR-28). | ERS SRI-REQ-01, SRI-REQ-06..10, RNF-004; CTX §7, §22–27, §29, §32–34, §44, §52 | AC-02, AC-06 | — (Q-06, Q-07 y Q-48 resueltas; Q-47 resuelta como compuerta previa a la transmisión real; Q-16 diferida; Q-34 SOAP resuelta) |
| `correct-returned-document` | Corregir un comprobante `DEVUELTA` (BR-28) con revisión o versionado de solo agregado, si la norma permite conservar la misma identidad. Capacidad futura, separada de `sri-transmission`. | ERS §12.1 (`RETURNED` corregible); CTX §26.1, §27.1 | — | Q-08 (fecha), Q-07 (resuelta) |
| `cancellation-observation` | Detectar anulaciones de comprobantes autorizados con la consulta de validez (`PENDIENTE DE ANULAR`, `ANULADO`). Capacidad futura, fuera de `sri-transmission`. | CTX §24, §36 | — | Q-16 |
| `invoices`             | Factura con consumidor final, líneas, pagos y totales; borradores editables antes de emitir.      | ERS RF-010, RF-201..206; CTX §12, §35                          | AC-02, AC-08  | Q-45, Q-46 (Q-18 y Q-19 resueltas) |
| `credit-notes`         | Nota de crédito desde un comprobante, con devolución de stock opcional.                           | ERS RF-210..213; CTX §13                                       | AC-03         | Q-10, Q-20                     |
| `debit-notes`          | Nota de débito sobre un comprobante.                                                              | ERS RF-220..222; CTX §14                                       | AC-03         | —                              |
| `withholding-receipts` | Comprobante de retención 2.0.0 con documentos sustento.                                           | ERS RF-230..234; CTX §16                                       | AC-03         | —                              |
| `shipping-guides`      | Guía de remisión con transportista y destinatarios.                                               | ERS RF-240..243; CTX §15                                       | AC-03         | —                              |
| `purchase-settlements` | Liquidación de compra separada de la factura.                                                     | ERS RF-250..253; CTX §17                                       | AC-03         | Q-12                           |
| `inventory`            | Stock opcional contabilizado por hechos fiscales autorizados, no reserva de disponibilidad: inicialización única con `INICIAL`; la salida de una factura nace al entrar en `AUTHORIZED` con la decisión congelada en su snapshot (Q-18) y el saldo puede quedar negativo (Q-19); entradas y ajustes idempotentes; movimientos inmutables y kárdex; control fail-closed y no retroactivo; aviso orientativo en el borrador. Sin stock reservado ni comprometido. Medido con `bench:inventory`. | ERS RF-310..315, RF-205, RF-206, RF-212                        | AC-08         | Q-20 (cambio 10) (Q-18, Q-19 y Q-21 resueltas) |
| `document-archive`     | Bandeja única de los comprobantes desde la reserva, con filtros; RIDE generado una vez desde el XML autorizado (o el firmado transmitido, con su procedencia) para la factura 1.1.0 que el sistema emite; descargas verificadas por hash del RIDE y de los XML; impresión como acción explícita; historial de entregas observables (`DOWNLOAD`, `PRINT_REQUESTED`). Sin correo (Q-24, P1). | ERS RF-401..409; CTX §30, §31, §45, §46                        | AC-07         | Q-16 (futura), Q-27 (go-live) (Q-24 y Q-39 resueltas; el PDF de Q-34, con S-4 y el ADR 0022) |
| `reports`              | Reportes filtrables exportados a XLSX.                                                            | ERS RF-501..505                                                | AC-09         | Q-26                           |
| `audit-trail`          | Auditoría de cambios críticos y de transiciones de estado.                                        | ERS RF-003, RF-105, RF-525, SEC-007, RNF-006                   | Falta (Q-32)  | —                              |
| `data-portability`     | Exportar los datos y artefactos del contribuyente.                                                | ERS SEC-010, RNF-007                                           | AC-10         | Q-28                           |

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
| —   | Spikes técnicos, sin OpenSpec | Validación de `facturacion-electronica-ec`: XSD (S-2, ejecutado, ADR 0021), factura offline (S-3 offline, ejecutado con el builder propio de Q-44), autorización en Pruebas (S-3 online, compuerta de go-live) y PDF (S-4) (Q-34, ADR 0018) | 0 | ADRs de dependencias |
| 6   | `add-invoice-emission`     | `document-emission`, `invoices`                       | 3, 4, 5a, 5b, spike | AC-05    |
| 7   | `add-sri-transmission`     | `sri-transmission`                                    | 6              | AC-06; AC-02 parcial (el RIDE llega con el cambio 8 y la autorización real con S-3 online) |
| 8   | `add-document-archive`     | `document-archive`                                    | 7              | AC-07; completa AC-02 con S-3 online |
| 9   | `add-minimal-inventory`    | `inventory`                                           | 7              | AC-08         |
| 10  | `add-credit-notes`         | `credit-notes`                                        | 7, 9           | AC-03 parcial |
| 11  | `add-debit-notes`          | `debit-notes`                                         | 7              | AC-03 parcial |
| 12  | `add-withholding-receipts` | `withholding-receipts`                                | 7              | AC-03 parcial |
| 13  | `add-shipping-guides`      | `shipping-guides`                                     | 7              | AC-03 parcial |
| 14  | `add-purchase-settlements` | `purchase-settlements`                                | 7              | AC-03         |
| 15  | `add-reports-export`       | `reports`                                             | 8              | AC-09         |
| 16  | `add-data-portability`     | `data-portability`                                    | 8              | AC-10         |

Capacidades futuras sin número en la secuencia, decididas en la revisión de readiness del cambio 7
(2026-10-03): `correct-returned-document` (corrección de un devuelto, BR-28) y
`cancellation-observation` (observación de anulaciones, Q-16). Ninguna amplía `add-sri-transmission`.

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

CTX sí aporta criterios verificables para el motor fiscal: invariantes I-01..I-20 (§61),
casos de recuperación A–E (§52), pruebas de propiedades (§51) y la matriz de certificación
(§49). Ver `../quality/testing.md`.
