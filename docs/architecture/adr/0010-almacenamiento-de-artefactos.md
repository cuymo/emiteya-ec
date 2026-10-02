# ADR 0010: Almacenamiento de artefactos fiscales

## Status

Proposed. Depende de Q-39.

## Context

Los artefactos (XML firmado y autorizado, respuestas del SRI, RIDE) son prueba fiscal de
largo plazo y contienen datos personales (ERS RF-404..407). CTX §31 recomienda object
storage cifrado; el ERS exige portabilidad sin dependencia de un proveedor cloud (RNF-008).

Alternativas consideradas:

- Contenido en PostgreSQL (`bytea`): un solo almacén transaccional y un solo respaldo, pero la base de datos crece con PDFs y XML durante años.
- Object storage S3-compatible: escalable y con cifrado del lado del servidor, pero añade un servicio a cada instalación self-hosted.
- Sistema de archivos en volumen persistente: lo más simple de operar, con cifrado delegado al disco o al volumen.

## Decision

- Un puerto de almacenamiento de solo escritura única: guarda un contenido y devuelve su clave y hash; no ofrece sobrescritura ni borrado.
- Adaptador por defecto: sistema de archivos en un volumen persistente. Adaptador S3-compatible opcional.
- La base de datos guarda metadatos, hash SHA-256 y la clave interna, que nunca se expone.
- Cada lectura recalcula el hash y alerta si no coincide.
- El cifrado en reposo del volumen, o el cifrado del lado del servidor en S3, es requisito de instalación.

## Consequences

- Portable y sin servicios adicionales por defecto.
- El respaldo tiene dos partes de datos más la clave maestra (`../deployment.md`).
- Pendiente: confirmar Q-39 y decidir si se añade un job periódico de verificación de integridad.
