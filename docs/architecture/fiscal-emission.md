# Emisión fiscal y orquestación SRI

Arquitectura del motor fiscal y de la integración con el SRI. Reconcilia el ERS con CTX y
fija las decisiones del proyecto. No copia el protocolo del SRI: para los detalles técnicos
remite a las secciones de `docs/product/project-sri-integration.md` (CTX). Lo marcado con
`Q-xx` es una propuesta pendiente de `docs/product/open-questions.md`.

## Referencias de CTX que se aplican sin cambios

| Tema                                       | CTX          |
| ------------------------------------------ | ------------ |
| Orden de autoridad de las fuentes          | §1           |
| Web Services por ambiente                  | §7           |
| Clave de acceso y módulo 11                | §8           |
| Identificaciones                           | §9           |
| Reglas XML: UTF-8, orden, escapado, fechas, decimales | §10 |
| `infoTributaria` y snapshot del emisor     | §11          |
| Estructura de cada tipo de comprobante     | §12–17       |
| Catálogos fiscales mínimos                 | §18          |
| Validación XSD, registro y pruebas         | §19          |
| Parámetros de firma XAdES-BES              | §20          |
| Códigos de error y su tratamiento          | §32          |
| Normalización de respuestas                | §44          |
| Seguridad de logs y métricas               | §47, §48     |
| Pruebas de certificación, golden files, propiedades y recuperación | §49–52 |
| Política y checklist de cambios normativos | §53, §54     |
| Qué no se codifica en duro                 | §55          |
| Invariantes I-01..I-20                     | §61          |
| Definition of Done del motor y del go-live | §58, §59     |
| Checklist de PR fiscal                     | §65          |

## Pipeline

```text
                     ┌──────────────── petición HTTP ─────────────────┐
borrador ── Emitir ─▶│ 1 validar ─▶ 2 reservar ─▶ 3 XML ─▶ 4 XSD ─▶ 5 firmar │─▶ respuesta
                     └────────────────────────────────────────────────┘
                                                    │ job encolado en la misma transacción
                     ┌──────────────── jobs persistidos ───────────────┐
                     │ 6 recepción ─▶ 7 autorización ─▶ 8 RIDE ─▶ 9 entrega │
                     │ 10 reconciliación     11 recuperación     12 validez │
                     └────────────────────────────────────────────────┘
```

| Paso | Qué ocurre                                                                                                                       | Estado resultante                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | Validación de negocio sin efectos: permisos, preparación para emitir, reglas del tipo, consumidor final, casos especiales no soportados (falla cerrada), certificado vigente. | `DRAFT` sin cambios si falla |
| 2    | Una transacción: reclama la clave de idempotencia, transición guardada desde `DRAFT`, reserva el secuencial, congela el snapshot, genera el código numérico y calcula la clave de acceso. | `SEQUENCE_RESERVED` |
| 3    | Construye el XML desde el snapshot con el builder de la versión registrada; guarda el hash del XML sin firmar.                     | `XML_BUILT`                          |
| 4    | Valida contra el XSD registrado. Falla cerrada si falta el XSD, su hash no coincide o la versión no está registrada (CTX §19.2).   | `XSD_VALID` o `XSD_INVALID`          |
| 5    | Valida el certificado, firma, verifica el límite de tamaño y persiste el XML firmado con su hash; en la misma transacción encola la transmisión. | `SIGNED`                    |
| 6    | Job de recepción: envía el XML firmado persistido y persiste la respuesta original antes de clasificarla.                        | Ver clasificación                    |
| 7    | Job de autorización: consulta por clave con backoff y jitter; persiste la respuesta; extrae el XML autorizado (CTX §34, §45).      | `AUTHORIZED`, `NOT_AUTHORIZED`, o sigue pendiente |
| 8    | Job de RIDE: lo genera desde el comprobante autorizado y lo guarda como artefacto (CTX §30).                                      | Sin cambio de estado                 |
| 9    | Entrega: registra la descarga, la impresión o el correo (CTX §46, Q-24).                                                          | Sin cambio de estado                 |
| 10   | Job de reconciliación: consulta por la misma clave para resolver `SEND_UNKNOWN` y los errores 43 y 45.                            | Ver máquina de estados               |
| 11   | Job de recuperación: reanuda comprobantes detenidos en estados locales tras una caída y pasa a `SEND_UNKNOWN` los que quedaron en `SEND_PENDING`. | Ver máquina de estados   |
| 12   | Job de validez: consulta periódica de comprobantes autorizados para detectar anulaciones (Q-16).                                  | `CANCEL_PENDING`, `CANCELLED`        |

