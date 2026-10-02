# ADR 0001: El sistema es un facturador electrónico, no un ERP

## Status

Accepted. Origen: ERS §22.2, ADR-001.

## Context

Los contribuyentes necesitan emitir los seis comprobantes del SRI sin adoptar un ERP. Cada
función ajena a ese objetivo agranda la superficie de mantenimiento y de riesgo fiscal.

## Decision

El producto solo configura, emite, conserva, consulta y exporta los seis comprobantes. Una
funcionalidad entra al MVP solo si es indispensable para eso; lo demás es post-MVP o queda
fuera de alcance (ERS §2.3, §21 y cierre).

## Consequences

- Alcance acotado y verificable.
- Quien necesite POS, contabilidad o cartera debe integrar otro sistema mediante la API.
- Cada propuesta OpenSpec declara explícitamente su fuera de alcance.
