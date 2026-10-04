# Proposal

## Why

Una factura llega hoy a `SIGNED` con su XML firmado exacto, pero nunca sale del sistema. Sin la
transmisión al SRI no tiene validez tributaria y el contribuyente no puede usarla. El cambio 6 dejó
la frontera lista: el artefacto firmado está persistido, el número y la clave son definitivos, y
las decisiones del cambio 7 quedaron aprobadas el 2026-10-03 (ADR 0012, enmienda del ADR 0018,
Q-07, Q-16 y Q-34).

## What Changes

- **Transmisión automática con jobs.**
  - Todo comprobante `SIGNED` se transmite sin intervención, por una cola durable propia en PostgreSQL (ADR 0012).
  - Su job inicial nace con el paso a `SIGNED`, y los `SIGNED` que existan al desplegar reciben el suyo con un barrido idempotente.
  - Un comprobante nunca tiene dos transmisiones equivalentes a la vez.
  - No hay endpoint de envío.
- **Integridad antes de cada envío.** Se envían exactamente los bytes del `SIGNED_XML` persistido, después de comprobar el hash, el tamaño, la relación con el comprobante y la clave de acceso. Nunca se reconstruye el XML.
- **Transporte SOAP propio** detrás de `SriTransport` (enmienda del ADR 0018): conserva el estado HTTP, las cabeceras seguras, el cuerpo exacto, los tiempos y la clase de fallo, sin reinterpretarlos.
- **Evidencia antes de la clasificación.** Cada interacción con el SRI deja un intento de solo agregado con su respuesta original, confirmado antes de clasificarla. Si el parser falla, la evidencia se conserva y no se inventa un resultado.
- **Recepción:** `RECIBIDA` lleva a `RECEIVED`, y un `DEVUELTA` concluyente lleva a `RETURNED` con sus mensajes estructurados. Antes de concluir `RETURNED` se detectan los errores 70, 43 y 45. La ausencia de estado nunca equivale a `DEVUELTA`.
- **Autorización:** consulta por la misma clave tras un intervalo configurable, con validación de la identidad, el ambiente, el número y la fecha.
  - `NO AUTORIZADO` es terminal (Q-07), también con el texto `RECHAZADO` del ejemplo oficial de la ficha.
  - Una respuesta sin conclusión nunca se fuerza a `NOT_AUTHORIZED`.
  - Varias autorizaciones nunca se resuelven tomando la primera.
- **Resultados inciertos y reconciliación.**
  - `SEND_UNKNOWN` cuando no se puede demostrar si el SRI recibió el comprobante.
  - Reconciliación por clave antes de cualquier reenvío. Solo si el SRI demuestra que no conoce la clave, y las reglas lo permiten, se reenvían los mismos bytes.
  - La reconciliación es automática desde los jobs, o manual por el administrador sobre la factura; ambas usan el mismo caso de uso.
- **Revisión manual (`MANUAL_REVIEW`, ERS §12.1, Q-06).** Es un estado fiscal para lo que no puede resolverse automáticamente de forma segura. Solo sale con una reconciliación explícita del administrador, y no recoge errores técnicos recuperables.
- **Autorización registrada:** número, fecha, ambiente confirmado, respuesta original y XML autorizado exacto si viene, como artefacto distinto del `SIGNED_XML`, inmutables y verificables por hash.
- **Límite de tamaño del envío:** política versionada de `fiscal-catalogs`, comprobada antes de llamar al SRI, con falla cerrada sin versión vigente. La cifra oficial exacta en bytes (Q-47: la ficha dice "320 Kb" sin fijar la conversión) no se publica en este cambio: es una compuerta previa a la transmisión real.
- **Consulta y pantallas.** La factura muestra su estado de transmisión, los mensajes del SRI, los datos de autorización y su historial, sin XML ni SOAP. El administrador tiene una acción de reconciliación con motivo.
- **Observabilidad segura:** backlog y antigüedad de los jobs, intentos por resultado, comprobantes en `SEND_UNKNOWN` y en revisión manual, y latencia de autorización.