Reglas:

- El orden es invariante: nunca se firma sin XSD válido ni se llama a la red sin el XML firmado persistido (ERS SRI-REQ-03, SRI-REQ-05; CTX §19.1, §21).
- Cada estado persistido es un punto de reanudación. Si el proceso muere, el job de recuperación continúa desde el último estado sin repetir efectos.
- La respuesta de emisión no espera al SRI: devuelve comprobante, clave de acceso, secuencial y estado, y el cliente sigue el avance (CTX §41).
- La transmisión se encola en la misma transacción que deja el comprobante en `SIGNED`, para que ninguna caída lo deje firmado sin job.
- Un borrador se puede eliminar; desde `SEQUENCE_RESERVED` el comprobante nunca se borra.

## Máquina de estados

Propuesta para Q-35: el conjunto de CTX §26 sin el estado `SENT` de CTX §22.1, con
`RETURNED` y `XSD_INVALID` no terminales. Las transiciones de anulación dependen de Q-16.

```text
Camino feliz
  DRAFT → SEQUENCE_RESERVED → XML_BUILT → XSD_VALID → SIGNED → SEND_PENDING
        → RECEIVED → PENDING_AUTHORIZATION → AUTHORIZED

Ramas
  XML_BUILT             → XSD_INVALID → (corrección) → XML_BUILT
  SEND_PENDING          → RETURNED    → (corrección) → XML_BUILT
  SEND_PENDING          → PENDING_AUTHORIZATION                       (error 70)
  SEND_PENDING          → SEND_UNKNOWN → (reconciliación) → PENDING_AUTHORIZATION
                                                           | AUTHORIZED | NOT_AUTHORIZED
                                                           | SIGNED (reenviar el mismo XML)
                                                           | MANUAL_REVIEW
  PENDING_AUTHORIZATION → NOT_AUTHORIZED | MANUAL_REVIEW
  AUTHORIZED            → CANCEL_PENDING → CANCELLED                  (Q-16)
```

