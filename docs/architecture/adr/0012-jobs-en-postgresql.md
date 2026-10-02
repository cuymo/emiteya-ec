# ADR 0012: Jobs persistidos en PostgreSQL para la orquestación SRI

## Status

Proposed.

## Context

Los pasos de red con el SRI deben sobrevivir a reinicios, ejecutarse al menos una vez y ser
idempotentes. Encolar un job debe ser atómico con la transición de estado que lo origina.
Una instalación self-hosted debe ser simple de operar.

## Decision

- La cola de jobs vive en PostgreSQL: estado, momento de ejecución, intentos y clave de deduplicación. Los workers reclaman trabajo con `FOR UPDATE SKIP LOCKED`.
- El job se encola en la misma transacción que la transición de estado.
- El runner corre en el proceso de la API o en un proceso separado de la misma imagen.
- Cada job tiene una clave de deduplicación por comprobante y paso, y su handler verifica el estado antes de actuar.
- Usar una librería o una implementación propia se decide en el spike técnico (Q-34); si es una dependencia, tiene su propio ADR.

## Consequences

- Encolado transaccional sin infraestructura adicional como Redis.
- El rendimiento de una cola en PostgreSQL basta para una empresa por instancia.
- Pendiente: métricas y alertas del backlog de jobs (CTX §48).
