# Tasks

## 1. Esquema de la transmisión

- [x] 1.1 Ampliar `electronic_document` (design D3 y D16).
  - Añadir los estados `SEND_UNKNOWN`, `RECEIVED`, `RETURNED`, `AUTHORIZED`, `NOT_AUTHORIZED` y `MANUAL_REVIEW`.
  - `signed_at` obligatorio en todo estado posterior a `RESERVED`.
  - Columnas `authorization_number`, `authorization_date` y `authorization_environment`, obligatorias en `AUTHORIZED` y prohibidas fuera de él.
  - Trigger `electronic_document_guard` reescrito con la tabla de transiciones de D3: los terminales no cambian, y los datos de autorización son inmutables una vez escritos.
  - Ampliar los CHECK de `document_state_transition`: estados y causas `TRANSMISSION`, `AUTHORIZATION` y `RECONCILIATION`.

  Verificar con pruebas de integración del esquema: cada transición permitida, el rechazo de las demás, los terminales inmutables, la autorización inmutable y los datos `RESERVED` y `SIGNED` existentes válidos tras la migración
- [x] 1.2 Ampliar el CHECK de `document_artifact.kind` con `AUTHORIZED_XML`, y crear `sri_attempt`, `sri_response` y `sri_attempt_result` (design D7).
  - FK compuestas `(company_id, document_id)` y triggers de solo agregado, sin borrado ni `TRUNCATE`.
  - A lo sumo una respuesta y un resultado por intento.

  Verificar con pruebas de integración: evidencia inmutable, respuesta y resultado únicos por intento, referencias de otra empresa rechazadas, y `SIGNED_XML` y `AUTHORIZED_XML` coexistiendo en un comprobante
- [x] 1.3 Crear la tabla `job` (design D5).
  - Estados `PENDING`, `LEASED`, `DONE` y `STOPPED`.
  - Unicidad de la clave de deduplicación entre los jobs activos.
  - Unicidad de un job `sri.*` activo por comprobante.
  - Índice de selección.

  Verificar con pruebas de integración: dos jobs activos con la misma clave rechazados, dos jobs `sri.*` activos del mismo comprobante rechazados, y jobs terminados que no bloquean
- [x] 1.4 Añadir las tablas a `migrations.test.ts` y documentar tablas, CHECK, triggers e índices en `database.md`. Verificar que `migrations.test.ts` pasa sin deriva entre migraciones y esquema

## 2. Cola durable de jobs (ADR 0012)

- [x] 2.1 Implementar el repositorio de `platform/jobs` (design D5):
  - encolar con deduplicación (`ON CONFLICT DO NOTHING`);
  - seleccionar con `UPDATE … FOR UPDATE SKIP LOCKED`, en SQL crudo calificado con el esquema configurado, tomando los `PENDING` vencidos y los `LEASED` con el arriendo vencido;
  - completar guardado por `lease_owner` y `status`;
  - fallo tipado con backoff exponencial y jitter completo;
  - detención por intentos, plazo o error determinista.

  Verificar con pruebas de integración en un esquema distinto de `public`:
  - concurrencia con varios workers, sin que dos tomen el mismo job;
  - un arriendo vencido que otro worker retoma;
  - una finalización con el arriendo perdido que no tiene efecto;
  - backoff dentro de los límites y detención al agotar
- [x] 2.2 Implementar el runner (design D5):
  - workers configurables y sondeo con jitter;
  - interruptor por prefijo de tipo, para `SRI_TRANSMISSION_ENABLED`: deshabilitada, los jobs `sri.*` no se toman, no consumen intentos ni reintentos y no hacen llamadas, mientras el encolado y el barrido siguen creándolos;
  - apagado ordenado registrado en `platform/lifecycle`: deja de tomar trabajo, espera hasta el plazo de gracia y libera los arriendos pendientes.

  Verificar con pruebas:
  - apagado con un job en curso que termina, o que se libera y se retoma;
  - con el interruptor apagado: ningún job `sri.*` tomado, ningún intento consumido y ninguna llamada; al encenderlo, los jobs existentes avanzan;
  - sin bucles calientes cuando la cola está vacía o todo falla
- [x] 2.3 Añadir las variables de la cola y del SRI de design D22 a `env.ts`, validando que el arriendo supera los plazos del transporte, y documentarlas en `deployment.md` (design D5 y D22).
  - Con la transmisión deshabilitada: detalle `sriTransmission: "disabled"` en `/health/ready`, métrica `sri_transmission_enabled` y log de arranque sin secretos.
  - Con la transmisión habilitada, la readiness exige sus precondiciones: endpoints válidos, política de tamaño vigente, al menos un worker y la base de datos. Si falta una, `503` con el motivo en el log.

  Verificar con pruebas de entorno (valores por defecto, rangos, interruptor apagado por defecto, arriendo insuficiente rechazado) y pruebas de readiness: deshabilitada y lista, habilitada sin política de tamaño y no lista