| Desde                              | Hacia                   | Disparador                                                                 | Actor                |
| ---------------------------------- | ----------------------- | -------------------------------------------------------------------------- | -------------------- |
| `DRAFT`                            | `SEQUENCE_RESERVED`     | Emitir, con validación de negocio aprobada.                                | Usuario              |
| `SEQUENCE_RESERVED`                | `XML_BUILT`             | XML generado desde el snapshot.                                            | Sistema              |
| `XML_BUILT`                        | `XSD_VALID`             | XML válido.                                                                | Sistema              |
| `XML_BUILT`                        | `XSD_INVALID`           | XML inválido o esquema no registrado.                                      | Sistema              |
| `XSD_INVALID`, `RETURNED`          | `XML_BUILT`             | Corrección de datos que no componen la clave; misma clave y secuencial (BR-28). | Usuario autorizado |
| `XSD_VALID`                        | `SIGNED`                | XML firmado y persistido con su hash.                                      | Sistema              |
| `SIGNED`                           | `SEND_PENDING`          | El job toma el envío.                                                      | Sistema              |
| `SEND_PENDING`                     | `RECEIVED`              | `RECIBIDA`.                                                                | Sistema              |
| `SEND_PENDING`                     | `RETURNED`              | `DEVUELTA` por inconsistencia corregible.                                  | Sistema              |
| `SEND_PENDING`                     | `PENDING_AUTHORIZATION` | Error 70: clave en procesamiento (CTX §27.2).                              | Sistema              |
| `SEND_PENDING`                     | `SEND_UNKNOWN`          | Timeout, error de red o de proxy, SOAP ilegible, caída del proceso, error 43 o 45. | Sistema      |
| `SEND_UNKNOWN`                     | `PENDING_AUTHORIZATION` | La consulta indica que el SRI procesa la clave.                            | Sistema              |
| `SEND_UNKNOWN`                     | `AUTHORIZED`            | La consulta devuelve `AUTORIZADO`.                                         | Sistema              |
| `SEND_UNKNOWN`                     | `NOT_AUTHORIZED`        | La consulta devuelve `NO AUTORIZADO`.                                      | Sistema              |
| `SEND_UNKNOWN`                     | `SIGNED`                | El SRI no conoce la clave: se reenvía el mismo XML firmado (caso A, CTX §52). | Sistema           |
| `SEND_UNKNOWN`                     | `MANUAL_REVIEW`         | Intentos agotados o inconsistencia, como un secuencial registrado con otra clave. | Sistema        |
| `RECEIVED`                         | `PENDING_AUTHORIZATION` | Primera consulta tras el intervalo configurado.                            | Sistema              |
| `PENDING_AUTHORIZATION`            | `AUTHORIZED`            | `AUTORIZADO`.                                                              | Sistema              |
| `PENDING_AUTHORIZATION`            | `NOT_AUTHORIZED`        | `NO AUTORIZADO`.                                                           | Sistema              |
| `PENDING_AUTHORIZATION`            | `PENDING_AUTHORIZATION` | En procesamiento: nuevo intento con backoff.                               | Sistema              |
| `PENDING_AUTHORIZATION`            | `MANUAL_REVIEW`         | Ventana agotada (Q-06) o respuesta sin el bloque esperado (CTX §34).       | Sistema              |
| `MANUAL_REVIEW`                    | `SEND_UNKNOWN`          | El administrador ordena reconciliar.                                       | Administrador        |
| `MANUAL_REVIEW`                    | `XML_BUILT`             | El administrador corrige, solo si el SRI no tiene la clave.                | Administrador        |
| `AUTHORIZED`                       | `CANCEL_PENDING`        | La consulta de validez devuelve `PENDIENTE DE ANULAR` (Q-16).              | Sistema              |
| `AUTHORIZED`, `CANCEL_PENDING`     | `CANCELLED`             | La consulta de validez devuelve `ANULADO` (Q-16).                          | Sistema              |
| `CANCEL_PENDING`                   | `AUTHORIZED`            | La consulta de validez vuelve a `AUTORIZADO`.                              | Sistema              |

Reglas:

- Toda transición es una actualización guardada (`WHERE state = :esperado`) que verifica las filas afectadas; cero filas significa que otro proceso ganó y la operación no informa éxito (`idempotency.md`).
- Cada transición registra en la misma transacción el estado anterior y el nuevo, la causa, el actor y metadatos técnicos no sensibles (ERS RF-525).
- `SEND_UNKNOWN` nunca es terminal. `RECIBIDA` nunca lleva a `AUTHORIZED`, y un timeout nunca lleva a `NOT_AUTHORIZED` (CTX I-15, I-16).
- `NOT_AUTHORIZED` es terminal hasta resolver Q-07; reemitir crea un borrador nuevo.
- Una corrección genera un XML firmado nuevo; los artefactos anteriores se conservan.

## Reserva del secuencial

La implementa `add-fiscal-numbering` (módulo `fiscal`) como operación interna
`reserveSequentialIn(scope, clave)`, sin ruta HTTP. La clave es empresa, ambiente,
establecimiento, punto y tipo (ADR 0003). Dentro de la transacción del llamador:

1. **Comienzo:** lee la disponibilidad del punto. Si él o su establecimiento están inactivos, la rechaza sin tocar el contador. Si estaban activos, la reserva se completa aunque una desactivación se confirme mientras está en curso.
2. **Creación perezosa:** crea el contador con `INSERT ... ON CONFLICT DO NOTHING`. Dos primeras reservas simultáneas no producen un error de restricción: la segunda espera la confirmación de la primera.
3. **Incremento:** un `UPDATE ... RETURNING` que avanza `next_number` y bloquea la fila del contador hasta el fin de la transacción, igual que el `SELECT ... FOR UPDATE` de CTX §28. Si el contador está agotado tras el `999999999`, falla con `SEQUENCE_EXHAUSTED`.
4. **Registro:** actualiza `last_reserved` y registra la reserva en `fiscal_sequence_reservation`, cuya restricción única (CTX §5, con el ambiente) respalda la reserva ante cualquier error de código.

