# ADR 0007: API y motor fiscal desacoplados de la interfaz web

## Status

Accepted. Origen: ERS §22.2, ADR-007; CTX §4.1, §43, §44.

## Context

Otros proyectos deben poder reutilizar el motor fiscal, y las librerías de SOAP y de firma
pueden cambiar.

## Decision

- La interfaz web consume la misma API versionada que un integrador.
- El dominio fiscal es puro y no hace IO.
- Los puertos son los de CTX §43 (recepción, autorización, consulta, validador XSD), más firmador, almacenamiento de artefactos y renderer del RIDE.
- Los objetos de cada librería se normalizan dentro de su adaptador.

## Consequences

- Una librería se reemplaza sin tocar el dominio.
- La API se documenta con OpenAPI (ERS API-005).
- Hay más interfaces que mantener.
- Una regla de lint verifica la dirección de dependencias.