## 3. Política de tamaño del envío (Q-47)

- [x] 3.1 Añadir a `catalogs` la tabla `sri_transmission_policy` (migración y entrada en `migrations.test.ts`), el cargador del dataset y la lectura de la política versionada de tamaño (design D17):
  - campos `maxSignedDocumentBytes`, `sourceText`, `sourceSection`, `literalUnit`, `interpretation` y vigencia;
  - resolución por la fecha del envío;
  - sin versión vigente, ningún resultado;
  - la política visible en `Catálogos fiscales`.

  Verificar con pruebas del cargador y de la resolución sobre una política de prueba del arnés, marcada como tal, y con pruebas de componente de la pantalla
- [ ] 3.2 Obtener la cifra oficial exacta del límite individual en la ficha v2.34 o su fuente oficial, y publicar `sri-transmission-policy/1.json` con la cita, la sección, la unidad literal y la interpretación en bytes, más una prueba de borde: el límite exacto se envía y un byte más no. Si la fuente sigue inaccesible, Q-47 sigue abierta y esta tarea no se marca: no se inventa la cifra ni se toma de una librería. Verificar que el dataset cita la fuente y que las pruebas de borde pasan. Bloquea el cierre de `/opsx:apply` (design D17)

## 4. Contratos, permisos y auditoría

- [x] 4.1 Ampliar `packages/contracts/src/invoices.ts` (design D18):
  - estados nuevos con las etiquetas del glosario;
  - resumen de la transmisión en el detalle;
  - vista de `GET /invoices/{id}/transmission`;
  - solicitud de reconciliación (`reason`, de 1 a 500 caracteres);
  - códigos `SRI_INTERACTION_IN_PROGRESS` e `INVOICE_NOT_RECONCILABLE`;
  - rutas en `apiRoutes`.

  Verificar con pruebas de contratos y con `openapi-routes.test.ts`
- [x] 4.2 Añadir `invoices.reconcile` a `access-policy.ts` (solo `ADMIN`), a su espejo del frontend y a la tabla de `access-control.md`, junto con las acciones de auditoría `invoice.reconciliation_requested` e `invoice.reconciliation_completed` (design D18 y D19). Verificar con `access-policy.test.ts`: el administrador tiene el permiso y el operador no

## 5. Transporte SOAP propio (`SriTransport`)

- [x] 5.1 Definir los puertos `SriTransport` (servicios `RECEPTION`, `AUTHORIZATION` y `VALIDITY`; resultados `NOT_SENT`, `REQUEST_TIMEOUT`, `BODY_TIMEOUT`, `CONNECTION_LOST` y `RESPONSE`) y `SriInquiryPort` (`queryAuthorization`, `queryValidity`), y el módulo central de endpoints por ambiente y servicio con los valores de CTX §7.1–§7.4, sobrescribibles por variable de entorno (design D10). Verificar con pruebas unitarias de la resolución de endpoints y de que ninguna URL aparece fuera de ese módulo
- [x] 5.2 Implementar el adaptador sobre el `fetch` nativo, solo en la infraestructura de `sri-engine`:
  - plazo hasta las cabeceras y plazo de lectura del cuerpo, separados;
  - frontera conservadora de design D10: solo las causas anteriores a la conexión (DNS, conexión rechazada, plazo de conexión interno y fallo TLS) son `NOT_SENT`; un plazo propio, un abort, un socket cortado o una causa desconocida son inciertos;
  - cabeceras seguras;
  - límite de bytes de la respuesta;
  - sin fijar certificados TLS.

  Añadir la regla de ESLint y la prueba de arquitectura que impiden `fetch` y el parser XML fuera de esa infraestructura. Verificar con pruebas de contrato contra servidores locales:
  - `NOT_SENT`: puerto cerrado, nombre `.invalid` y TLS con un certificado no confiable;
  - inciertos: servidor que no responde, socket cortado tras leer la solicitud, abort durante la subida y cabeceras sin cuerpo;
  - pruebas unitarias del mapeo de `UND_ERR_CONNECT_TIMEOUT` y de una causa desconocida;
  - HTML con 200, Fault con 500, cuerpo vacío, respuesta gigante y respuesta válida con su cuerpo exacto
