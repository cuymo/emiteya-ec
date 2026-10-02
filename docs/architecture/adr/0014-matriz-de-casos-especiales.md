# ADR 0014: Casos especiales bloqueados por una matriz de soporte

## Status

Accepted. Origen: CTX §38.1, §57.

## Context

La ficha técnica incluye 26 anexos para casos especiales. Emitir uno de ellos como
comprobante ordinario produce un XML válido pero tributariamente incorrecto (CTX R7).

## Decision

- Cada anexo tiene un soporte declarado como dato versionado: `SUPPORTED`, `BLOCKED`, `NOT_APPLICABLE` o `UNDER_REVIEW`.
- Una operación que requiere un caso no soportado falla antes de emitir, con un mensaje funcional.
- El producto nunca declara cobertura total de los casos tributarios de Ecuador.

## Consequences

- No se emiten XML tributariamente incorrectos por casos especiales.
- Algunos contribuyentes no podrán usar el MVP para todas sus operaciones.
- Pendiente: confirmar la matriz inicial (Q-38); el soporte de cada anexo nuevo es un cambio OpenSpec.