Fuera de alcance:
- **RIDE, descarga del XML y bandeja documental** (cambio 8).
- **Observación de anulaciones** (Q-16, capacidad futura `cancellation-observation`).
- **Corrección de un comprobante devuelto** (BR-28, capacidad futura `correct-returned-document`): `RETURNED` no tiene salida en este cambio.
- **Los otros cinco comprobantes.** La transmisión se diseña sobre el comprobante genérico, pero solo la factura llega a `SIGNED` hoy.
- **Reconstrucción del XML**, una clave o un secuencial nuevos, y cualquier lógica del borrador o del cálculo de la factura.
- **Evidencia externa:** la interpretación exacta en bytes del límite de tamaño (Q-47), S-3 online, un P12 ecuatoriano real y un RUC habilitado en Pruebas. Son compuertas previas a la transmisión real, no partes de este cambio, que solo trae el procedimiento de prueba. El vector oficial de la clave se verificó durante el apply.

## Capabilities

### New Capabilities

- `sri-transmission`: transmisión de un comprobante firmado al SRI hasta un estado fiscal definitivo o reconciliable.
  - Envío automático y verificado de los bytes firmados.
  - Evidencia de cada intento antes de clasificar.
  - Recepción, autorización, errores 70, 43 y 45, y resultados inciertos.
  - Reconciliación automática y manual, y revisión manual.
  - Autorización registrada y reintentos acotados.

### Modified Capabilities

- `invoices`:
  - la consulta de facturas muestra los estados de transmisión, los mensajes del SRI, la autorización y el historial;
  - los permisos añaden la reconciliación manual, solo del administrador.
- `audit-trail`: auditoría de la reconciliación manual solicitada y completada.
- `fiscal-catalogs`: política versionada del límite de tamaño del comprobante firmado para el envío al SRI.

## Impact

- **Backend:**
  - `platform/jobs`: la cola durable, el runner con workers configurables y el apagado ordenado.
  - `sri-engine`: el puerto `SriTransport`, su adaptador sobre el `fetch` nativo, los sobres SOAP, los endpoints por ambiente, los parsers de recepción y autorización, y el circuit breaker.
  - `fiscal`: la máquina de transmisión, los intentos y respuestas, la clasificación, la reconciliación y el artefacto `AUTHORIZED_XML`.
  - `invoices`: el encolado al firmar, la acción de reconciliación y la vista de la transmisión.
- **Base de datos:**
  - estados nuevos del comprobante y campos de autorización inmutables;
  - transiciones ampliadas;
  - el tipo de artefacto `AUTHORIZED_XML`;
  - tablas de jobs, intentos, respuestas originales y resultados, de solo agregado salvo el estado del job.
- **API:** `GET /api/v1/invoices/{id}/transmission` y `POST /api/v1/invoices/{id}/reconciliations`. No hay endpoints de envío ni de SOAP.
- **Permisos:** `invoices.reconcile`, solo del administrador.
- **Configuración:**
  - la transmisión habilitada o no;
  - workers y arriendo;
  - timeouts de conexión, de cabeceras y de cuerpo;
  - intervalos y ventanas;
  - circuit breaker;
  - endpoints sobrescribibles.

  Todo es configuración operativa, no regla normativa.
- **Frontend:** estados nuevos en `Facturas`, y la transmisión, el historial y la reconciliación en el detalle de la factura.
- **Dependencias:** un parser XML como dependencia directa con versión exacta, ya presente en el árbol. No se añaden librerías de jobs ni de HTTP.
- **Documentación:** `fiscal-emission.md`, `integrations.md`, `deployment.md`, `backend.md`, `database.md`, `ARCHITECTURE.md`, `access-control.md`, `domain-model.md`, `glossary.md` y `open-questions.md` (Q-06, Q-47), además del procedimiento de S-3 online.