- La transacción contiene solo operaciones de base de datos, sin I/O externo, y usa la configuración por defecto de Prisma (`maxWait` 2 s para adquirirla, `timeout` 5 s de duración). La prueba de ERS AC-04 mide como máximo 750 ms por reserva con 120 simultáneas en dos instancias (design D5 de `add-fiscal-numbering`).
- El número reservado nunca vuelve al contador (BR-08) y `next_number > last_reserved` lo impone la base de datos.

## Obligaciones que deja `add-taxpayer-setup`

`add-invoice-emission` debe recoger en sus tareas:

- **Identidad tributaria.** Invocar `lockTaxIdentityIn` (módulo `taxpayer`) dentro de la transacción del hito que defina, como máximo al crear el primer artefacto fiscal que deba conservarse (Q-31). La operación toma el lock advisory de configuración de la empresa (`company-config:<company_id>`), es idempotente y fija el RUC vigente; después, ninguna versión nueva puede cambiarlo.
- **Versión de configuración.** El snapshot del comprobante referencia la versión vigente de `company_config_version` leída en la misma transacción de la reserva, y el XML y el RIDE se construyen solo desde ella (CTX §11, §39).
- **Ambiente.** El ambiente se fija en el snapshot al reservar, de modo que un cambio de ambiente posterior no afecta a una emisión en curso (CTX §6).
- **Preparación para emitir.** La emisión consulta la misma evaluación de requisitos de `GET /api/v1/company/status` y se bloquea si la empresa no está preparada (BR-03).
- **Punto predeterminado.** Solo se preselecciona si sigue disponible; nunca restringe desde dónde se emite (Q-23).
- **Categoría RIMPE y anexos.** Traducir la categoría declarada a la leyenda que corresponda según la matriz del ADR 0014 (anexos 21, 22 y 24, `CONDITIONAL_ISSUER_RULE`); el XSD solo admite el texto fijo `CONTRIBUYENTE RÉGIMEN RIMPE`.
- **Casos especiales no soportados.** Si una operación requiere un caso especial que el sistema no soporta, se rechaza de forma explícita en el paso 1, antes de reservar; nunca se degrada en silencio a un comprobante ordinario (ADR 0014).

## Obligaciones que deja `add-fiscal-numbering`

`add-invoice-emission` debe recoger en sus tareas:

- **Dónde reservar.** Invocar `reserveSequentialIn` dentro de la transacción del paso 2 del pipeline, con el ambiente del snapshot y la configuración de transacción por defecto que la prueba de AC-04 respalda. Mientras mantiene bloqueada la fila del contador, la transacción no hace I/O externo: ni firma, ni llamadas al SRI, ni almacenamiento de archivos, ni correo.
- **Qué significa reservado.** Una reserva que se revierte antes del commit no ha reservado el número. Una vez confirmado el commit, el número no se reutiliza aunque fallen la generación del XML, la firma, el envío al SRI, el RIDE u otra operación posterior; el hueco se tolera.
- **Frontera del commit.** No tratar el número como reservado fuera de la transacción hasta que la reserva se haya confirmado. Eso excluye devolverlo al cliente, registrarlo como reservado, construir, firmar o enviar el XML con él, o exponerlo de cualquier otra forma antes del commit.
- **Referencia.** El comprobante referencia la fila de `fiscal_sequence_reservation` y repite la unicidad del secuencial como segunda defensa.
- **Errores de la reserva.** Traducir `EMISSION_POINT_UNAVAILABLE`, `EMISSION_POINT_NOT_FOUND` y `SEQUENCE_EXHAUSTED` en el resultado de la emisión, y registrar como advertencia en el log la reserva agotada (design D15 de `add-fiscal-numbering`).

## Obligaciones que deja `add-signing-certificate`