- [x] 5.3 Implementar los sobres `validarComprobante` (con el base64 del `Buffer` exacto), `autorizacionComprobante` y `consultarEstadoAutorizacionComprobante`, con los espacios de nombres y elementos de los WSDL oficiales y de la ficha v2.34, §7.2.3 y §8.2.3 (design D10; Q-48 resuelta el 2026-10-04), y el circuit breaker por servicio y ambiente (design D6 y D10). Guardar los WSDL oficiales con su SHA-256 en `docs/product/sri-wsdl/`.

  Verificar con pruebas byte a byte de los sobres, pruebas del adaptador de validez sobre el contrato oficial y pruebas del breaker: se abre tras N fallos, se entreabre tras la pausa y no consume intentos

## 6. Parsers y clasificación

- [x] 6.1 Añadir el parser XML como dependencia directa con versión exacta, configurado para rechazar DTD, e implementar la clasificación pura de la recepción con la tabla de design D11:
  - `RECIBIDA`;
  - `DEVUELTA` concluyente;
  - 70, 43 y 45;
  - sin estado, estado desconocido, Fault, HTML, vacío y XML ilegible;
  - clave distinta.

  Guardar los mensajes estructurados en orden. Verificar con pruebas unitarias sobre respuestas sintéticas con la estructura oficial, marcadas como sintéticas, que cubren cada fila, varios mensajes y un código desconocido; `check:versions` pasa
- [x] 6.2 Implementar la clasificación pura de la autorización (design D12):
  - clave desconocida;
  - una autorización `AUTORIZADO`, `NO AUTORIZADO`, `RECHAZADO` (el no autorizado del ejemplo oficial) u otro estado;
  - validación de la clave, el número, la fecha (ISO 8601 o `dd/MM/yyyy HH:mm:ss` con su texto original), el ambiente normalizado y la `claveAcceso` del comprobante;
  - varias autorizaciones, con una válida o contradictorias;
  - extracción del `comprobante` exacto.

  Verificar con pruebas unitarias de cada caso, incluidas una fecha ilegible, un ambiente distinto y un número distinto de la clave, que dan `INCONSISTENT`, y un estado desconocido que da `NO_CONCLUSION`
- [x] 6.3 Implementar la clasificación pura de la respuesta de validez (design D15): un estado `AUTORIZADO`, `NO AUTORIZADO`, `PENDIENTE DE ANULAR` o `ANULADO` para la clave del comprobante da `KEY_KNOWN` con su estado; `estadoConsulta` `RECHAZADA`, el error 99 o una respuesta desconocida dan `NO_EVIDENCE`. Verificar con pruebas unitarias sobre respuestas sintéticas con la estructura del WSDL oficial y de los ejemplos de la ficha v2.34, §8.2.3

## 7. Evidencia y máquina de transmisión

- [x] 7.1 Implementar la máquina de transmisión en el dominio de `fiscal` (`canTransition`, causas y terminales) y los repositorios de intentos, respuestas y resultados, con el artefacto `AUTHORIZED_XML` en el puerto de artefactos (design D3, D7 y D16). Verificar con pruebas unitarias de la máquina (I-15, I-16) y pruebas de integración de los repositorios contra PostgreSQL
- [x] 7.2 Implementar el procedimiento común de los handlers, con la evidencia antes de la clasificación (design D8):
  1. transporte;
  2. TX A con el intento y la respuesta;
  3. clasificación;
  4. TX B con el resultado, la transición guardada, el siguiente job y el job actual `DONE`.

  Al retomar un job, primero se clasifica el intento sin resultado. Un fallo del parser da `UNPARSEABLE`, sin conclusión. Verificar con pruebas de integración:
  - una caída simulada entre la TX A y la TX B se clasifica al retomar sin llamar al SRI;
  - un parser que falla conserva el intento y la respuesta;
  - un arriendo perdido entre A y B no tiene efecto;
  - los logs no contienen XML ni SOAP

## 8. Envío de un comprobante firmado

- [x] 8.1 Exportar `enqueueTransmissionIn(scope, document)` desde `fiscal` y llamarlo en la transacción que firma (`invoices/application/signing-pipeline.ts`), e implementar el barrido idempotente al arrancar y periódico (design D6). Verificar con pruebas de integración:
  - una factura firmada tiene su `sri.transmit` en la misma transacción;
  - el traspaso atómico entre fases: `sri.transmit` `DONE` y `sri.authorize` `PENDING` en una transacción, y lo mismo al pasar a `SEND_UNKNOWN` con `sri.reconcile`, sin ventana sin job ni choque con la unicidad de los jobs activos;
  - dos workers que intentan avanzar la misma factura: solo uno confirma;
  - una caída simulada justo después de firmar conserva el job;
  - el barrido ejecutado varias veces crea exactamente un job por cada `SIGNED` sin job, y no reactiva jobs `STOPPED`
