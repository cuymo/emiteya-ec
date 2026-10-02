# ADR 0013: Firma con los parámetros vigentes del SRI en un módulo aislado

## Status

Accepted. Origen: CTX §20 y su regla de proyecto §20.1.

## Context

La ficha técnica v2.34 exige XAdES-BES 1.3.2, firma enveloped, certificado X.509 en
`KeyInfo`, RSA-SHA1, clave de 2048 bits y contenedor PKCS#12. RSA-SHA1 es legado desde el
punto de vista criptográfico, pero sigue siendo el algoritmo documentado.

## Decision

- Se implementan exactamente los parámetros de la ficha vigente, sin sustituir RSA-SHA1 por SHA-256 por iniciativa propia.
- El firmador vive detrás de un puerto aislado para migrar cuando el SRI cambie formalmente la especificación.
- El spike técnico verifica que el runtime, con OpenSSL 3, firma RSA-SHA1 y que el SRI autoriza el resultado en Pruebas.

## Consequences

- Compatibilidad con el SRI.
- Dependencia de un algoritmo legado que el runtime podría restringir en el futuro.
- Pendiente: Q-34 y la vigilancia de cambios de la ficha.