`add-invoice-emission` debe recoger en sus tareas:

- **Firma utilizable.** Antes de firmar, consultar la misma condición que la preparación para emitir (`SigningCertificateReadiness`): firma vigente (no vencida) cuyo secreto abre la clave de custodia configurada. Si no lo es, la emisión se bloquea con el motivo, que la pantalla `Firma electrónica` ya explica.
- **Secreto solo en el adaptador de firma.** `CertificateVault.open` se invoca solo dentro de la tarea de firma, con la ligadura empresa y certificado. Su `CustodyError` se traduce a firma no disponible. El P12 y la contraseña viven en memoria durante `sign` y se ponen a cero después (ADR 0011).
- **Fuera del event loop.** La firma de XML es una tarea más de `CryptoWorkerPool` (`platform/workers`): CPU síncrona de 42 ms a 1,3 s según las iteraciones del P12 (spike S-6). Usa la misma concurrencia acotada y el mismo timeout, y propaga `CRYPTO_BUSY` y `CRYPTO_TIMEOUT` como errores tipados.
- **Certificado embebido.** Comprobar en cada firma que el certificado que embebe el firmador es el de la firma vigente (misma huella), como hace la firma de prueba al cargar.
- **Nunca en registros.** Ni bytes del P12, ni contraseña, ni clave privada, ni el XML firmado en logs, errores, auditoría o métricas.
- **Errores de la firma.** `CERTIFICATE_*` y `CRYPTO_*` se traducen al resultado de la emisión; un fallo de firma después de reservar el secuencial deja un hueco, nunca reutiliza el número.

### Proveedores validados

Compatibilidad y validación no son lo mismo (Q-17, design D4 de `add-signing-certificate`):

- **Compatible:** el certificado pasa las reglas técnicas de la carga.
- **Proveedor validado:** se probó al menos un P12 real de ese proveedor, que se cargó, firmó un comprobante autorizado en Pruebas y cuyo RUC se extrajo con un extractor registrado.

Con fixtures sintéticos ningún proveedor figura aquí; Security Data está cubierto solo estructuralmente (OID `1.3.6.1.4.1.37746.3.11`). El primer proveedor validado será preferentemente el del primer cliente piloto: es requisito del go-live (`definition-of-done.md`).

| Proveedor | P12 probado | Ubicación del RUC | Resultado | Fecha |
| --- | --- | --- | --- | --- |
| — | Ninguno todavía | — | — | — |

## Obligaciones que deja `add-fiscal-catalogs`

`add-invoice-emission` debe recoger en sus tareas (design D15 de `add-fiscal-catalogs`):

- **Una sola resolución de vigencia.** Cada impuesto, forma de pago o tipo de identificación se resuelve con `resolveCatalogEntry(catalogType, entryKey, fecha)` del módulo `catalogs`, con la fecha de emisión del comprobante en hora de Ecuador o, cuando la regla del documento lo pida, la del documento sustento (BR-33). Nada fuera de `catalogs` lee sus tablas, y nadie reimplementa la regla.
- **Reproducibilidad.** El snapshot guarda el identificador estable de cada versión aplicada y copia sus valores (código, descripción oficial, tarifa, fuente) (BR-21).
- **Utilizable.** Una entrada solo se usa si `isUsable`: habilitada para la empresa según `effectiveEnablement` y con versión aplicable en la fecha.
- **ICE e IRBPNR.** No se calculan mientras el catálogo no tenga sus tarifas con fuente legal: la ficha v2.34 solo publica códigos (`OFFICIAL_REFERENCE`). La emisión de un producto con ICE o IRBPNR se rechaza de forma explícita hasta que una versión del dataset los traiga.
- **IVA diferenciado.** El código 8 no tiene porcentaje fijo (nota 3 de la tabla 17): hace falta una política con fuente antes de emitir con él.
- **Consumidor final.** La política vigente (`consumer_final_policy`, USD 50 al corte) y su identidad canónica se aplican en el paso 1, antes de reservar. El tercero del sistema que la usa lo crea `add-parties-and-products` (ver sus obligaciones).
- **Casos especiales.** La matriz (`special_case_support`, ADR 0014) se aplica en el paso 1: lo no soportado se rechaza de forma explícita.
- **Decimales.** Los importes y tarifas llegan como `DecimalString` validados con las especificaciones de `packages/contracts/src/decimal.ts`, que salen de los XSD (`decimal-policy.md`). El redondeo de líneas y totales (Q-14) usa `roundHalfUp` de `platform/decimal`.
- **Esquemas.** Los XSD del registro (`schema_registry_entry`) se registran en la librería al arrancar el motor (ADR 0008).

