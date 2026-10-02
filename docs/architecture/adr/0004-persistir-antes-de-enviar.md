# ADR 0004: El XML firmado se persiste antes de enviar al SRI

## Status

Accepted. Origen: ERS §22.2, ADR-004; CTX §21.

## Context

Si el proceso muere después de enviar y antes de guardar la respuesta, solo el XML firmado
y su clave de acceso permiten reconstruir lo ocurrido consultando al SRI.

## Decision

El XML firmado, su hash y los datos que componen la clave se persisten, y el comprobante
queda en `SIGNED`, antes de cualquier llamada de red. Cada respuesta del SRI se persiste
antes de actuar sobre ella.

## Consequences

- Los casos de recuperación A–D de CTX §52 son posibles.
- Cada emisión hace escrituras adicionales.
- La invariante I-11 (XML firmado existente antes del envío) se cubre con una prueba.
