# Design

## Context

La motivación está en `proposal.md`. Estado actual, verificado en el código:

- **Recepción.** El handler `sri.transmit` (`fiscal/application/transmit-handler.ts`):
  1. comprueba la integridad del `SIGNED_XML`;
  2. comprueba la política de tamaño (`SIZE_POLICY_MISSING` sin política; `TOO_LARGE` si el XML
     firmado supera `maxSignedDocumentBytes`);
  3. llama a `executeSriStep`, cuya llamada usa `gateway.submit(environment, signedXml)`.
- **El sobre.** `gateway.submit` arma el sobre dentro del gateway con `receptionEnvelope`, después de
  consultar el circuit breaker. El transporte envía ese `Buffer` tal cual (`body: envelope`).
  `executeSriStep` guarda la evidencia con `exchange.envelope`.
- **El punto común.** `executeSriStep` es el único camino hacia el SRI para los tres handlers
  (`transmit`, `authorize` y `reconcile`). Solo llama al gateway si no hay un intento pendiente de
  clasificar.
- **Las paradas.** Las de antes del envío (`INTEGRITY_FAILED`, `TOO_LARGE`, `SIZE_POLICY_MISSING`)
  detienen el job con un error determinista, sin intento, sin respuesta y sin transición.
  `TRANSMISSION_STOP_CODES` y `transmission-messages.ts` les dan su mensaje. El contrato expone el
  código como texto libre.
- **La readiness.** `createTransmissionGate` exige `size-policy` con la transmisión habilitada;
  `main.ts` expone el estado en `/health/ready` y en la métrica `sri_transmission_enabled`.

## Goals / Non-Goals

**Goals:**

- Que el cuerpo medido sea, por construcción, el cuerpo enviado.
- Que las comprobaciones de la sesión vivan en `fiscal` y no en el transporte.
- Que ningún comprobante de Producción produzca una llamada de red con la sesión activa, ni siquiera
  una consulta.

**Non-Goals:**

- Cambiar el borde de la política oficial (`<=`) o su medida (el XML firmado).
- Medir las cabeceras HTTP.
- Tocar las consultas de autorización o de validez más allá de la guarda del ambiente: llevan solo la
  clave y no hay nada que medir.

## Decisions

### D1. La bandera y la constante

- **La bandera.** `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` en `config/env.ts`, `"0"` o `"1"`, por
  defecto `"0"`, con la misma forma que `SRI_TRANSMISSION_ENABLED`. Se admite con
  `NODE_ENV=production`, porque el runbook certifica la aplicación tal como se despliega y la bandera
  nunca habilita Producción.
- **La constante.** `CERTIFICATION_SAFETY_CAP_BYTES = 40_000` en
  `fiscal/domain/certification-safety-cap.ts`, con su origen en el comentario (la lectura más
  restrictiva de «320 Kb»; Q-47 abierta).
- **Alternativas descartadas:**
  - Una variable para el valor. Alguien podría subirlo y convertir la salvaguarda en una
    pseudo-política.
  - Una versión del dataset `sri-transmission-policy`. Exige el texto, la unidad y la interpretación
    oficiales, regiría también Producción y aparentaría resolver Q-47.

### D2. El cuerpo se construye una vez, antes de decidir

- **En `sri-engine`.** Una función pura nueva, `prepareReception(signedXml)`:
  - calcula una sola vez el base64 del `Buffer` firmado;
  - arma el sobre con ese mismo texto;
  - devuelve el sobre (`Buffer`) y sus tres medidas: los bytes del XML firmado, la longitud del base64
    (ASCII: un carácter es un byte) y los bytes del sobre.
- **En el gateway.** `SriGateway` la expone, y `submit(environment, prepared)` entrega al transporte
  exactamente `prepared.envelope`. El sobre ya no se arma en `submit`.
- **En el handler.** El handler prepara el cuerpo en cada envío, con la sesión encendida o apagada:
  hay un solo camino y la evidencia (`envelope_size`) coincide siempre con lo medido.
- **El último paso.** Entre la decisión del tope y el `fetch` solo queda la consulta del circuit
  breaker, que no toca el cuerpo.
- **Alternativas descartadas:**
  - Medir dentro del transporte. El transporte no conoce reglas fiscales y tendría que devolver un
    resultado «bloqueado» nuevo.
  - Medir una reconstrucción del sobre. Podría divergir de lo enviado.

### D3. El orden de las comprobaciones en la recepción

1. **Ambiente** (D4). Con la sesión encendida, un comprobante que no es de Pruebas se detiene con
   `CERTIFICATION_ENVIRONMENT_NOT_TEST`.
2. **Integridad.**
3. **Política oficial.** Si existe, rige como hoy: `TOO_LARGE` si el XML firmado la supera. Si no
   existe, la sesión apagada da `SIZE_POLICY_MISSING`, como hoy; la sesión encendida continúa.