## Obligaciones que deja `add-parties-and-products`

`add-invoice-emission` debe recoger en sus tareas (design D5, D7 y D8 de
`add-parties-and-products`):

- **Fecha del documento, no el estado mostrado.** El estado tributario de un producto (`READY`, `REVIEW_REQUIRED`, `INCOMPLETE`) es orientativo y se evalúa hoy. La emisión vuelve a resolver cada referencia (`catalogType`, `entryKey`) con la fecha del documento, mediante las lecturas internas de `catalogs` (`availability`, `resolveCatalogEntry`). Una referencia no utilizable en esa fecha detiene la emisión antes de reservar.
- **Datos de cálculo completos.** Un comprobante no puede continuar si necesita calcular un impuesto cuya referencia esté en `INCOMPLETE` en la fecha del documento (`calculationData: MISSING`): hoy, ICE sin tarifa legal, IRBPNR sin valor legal e IVA diferenciado sin política de cálculo. Que la entrada exista no basta.
- **Sin tarifas copiadas.** El producto solo guarda referencias; las tarifas y valores se toman de la versión resuelta y se copian al snapshot (BR-21), nunca del producto ni de `facturacion-electronica-ec`.
- **Consumidor final por su marca.** El comprador consumidor final se reconoce por `systemRecord: CONSUMER_FINAL`, nunca comparando su identificación o su razón social. Su identidad es la del tercero del sistema de la empresa.
- **Límite de consumidor final en la emisión.** El monto máximo (USD 50 al corte) sigue en la política versionada y se aplica en el paso 1 con la fecha del documento; el tercero no lo guarda.
- **Precio sin impuestos.** `unitPrice` es el `precioUnitario` del XSD, antes de impuestos y con la escala de `decimal-policy.md`; los subtotales, impuestos y totales los calcula la emisión (Q-14).

## Motor SRI (ADR 0018)

`facturacion-electronica-ec` aporta las piezas del protocolo detrás de puertos propios. La
orquestación de este documento sigue siendo de la aplicación.

- **Qué se usa:** sus builders, `generateClaveAcceso`, `validateXmlAgainstXsd`, `EcSriSigner` y `SriClient`, este último como transporte.
- **Qué no se usa:** `emitir*`, `ISequenceProvider` ni `EmissionHooks`.
- **Secuencial.** Lo reserva siempre `reserveSequentialIn` en el paso 2. Ningún adaptador implementa `rollback` ni pide otro secuencial:
  - un `DEVUELTA` nunca devuelve el número al contador (BR-08);
  - el error 70 se trata con la misma clave, nunca con un secuencial nuevo.
- **Código numérico.** Lo genera la aplicación con `crypto.randomInt`, porque `generateCodigoNumerico` de la librería usa `Math.random` en ESM.
- **Importes.** El motor decimal redondea y la librería solo formatea; las pruebas de contrato comparan el XML con los importes esperados.
- **Respuestas del SRI.** El `fetch` inyectado en `SriClient` captura la respuesta original, que se persiste antes de actuar. La clasificación de la tabla de abajo se hace sobre esa respuesta, porque `SriClient`:
  - toma una recepción sin estado como `DEVUELTA`;
  - toma una autorización sin bloque como `NO AUTORIZADO`;
  - devuelve solo la primera de varias autorizaciones.
- **Firma.**
  - La custodia descifra el P12 solo para `sign`.
  - La librería nunca recibe el secreto cifrado.
  - No hay logs ni hooks con XML o secretos.
  - Antes de firmar se comprueba que el certificado embebido es el inspeccionado al cargarlo.

## Clave de acceso