- [x] 8.2 Implementar el handler `sri.transmit` (design D9, D11 y D14):
  - integridad (pertenencia, SHA-256, tamaño y clave);
  - política de tamaño;
  - sobre con los bytes exactos;
  - clasificación de la recepción y la transición según D11;
  - `NOT_SENT` reprograma el job sin cambiar el estado;
  - los reenvíos usan el mismo procedimiento.

  Verificar con pruebas de integración con un SRI simulado:
  - los bytes enviados son idénticos al artefacto;
  - un artefacto alterado da `INTEGRITY_FAILED` sin llamada;
  - sobre el límite y sin política, el job se detiene;
  - `RECIBIDA` lleva a `RECEIVED` con su `sri.authorize`;
  - `DEVUELTA` lleva a `RETURNED` con sus mensajes y sin reenvío;
  - sin estado, timeout, corte, HTML, Fault y vacío llevan a `SEND_UNKNOWN` con su reconciliación;
  - los errores 70, 43 y 45 nunca llevan a `RETURNED`;
  - el contador del punto no cambia en ningún caso

## 9. Autorización

- [x] 9.1 Implementar el handler `sri.authorize` (design D12 y D16):
  - consulta por la clave en el servicio del ambiente del comprobante;
  - primera consulta tras la espera configurada y backoff;
  - `AUTHORIZED` con las columnas de autorización y el artefacto `AUTHORIZED_XML` cuando viene;
  - `NOT_AUTHORIZED` terminal con sus mensajes;
  - sin conclusión, nueva consulta;
  - ventana agotada con respuestas sin conclusión, `MANUAL_REVIEW`;
  - fallos de transporte que agotan los intentos, `STOPPED` sin cambiar el estado.

  Verificar con pruebas de integración:
  - autorización válida con los dos artefactos de hashes distintos;
  - autorización sin XML;
  - no autorizado sin reintento;
  - estado desconocido;
  - ambiente distinto y número distinto, que van a `MANUAL_REVIEW`;
  - varias autorizaciones;
  - ventana agotada;
  - SRI caído que no lleva a `MANUAL_REVIEW`;
  - caso C (caída después de `RECIBIDA`) y caso D (caída después de autorizar y antes de guardar)

## 10. Reconciliación automática

- [x] 10.1 Implementar `reconcileDocument` sobre `SriInquiryPort` y el handler `sri.reconcile` con la estrategia de design D15:
  - la autorización por clave decide primero;
  - antes de concluir que el SRI no conoce la clave, la consulta de validez actúa como guarda: un estado informado impide el reenvío, lleva a `RECEIVED` o, si es de anulación, a `MANUAL_REVIEW`;
  - una clave desconocida sin evidencia de recepción ni evidencia de validez encola el reenvío de los mismos bytes;
  - con evidencia de recepción (`RECIBIDA`, 70 o 43) no se reenvía;
  - la causa 45 con una clave desconocida lleva a `MANUAL_REVIEW`;
  - desde `MANUAL_REVIEW`, una clave desconocida no habilita el reenvío;
  - la espera del 70.

  Verificar con pruebas de integración:
  - caso A (timeout al enviar, la clave existe o no) y caso B (error 70 sin reenvío);
  - caso E (error 43);
  - el error 45 con esta clave y con otra;
  - un reenvío con bytes idénticos;
  - ningún llamado a `reserveSequentialIn`;
  - ningún proceso automático cambia un `MANUAL_REVIEW`

## 11. Reconciliación manual y API de la transmisión

- [ ] 11.1 Implementar `POST /api/v1/invoices/{id}/reconciliations` (design D15, D18 y D19):
  - permiso `invoices.reconcile` y motivo obligatorio;
  - estados admitidos;
  - `202` con el job manual;
  - `409 SRI_INTERACTION_IN_PROGRESS` y `409 INVOICE_NOT_RECONCILABLE`;
  - auditoría `invoice.reconciliation_requested`, y `invoice.reconciliation_completed` al terminar, con el administrador como actor.

  Verificar con pruebas HTTP:
  - administrador en `MANUAL_REVIEW` que concluye o que no concluye;
  - `SIGNED` con su job detenido que reactiva el envío;
  - operador prohibido y sin sesión;
  - factura de otra empresa;
  - estado terminal;
  - job activo;
  - dos solicitudes simultáneas, de las que solo una se programa;
  - eventos de auditoría exactos, sin SOAP
