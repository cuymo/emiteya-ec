# ADR 0011: Custodia del certificado de firma

## Status

Proposed.

## Context

El P12 y su contraseña permiten firmar en nombre del contribuyente. El ERS exige cifrado en
reposo, preferir un KMS cuando exista y no exponerlos nunca al navegador (RF-131, RF-132,
SEC-002); CTX §20.4 prohíbe guardarlos en claro, en logs o en respaldos sin cifrar.

## Decision

- Cifrado envolvente: el P12 y la contraseña se cifran con AES-256-GCM usando una clave de datos, cifrada a su vez con una clave maestra entregada por variable o archivo de secreto, nunca guardada en la base de datos.
- Un puerto de bóveda de secretos permite reemplazar la clave maestra local por un KMS.
- Solo el adaptador de firma descifra, en memoria y durante la firma; el secreto es un tipo que no se serializa ni se registra.
- No existe endpoint de lectura del certificado; la API expone solo metadatos: titular, emisor y vigencia.
- Reemplazar el certificado descarta el secreto anterior y conserva sus metadatos.

## Consequences

- Una filtración de la base de datos no expone el certificado.
- Perder la clave maestra obliga a volver a cargar el certificado (riesgo R-15).
- Pendiente: procedimiento de rotación de la clave maestra.
