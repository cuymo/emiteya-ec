# ADR 0012: Jobs persistidos en PostgreSQL para la orquestación SRI

## Status

Accepted el 2026-10-03, antes de proponer `add-sri-transmission`. Se elige una cola durable propia
sobre PostgreSQL, sin librería de jobs ni infraestructura adicional.

## Context

Los pasos de red con el SRI deben sobrevivir a reinicios, ejecutarse al menos una vez y ser
idempotentes. Encolar un job debe ser atómico con la transición de estado que lo origina.
Una instalación self-hosted debe ser simple de operar.

## Decision

- **Cola propia sobre PostgreSQL.** La tabla de jobs vive en la misma base de datos que los comprobantes. `add-sri-transmission` no añade una librería de jobs ni otra infraestructura, como Redis o una cola externa.
- **Capacidades mínimas:**
  - job durable, que sobrevive a reinicios;
  - clave de deduplicación;
  - `scheduledAt` y `nextAttemptAt`;
  - número de intentos;
  - arriendo con expiración, que otro worker retoma al vencer;
  - selección concurrente segura, con `FOR UPDATE SKIP LOCKED` o un mecanismo equivalente;
  - último error tipado, sin secretos ni payloads;
  - número de workers configurable;
  - apagado ordenado: un worker termina o libera su job antes de salir;
  - backoff controlado por tipo de job;
  - sin reintentos infinitos ni bucles calientes: cada tipo de job tiene un máximo de intentos o una ventana. Al agotarla, el job se detiene con su último error, visible y alertado.
- **Los estados del job no son estados fiscales.** Pendiente, en curso, a la espera del siguiente intento o detenido son estados del job. El estado fiscal del comprobante solo lo cambia su máquina de estados, con una transición guardada.
- **Ningún comprobante firmado se queda sin job.** El job inicial de un comprobante nuevo se crea en la misma transacción que su paso a `SIGNED`. Vale también una estrategia equivalente que no pueda perder un comprobante firmado sin job, por ejemplo un barrido que crea los que falten.
- **Comprobantes ya firmados al desplegar.** Un backfill o reconciliación idempotente crea los jobs pendientes de los `SIGNED` existentes. Ejecutarlo dos veces no duplica nada.
- **Deduplicación por comprobante y fase.** Impide dos transmisiones simultáneas del mismo comprobante y la misma fase. El handler verifica el estado fiscal antes de actuar.
- **Runner.** Corre en el proceso de la API o en un proceso separado de la misma imagen.

## Consequences

- Encolado transaccional sin infraestructura adicional como Redis.
- El rendimiento de una cola en PostgreSQL basta para una empresa por instancia.
- Hay código propio que mantener: la cola, su arriendo y su apagado necesitan pruebas de concurrencia y de recuperación.
- Las métricas y alertas del backlog de jobs (CTX §48) las define el design de `add-sri-transmission`.
