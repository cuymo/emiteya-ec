# ADR 0005: Un resultado ambiguo se reconcilia con la misma clave

## Status

Accepted. Origen: ERS §22.2, ADR-005; CTX §22.3, §27, §52.

## Context

Un timeout no es un rechazo. El SRI identifica cada comprobante por su clave de acceso:
reenviar el mismo XML firmado no crea otro comprobante, pero generar otro secuencial o
clave sí.

## Decision

- Todo resultado ambiguo lleva a `SEND_UNKNOWN`.
- Antes de cualquier reenvío se consulta por la misma clave.
- Solo se reenvía el mismo XML firmado persistido, y solo si el SRI no conoce la clave.
- Ante el error 70 se espera la autorización sin reenviar; ante los errores 43 y 45 se reconcilia.
- Ningún reintento genera automáticamente un secuencial o una clave nuevos.

## Consequences

- No existen comprobantes fiscales duplicados por fallas de red.
- Un comprobante puede quedar pendiente hasta 24 horas.
- El umbral para pasar a revisión manual se decide en Q-06.