Composición, módulo 11 y pruebas obligatorias en CTX §8. En este proyecto:

- Se calcula y persiste en el paso 2, desde el snapshot congelado; nunca se recalcula.
- El código numérico sale de un generador aleatorio criptográfico y se guarda una sola vez (CTX §8.4).
- La unicidad la imponen las restricciones de secuencial y de clave, no el código numérico.
- Ningún reintento, reconciliación ni corrección genera otra clave.

## Idempotencia de la emisión

| Capa | Mecanismo                                                                                   | Protege contra                                       |
| ---- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1    | `Idempotency-Key` reclamada antes de ejecutar; el alcance se decide en Q-30.                 | Doble clic, reintentos HTTP, reenvíos del cliente.   |
| 2    | Transición guardada desde `DRAFT`.                                                           | Dos emisiones del mismo borrador con claves distintas. |
| 3    | Unicidad del secuencial y de la clave de acceso.                                             | Cualquier camino de código que intente duplicar.     |
| 4    | Todo envío usa el XML firmado persistido; nunca se reconstruye para reintentar.             | Nuevas claves o secuenciales tras un timeout.        |
| 5    | Clave de deduplicación por comprobante y paso en cada job, más verificación del estado.      | Jobs ejecutados dos veces.                           |
| 6    | Unicidad del movimiento de stock por comprobante, producto y tipo.                           | Doble descuento de inventario (ERS AC-08).           |

Reglas generales en `idempotency.md`.

## Clasificación de respuestas del SRI

| Respuesta                                                       | Tratamiento                                                                 | Estado                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| Recepción `RECIBIDA`                                            | Programar la consulta de autorización tras el intervalo configurado.        | `RECEIVED`              |
| Recepción `DEVUELTA` por inconsistencia                          | Persistir todos los mensajes; el usuario corrige.                           | `RETURNED`              |
| Error 70: clave en procesamiento                                | No reenviar ni cambiar clave o secuencial; consultar la autorización.       | `PENDING_AUTHORIZATION` |
| Error 43: clave registrada                                      | Consultar por la clave y reconciliar.                                       | `SEND_UNKNOWN`          |
| Error 45: secuencial registrado                                 | Bloquear el reuso, reconciliar y escalar si no coincide.                    | `SEND_UNKNOWN`          |
| Timeout, conexión reiniciada, error de proxy, SOAP ilegible     | No es un rechazo; reconciliar por la misma clave.                           | `SEND_UNKNOWN`          |
| Autorización `AUTORIZADO`                                       | Guardar la respuesta original, extraer el XML autorizado, calcular su hash, registrar número y fecha. | `AUTHORIZED` |
| Autorización `NO AUTORIZADO`                                    | Persistir los mensajes.                                                     | `NOT_AUTHORIZED`        |
| Autorización en procesamiento                                   | Reprogramar con backoff y jitter dentro de la ventana.                      | `PENDING_AUTHORIZATION` |
| Respuesta sin el bloque esperado                                | No equivale a `NO AUTORIZADO`.                                              | `MANUAL_REVIEW`         |
| Consulta de validez con error 99                                | Fuera de rango o sin datos; registrar sin concluir.                         | Sin cambio              |

Todo mensaje se conserva completo: identificador, mensaje, información adicional, tipo y
fase, incluidos los códigos desconocidos (CTX §32). Los errores se clasifican en transporte,
recepción devuelta, autorización, validación y consulta, siempre con el payload original.

## Resiliencia

- Timeouts: de conexión corto y de petición controlado, ambos configurables (CTX §33).
- Las consultas se reintentan; el envío nunca se reintenta a ciegas: primero se reconcilia.
- Circuit breaker por servicio y ambiente del SRI; mientras está abierto, los jobs se reprograman sin llamar y la salud informa al SRI no disponible.
- La autorización puede tardar hasta 24 horas desde `RECIBIDA` (CTX §23.1); el umbral de revisión manual es Q-06.
- Un comprobante por envío, sin lotes, y nunca uno que supere el límite de tamaño versionado (CTX §29).
- La caída del SRI no afecta la consulta local ni la emisión hasta `SIGNED` (ERS RNF-004).

