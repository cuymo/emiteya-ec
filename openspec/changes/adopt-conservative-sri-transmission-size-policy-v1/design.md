# Design

## Context

Hoy la transmisión tiene dos mecanismos de tamaño (`add-sri-transmission` design D17 y
`add-sri-certification-safety-cap`):

- **Política oficial versionada.** Es el catálogo `sri-transmission-policy`, con su tabla
  `sri_transmission_policy`, su cargador, `sriTransmissionSizePolicy(date)`, el endpoint
  `GET /fiscal-catalogs/sri-transmission-policy` y su vista en la pantalla de catálogos.
  - Nunca tuvo datos: Q-47 no tenía una cifra oficial.
  - Sin ella, `transmit-handler` detiene con `SIZE_POLICY_MISSING`, y con ella compara solo el XML
    firmado (`TOO_LARGE`).
  - `transmission-gate` la exige como precondición de la readiness.
- **Sesión de certificación.** Se activa con `SRI_CERTIFICATION_SAFETY_CAP_ENABLED`.
  - Constante `CERTIFICATION_SAFETY_CAP_BYTES = 40_000`.
  - `prepareReception` construye el cuerpo una vez y lo mide.
  - Bloqueos `CERTIFICATION_SIZE_CAP_EXCEEDED` y `CERTIFICATION_ENVIRONMENT_NOT_TEST`, este también
    en `executeSriStep`.
  - Puerto `CertificationSession` con sus métricas `sri_certification_*`.
  - Readiness `sriSizeGate` con `effectiveSizePolicySource`.

El 2026-10-09 el dueño del producto resolvió Q-47 por política de producto: una sola regla de
40 000 bytes, estricta, en Pruebas y Producción, no configurable y sin presentarse como oficial.

## Goals / Non-Goals

**Goals:**
- Una sola política, `PRODUCT_CONSERVATIVE_POLICY_V1`, sin dos límites idénticos ni ramas
  hipotéticas.
- Bloqueo antes de la red, con el cuerpo medido igual al cuerpo enviado.
- Retirar la sesión de certificación y el catálogo de política oficial, con todo lo que solo existía
  para ellos.
- Q-47 resuelta en la documentación, sin afirmar un límite oficial del SRI.

**Non-Goals:**
- Cambiar `SRI_TRANSMISSION_ENABLED`, los endpoints, los reintentos, la clasificación o la
  reconciliación.
- Reducir los límites de recursos de los borradores.
- Dividir, comprimir o enviar por lotes.
- Una política oficial futura. Si el SRI publica una aclaración, la atiende un change nuevo.

## Decisions

### D1. La política es una constante del dominio `fiscal`

`fiscal/domain/transmission-size-policy.ts` reemplaza a `certification-safety-cap.ts`:
- `TRANSMISSION_SIZE_POLICY = { id: "PRODUCT_CONSERVATIVE_POLICY_V1", limitBytes: 40_000 }`, como
  constante de solo lectura;
- `TransmissionSizes` (`signedXmlBytes`, `base64PayloadBytes`, `soapRequestBytes`);
- `withinTransmissionSizePolicy(sizes)`, que exige las tres medidas `< limitBytes`.

Ninguna variable de entorno la lee. Una prueba del esquema de entorno comprueba que no existe ninguna
variable para el límite y que `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` ya no se reconoce.

**Alternativa descartada:** conservar el nombre «certification cap». La regla ya no es de la
certificación, y el nombre engañaría.

### D2. Medición y bloqueo en `transmit-handler`, para los dos ambientes

El orden del primer envío, sin intento pendiente, queda así:
1. Integridad del `SIGNED_XML`, que se mantiene.
2. `prepared = gateway.prepareReception(xml)`, una sola vez.
3. `withinTransmissionSizePolicy(prepared.sizes)`.
   - Si no se cumple, `jobs.stop` con `TRANSMISSION_SIZE_POLICY_EXCEEDED`. El detalle lleva el
     ambiente fiscal, las tres medidas, `limitBytes` y `policyId`.
   - Si se cumple, `submit(environment, prepared)`, que entrega `prepared.envelope` tal cual
     (`add-sri-certification-safety-cap` design D2).

Detalles:
- El reenvío desde `SEND_UNKNOWN` y la clasificación de un intento pendiente no cambian.
- Sin llamada no queda intento ni respuesta, y el estado fiscal no cambia.
- La comprobación se observa con el registro sin contenido de D4.
- Desaparecen el lector `sizePolicy`, `today` (solo servía para resolver la política) y las ramas
  `MISSING`, `TOO_LARGE` y `CERTIFICATION_*`.

### D3. Se retira la sesión de certificación