4. **Preparación del cuerpo** (D2).
5. **Tope**, solo con la sesión encendida: `CERTIFICATION_SIZE_CAP_EXCEEDED` si alguna medida es
   mayor o igual que 40 000.

La composición solo restringe:
- la sesión nunca salta la integridad ni la política oficial;
- sin la sesión, el paso 5 no existe.

### D4. La guarda del ambiente en el punto común

Con la sesión encendida, `executeSriStep` detiene el job con `CERTIFICATION_ENVIRONMENT_NOT_TEST`
antes de `step.call` si el comprobante no es del ambiente de Pruebas.

- **Alcance.** Cubre la recepción, la autorización y la reconciliación con una sola comprobación. La
  reclasificación de una respuesta ya guardada no llama al SRI, así que no se bloquea.
- **Qué no hace.** No cambia la resolución de endpoints, el ambiente del comprobante ni su clave.
- **Por qué en dos sitios.** La recepción la evalúa también en el paso 1 de D3 para dar ese motivo
  antes que los de tamaño. Ambos usan la misma función.

### D5. Los motivos de parada y la evidencia

- **Motivos.** `TRANSMISSION_STOP_CODES` suma `CERTIFICATION_SIZE_CAP_EXCEEDED` y
  `CERTIFICATION_ENVIRONMENT_NOT_TEST`, con mensajes de negocio que dicen que no hubo envío y que no
  es una respuesta del SRI.
- **Tipo de parada.** Se detienen como las paradas actuales previas al envío: error determinista,
  sin intento, sin respuesta y sin transición, y el comprobante conserva su número y su estado.
- **No es `NOT_SENT`.** `NOT_SENT` es un resultado del transporte después de empezar una llamada, y
  aquí no hay llamada.
- **Detalle del error del job:** el ambiente, las tres medidas, el tope y la fuente efectiva. Nunca
  contenido.

### D6. La readiness, la métrica y los registros

- **Readiness.** `TransmissionPreconditions` suma `certificationSafetyCap: boolean`. La precondición
  `size-policy` se cumple con una política vigente o con la sesión encendida.
  `TransmissionState.sizeGate` lleva:
  - `certificationSafetyCapEnabled`;
  - `capBytes`;
  - `effectiveSizePolicySource`, que es `SRI_OFFICIAL_POLICY`, `CERTIFICATION_CONSERVATIVE_CAP`,
    `SRI_OFFICIAL_POLICY+CERTIFICATION_CONSERVATIVE_CAP` o `NONE`.

  `/health/ready` lo publica en `sriSizeGate`.
- **Métrica.** Una nueva, `sri_certification_safety_cap_enabled`.
- **Registro de arranque.** Informa la sesión y la fuente efectiva.
- **Cada envío o bloqueo en la sesión** registra el ambiente, las tres medidas, el tope y la fuente,
  sin el XML, el base64 ni el SOAP.

### D7. Las pruebas

- **Sin base de datos** (Docker no está disponible en esta fase), con dobles en memoria:
  - la función de preparación;
  - el gateway con un transporte espía: el cuerpo entregado es el `Buffer` preparado;
  - el interruptor;
  - el handler de la recepción y la guarda del ambiente en `executeSriStep`.

  Cubren los doce casos del encargo: bordes 39 999, 40 000 y 40 001; base64 y SOAP por separado;
  Producción; política más estricta y más permisiva; cero llamadas e intentos al bloquear; cuerpo
  medido igual al enviado.
- **Con PostgreSQL.** Las pruebas de integración existentes del handler se adaptan a la nueva firma
  de `submit` y suman el camino feliz de la sesión con el SRI simulado. Corren en la verificación
  global cuando PostgreSQL esté disponible.

## Risks / Trade-offs

- **[La bandera queda encendida en un despliegue real]** → Solo transmite Pruebas. Los comprobantes
  de Producción se detienen con un motivo explícito, sin llamada, y la readiness, la métrica y el log
  lo muestran. El runbook la apaga al cerrar la sesión.
- **[Las cabeceras HTTP no se miden]** → El encargo fija el cuerpo SOAP como medida. El margen medido
  (26 468 bytes) cubre de sobra unas cabeceras de cientos de bytes.
- **[La firma de `submit` cambia]** → Solo la usa el handler de la recepción. Las pruebas de
  integración se adaptan en este mismo cambio.
- **[El certificado real es mayor que el sintético]** → La medición ocurre con los bytes reales en
  cada envío. Un documento que no entra se detiene sin llamada.

## Migration Plan

- **Despliegue.** Sin migraciones. La bandera nace apagada, así que desplegar no cambia el
  comportamiento.
- **Vuelta atrás.** Apagar la bandera o desplegar la versión anterior.
- **Q-47.** Cuando se publique la política oficial, la sesión se compone con ella sin cambios (D3).