| Caso de recuperación (CTX §52)                       | Mecanismo                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| A — timeout al enviar                                | `SEND_UNKNOWN`, consulta por clave, reenvío del mismo XML solo si el SRI no la conoce. |
| B — error 70                                         | `PENDING_AUTHORIZATION` sin reenvío.                                         |
| C — el proceso muere tras `RECIBIDA`                 | El job de autorización persistido continúa tras el reinicio.                 |
| D — el proceso muere tras autorizar y antes de guardar | La reconciliación consulta, encuentra `AUTORIZADO` y guarda los artefactos. |
| E — clave registrada                                 | Error 43 a `SEND_UNKNOWN` y reconciliación.                                  |

## Versionado técnico

| Elemento                           | Mecanismo                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| XSD                                | Registro de esquemas con tipo, raíz, versión, archivo, hash SHA-256, origen y fecha (CTX §19.3). Los archivos se empaquetan con la aplicación y nunca se descargan en tiempo de ejecución. Los antiguos se conservan. |
| Versiones iniciales                | 01 1.1.0, 03 1.1.0, 04 1.1.0, 05 1.0.0, 06 1.1.0, 07 2.0.0 (CTX §3.1, ADR 0008).                                  |
| Catálogos y políticas              | Entradas con vigencia, fuente y versión: impuestos, retenciones, formas de pago, consumidor final, límite de tamaño y endpoints por defecto (CTX §55). |
| Casos especiales                   | Matriz de soporte por anexo con categorías explícitas; lo no soportado se rechaza antes de emitir (ADR 0014).      |
| Snapshot de cada comprobante       | Versiones de XSD, builder, catálogos, configuración de la empresa y renderer del RIDE (CTX §39).                  |
| Cambios normativos                 | Proceso de CTX §53 y checklist de CTX §54 antes de cada release; registro en el repositorio (Q-40).                |

## Firma

- Custodia del certificado en ADR 0011; parámetros de firma en ADR 0013.
- Puerto del firmador según CTX §20.3. Recibe el certificado descifrado solo en memoria y durante la firma.
- Validaciones previas de CTX §20.6 en cada firma, no solo al cargar el certificado.
- El servidor sincroniza su reloj por NTP y la salud reporta la desviación (CTX §20.5).

## Artefactos, RIDE y entrega

- Conjunto probatorio por comprobante según CTX §31, guardado mediante el puerto de almacenamiento (ADR 0010). Cada artefacto se escribe una vez y guarda su hash; la descarga recalcula el hash y alerta si no coincide (ERS RF-407).
- El XML autorizado se extrae de la respuesta del SRI, nunca se reconstruye (CTX §45).
- El RIDE se genera tras la autorización, desde el comprobante autorizado, con la marca de Pruebas cuando aplica, y registra la versión del renderer.
- Cada entrega queda registrada; un fallo de entrega no cambia el estado fiscal (CTX §46).

## API de emisión

- Endpoints por tipo de comprobante, más detalle, descarga de XML y RIDE, reconciliación y reenvío solo cuando la política lo permite (CTX §40). Rutas y forma en Q-29.
- No existe una operación genérica para enviar XML arbitrario (CTX §40).
- La emisión exige `Idempotency-Key` y responde sin esperar al SRI (CTX §41).
- Contratos versionados, validación con Zod en el servidor y documentación OpenAPI (ERS API-001..005).

## Observabilidad

- Los logs registran comprobante, clave de acceso, tipo, ambiente, transición, estado y código del SRI, duración, intento y correlación; nunca el P12, su contraseña, claves privadas ni el XML o SOAP sin redactar (CTX §47).
- Métricas y alertas de CTX §48, incluidos la edad del pendiente más antiguo y los días para el vencimiento del certificado.
- Las transiciones de estado y los eventos de dominio permiten diagnosticar sin leer SOAP sensible (CTX §62).

## Pruebas

Obligatorias del motor fiscal en `../quality/testing.md`: invariantes, golden files,
propiedades, casos de recuperación, concurrencia, idempotencia y la matriz de certificación
en el ambiente de Pruebas del SRI.