Se quitan:
- `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` de `config/env.ts`;
- `fiscal/application/certification-session.ts` y `fiscal/infrastructure/certification-session.ts`;
- el bloqueo de Producción en `executeSriStep` y en `transmit-handler`, con el resultado
  `CERTIFICATION_BLOCKED`;
- las métricas `sri_certification_safety_cap_enabled` y `sri_certification_gate_blocks_total`.

**Razón:** la regla de tamaño ahora vale en Producción, y Q-47 deja de bloquearla. Durante una
certificación, Producción se aísla de forma operativa, como describe el runbook (secciones 3 y 14):
- endpoints de Producción sustituidos por un destino no enrutable;
- una lista de permitidos solo hacia `celcer.sri.gob.ec`;
- la empresa en Pruebas.

Una bandera que bloquea un ambiente en el código sería otra regla que mantener sin la decisión del
producto que la sostenía. `SRI_TRANSMISSION_ENABLED` sigue siendo el interruptor general.

### D4. Diagnóstico sin contenido

`fiscal/infrastructure/transmission-size-diagnostics.ts` expone `observe(check)` y `lastCheck()`, y
el contador `sri_transmission_size_policy_blocks_total`, sin etiquetas de identidad.
- **El check** lleva el ambiente fiscal, `allowed`, `reason` (`TRANSMISSION_SIZE_POLICY_EXCEEDED` o
  null), las tres medidas, `limitBytes`, `policyId` y `at`.
- **El registro** lleva lo mismo, a `info` si se permite y a `error`/alerta si se bloquea. Nunca el
  XML, el base64 ni el SOAP.
- **La readiness** reemplaza `sriSizeGate` por
  `sriSizePolicy: { source: "PRODUCT_CONSERVATIVE_POLICY_V1", limitBytes: 40000, lastCheck }`.

`transmission-gate` deja la precondición `sizePolicyAvailable`: `missing` ya no puede contener
`size-policy`.

### D5. Motivos y mensaje de parada

- `TRANSMISSION_STOP_CODES` pierde `TOO_LARGE`, `SIZE_POLICY_MISSING`,
  `CERTIFICATION_SIZE_CAP_EXCEEDED` y `CERTIFICATION_ENVIRONMENT_NOT_TEST`.
- Gana `TRANSMISSION_SIZE_POLICY_EXCEEDED`, con el mensaje «El comprobante excede el límite de
  seguridad de transmisión de EmiteYa. Reduzca el contenido antes de enviarlo.».
- La superficie ya existe:
  - `stopMessage` alimenta `transmission.stopped.message` en las vistas de los seis tipos;
  - las pantallas lo muestran sin conocer el código.
- **Paradas históricas.** No hay instalaciones de Producción antes del go-live. Una parada histórica
  con un código retirado muestra el mensaje genérico de `stopMessage`; no se mantienen mensajes
  heredados.

### D6. Se retira el catálogo `sri-transmission-policy`

Decisión del dueño del 2026-10-09: no mantener lógica hipotética de una política oficial futura. Se
quitan:
- el tipo de catálogo y su esquema de dataset;
- `applySizePolicy` del cargador;
- `sizePolicyVersions`, `insertSizePolicyVersions` y `closeSizePolicyVersion`;
- `sriTransmissionSizePolicy` y `sriTransmissionPolicy` de los catálogos fiscales;
- la ruta HTTP, el contrato y el OpenAPI;
- la consulta y la sección del frontend.

**Migración.** Una migración nueva:
- elimina la tabla `sri_transmission_policy` (sus triggers de fila no frenan un `DROP TABLE`) y las
  funciones `sri_transmission_policy_guard()` y `sri_transmission_policy_no_overlap()`, que
  sobreviven a la tabla. No toca la función compartida `fiscal_catalog_reject_change()`;
- borra las filas del registro de datasets de ese tipo, con `fiscal_catalog_dataset_immutable`
  deshabilitado solo para esa sentencia, como hace `20261004100100_schema_registry_imports`:
  - solo pudieron existir en esquemas de prueba o en el sandbox manual, porque ningún dataset de ese
    tipo se distribuyó nunca;
  - de quedar, `datasetVersions()` las seguiría poniendo en los snapshots de emisión nuevos;
- vuelve a crear `fiscal_catalog_dataset_catalog_type_check` con los catorce tipos restantes.

Prisma pierde el modelo `SriTransmissionPolicy`. No se publica ningún dataset de reemplazo.

### D7. Documentación de Q-47