- [ ] 11.2 Ampliar `GET /api/v1/invoices` y `GET /api/v1/invoices/{id}` con los estados nuevos, el filtro "requiere atención" y el resumen de la transmisión, e implementar `GET /api/v1/invoices/{id}/transmission` (design D18). Verificar con pruebas HTTP:
  - el detalle autorizado muestra el número, la fecha y el ambiente;
  - el devuelto muestra todos sus mensajes;
  - la transmisión detenida muestra su motivo;
  - el historial no expone respuestas originales ni XML;
  - el filtro por estado;
  - el aislamiento por empresa

## 12. Observabilidad

- [ ] 12.1 Añadir las métricas de design D21 al registro existente:
  - jobs por tipo y estado, y antigüedad del pendiente más viejo;
  - intentos por operación y resultado, y duración;
  - códigos 70, 43 y 45;
  - comprobantes por estado;
  - latencia de autorización;
  - circuit breaker.

  Documentar las alertas propuestas en `observability.md`. Verificar con una prueba de que las métricas aparecen en `/metrics` sin XML, SOAP, secretos ni datos de otras empresas

## 13. Pantallas de la transmisión

- [ ] 13.1 Ampliar `Facturas` con los estados nuevos (icono y texto del glosario) y el filtro "requiere atención" (design D20). Verificar con pruebas de componente: carga, vacío, error, sin permiso y filtros en la URL
- [ ] 13.2 Añadir al detalle de la factura la sección "Transmisión al SRI" y la acción "Reconciliar con el SRI" con su diálogo de motivo, solo para el administrador y en un estado admitido (design D20):
  - estado, aviso de transmisión detenida, datos de autorización, mensajes del SRI e historial plegable;
  - componentes locales `SriMessageList` y `TransmissionHistory`.

  Verificar con pruebas de componente:
  - cada estado;
  - el operador sin la acción;
  - el diálogo con el motivo obligatorio y el foco;
  - el aviso de éxito y el error `409` explicado
- [ ] 13.3 Revisar las pantallas con `docs/quality/frontend-checklist.md` contra el backend real con un SRI simulado (escritorio, 375 y 320 px, tema oscuro, contraste y teclado), y registrar la revisión en `openspec/changes/add-sri-transmission/ui-review.md`. Verificar que la revisión no deja hallazgos abiertos

## 14. Prueba end-to-end, compuertas y documentación

- [ ] 14.1 Añadir la prueba end-to-end sobre `main.ts` con un SRI simulado en HTTP y los endpoints sobrescritos:
  - preparación, emisión, transmisión, autorización y consulta;
  - rearranque a mitad de la transmisión;
  - eventos de auditoría exactos;
  - la trampa de salida solo admite el SRI simulado;
  - con la transmisión apagada, ninguna llamada.

  Verificar que la prueba pasa
- [ ] 14.2 Escribir el procedimiento de S-3 online en `docs/quality/sri-certification.md` (design D23):
  - P12 real, contraseña y RUC de Pruebas fuera del repositorio;
  - transporte, parsers y transiciones reales, sin rutas especiales;
  - verificación de la respuesta original y del XML autorizado;
  - conversión de las respuestas reales, anonimizadas, en fixtures.

  Buscar de nuevo el vector oficial de la clave en su fuente oficial y, si aparece, añadirlo a la prueba de contrato de `AccessKeys` con su cita; si no, dejarlo pendiente en `open-questions.md` sin inventarlo. Verificar en `/opsx:verify` el estado de las compuertas
- [ ] 14.3 Actualizar la documentación:
  - `fiscal-emission.md`: implementación, códigos, resolución de Q-06 y obligaciones;
  - `integrations.md` y `deployment.md`: endpoints, plazos, interruptor y habilitación tras las compuertas;
  - `backend.md`, `ARCHITECTURE.md` y `database.md`;
  - `domain-model.md` y `glossary.md`;
  - `capabilities.md`;
  - `open-questions.md`: Q-06 resuelta, Q-47 según la tarea 3.2 y Q-48 resuelta.

  Verificar que los documentos citan las rutas, permisos, estados, tipos de job y códigos implementados

## 15. Verificación

- [ ] 15.1 Ejecutar `corepack pnpm verify` y verificar que formato, versiones, lint, pruebas, typecheck, OpenAPI, arranque de desarrollo, build y `check:xsd-artifact` pasan