- **`open-questions.md`:** Q-47 pasa a **Resuelta** (`RESOLVED_BY_PRODUCT_POLICY_V1`) y deja de ser
  compuerta. Su razón:
  - «320 Kb» es ambiguo y ninguna fuente primaria define la unidad ni la representación;
  - EmiteYa elige un tope estricto de 40 000 bytes en los dos ambientes;
  - no afirma ser el límite oficial;
  - solo se revisa con evidencia oficial nueva, mediante una decisión y un change nuevos, sin
    reabrir Q-47.
- **`sri-certification.md`:**
  - las compuertas y la sección 2 cambian;
  - la sección 2.1 deja de describir la sesión de certificación;
  - la medición de los siete documentos queda como evidencia de margen.
- **Los límites de recursos de los borradores no garantizan que el comprobante sea transmisible.**
  Se documenta en `fiscal-emission.md` y en la sección del tamaño.
- **También se actualizan:**
  - `capabilities.md`, `sri-catalogs/README.md` y la nota de la fuente
    `ficha-v2.34-limite-de-tamano.txt`;
  - `database.md`, `integrations.md`, `deployment.md`, `observability.md` y `testing.md`;
  - el script `measure:certification-payloads`, que pasa a usar la constante del dominio.

  Los changes archivados y los registros históricos, como la prueba manual del 2026-10-09, no se
  reescriben.

### D8. Pruebas

| Caso pedido | Dónde |
| --- | --- |
| 1 a 3. 39 999 pasa; 40 000 y 40 001 bloquean | `test/fiscal/transmission-size-policy.test.ts`, la función pura |
| 4 a 6. Exceden el XML, el base64 o el SOAP | Ídem, y el handler con un gateway espía |
| 7 y 8. Pruebas y Producción con la misma política | Handler unitario: mismas medidas en los dos ambientes, misma decisión |
| 9 y 10. Sin llamadas de red, sin `sri_attempt` | Handler con espía (0 llamadas) y `transmit-handler.test.ts` (PostgreSQL), sin intento ni respuesta |
| 11. Cuerpo medido = cuerpo enviado | Espía de `submit`: mismo `Buffer`; evidencia con `soapRequestBytes` |
| 12. `SRI_TRANSMISSION_ENABLED=0` bloquea todo | `transmission-gate.test.ts` y la prueba de integración del interruptor |
| 13. Ninguna variable de entorno sube el límite | `env.test.ts` |
| 14. La readiness identifica `PRODUCT_CONSERVATIVE_POLICY_V1` | `transmission-gate.test.ts` y `e2e-sri-transmission.test.ts` |

Las pruebas que cargaban una política sintética dejan de hacerlo: la política siempre existe.

### Brief de la operación sensible (envío al SRI)

- **Quién la ejecuta:** el runner de jobs, como actor del sistema. Sin cambios.
- **Tenant y pertenencia:**
  - el job y el comprobante se leen por `companyId`;
  - el artefacto, por empresa, comprobante y tipo.
- **Cambio de identificadores:** no aplica, no hay entrada de usuario.
- **Repetición y concurrencia:** sin cambios; un job por comprobante, con arriendo.
- **Idempotencia:** la misma de antes.
- **Restricciones de base de datos:** se retira la tabla del catálogo; ninguna invariante fiscal
  depende de ella.
- **Auditoría:** igual que antes. La parada queda en el job y en el registro, sin contenido.
- **Fugas entre cuentas:** el diagnóstico de la readiness no identifica el comprobante, la empresa ni
  sus terceros.

### Brief de la pantalla (catálogos fiscales)

Se quita la sección de la «política de tamaño», que nunca tuvo datos.
- Quien usa la pantalla, el administrador o el operador, la usa para consultar los catálogos
  oficiales; no decide nada sobre esa sección.
- No cambian la información mínima ni la acción principal.
- La política v1 se documenta en la readiness y en el runbook, no como un catálogo oficial.

Sin dependencias nuevas y sin desviaciones del stack.

## Risks / Trade-offs

- **Comprobantes grandes intransmisibles.** Un comprobante válido dentro de sus límites de recursos
  puede superar 40 000 bytes. La política lo bloquea sin recortarlo, y el usuario debe reducirlo o
  dividirlo cuando el tipo lo permita. Es deliberado y está documentado.
- **Pérdida del bloqueo de Producción en el código.** La certificación depende del aislamiento
  operativo del runbook. Antes de cada sesión real se verifica la lista de permitidos.
- **Cambio de API.** Desaparece `GET /fiscal-catalogs/sri-transmission-policy`. Solo lo consumía el
  frontend propio, que se actualiza en el mismo change. El OpenAPI se regenera.
- **Paradas históricas** con códigos retirados: muestran el mensaje genérico. No hay datos de
  Producción.
