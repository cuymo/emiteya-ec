# ADR 0010: Almacenamiento de artefactos fiscales

## Status

Accepted el 2026-10-03 (Q-39), con PostgreSQL como almacenamiento inicial. Sustituye la
propuesta anterior de un sistema de archivos por defecto.

## Context

Los artefactos (XML firmado y autorizado, respuestas del SRI, RIDE) son prueba fiscal de
largo plazo y contienen datos personales (ERS RF-404..407). CTX §31 recomienda object
storage cifrado; el ERS exige portabilidad sin dependencia de un proveedor cloud (RNF-008).

Alternativas consideradas:

- Contenido en PostgreSQL (`bytea`): un solo almacén transaccional y un solo respaldo, pero la base de datos crece con PDFs y XML durante años.
- Object storage S3-compatible: escalable y con cifrado del lado del servidor, pero añade un servicio a cada instalación self-hosted.
- Sistema de archivos en volumen persistente: lo más simple de operar, con cifrado delegado al disco o al volumen.

El primer artefacto es el XML firmado de `add-invoice-emission`: debe persistirse antes de
cualquier envío (ADR 0004) y en la misma transacción que deja el comprobante en `SIGNED`.

## Decision

- **Puerto.** Un puerto de almacenamiento de escritura única: guarda un contenido y devuelve su identificador y hash; no ofrece sobrescritura ni borrado. El dominio solo conoce el puerto.
- **Adaptador inicial: PostgreSQL.** El contenido va en `bytea`, que conserva los bytes exactos, junto a sus metadatos. Así, el XML firmado y la transición a `SIGNED` se confirman en la misma transacción, y un solo respaldo los cubre.
- **XML firmado.** Se guardan:
  - los bytes UTF-8 exactos que se enviarán después al SRI;
  - su SHA-256, su tamaño y su tipo de medio;
  - el comprobante al que pertenece y la fecha de creación;
  - la versión del esquema, la versión de `facturacion-electronica-ec` y los hashes de los XSD aplicados, incluido el import de la firma.
- **Inmutable.** El contenido no admite `UPDATE` ni `DELETE` normales; la base de datos lo impide. El XML nunca se regenera para enviarlo: `add-sri-transmission` envía el mismo artefacto persistido.
- **Integridad.** Cada lectura recalcula el hash y alerta si no coincide (ERS RF-407).
- **Fuera de este ADR.** Las respuestas originales del SRI y el XML autorizado pertenecen a `add-sri-transmission`, y el RIDE a `add-document-archive`. Usarán el mismo puerto.
- **Migración futura.** Un adaptador de object storage o de sistema de archivos puede sustituir a PostgreSQL detrás del puerto sin cambiar el dominio, con una migración de contenido que conserve hashes e identificadores.

## Consequences

- Sin servicios adicionales y con una sola copia de seguridad: la de PostgreSQL.
- La base de datos crece con los artefactos. El tamaño de un XML firmado está acotado por el límite versionado de CTX §29. Cuando lleguen el RIDE y el volumen real lo justifique, se evaluará mover el contenido a object storage detrás del mismo puerto.
- El cifrado en reposo es el del volumen de PostgreSQL, como requisito de instalación (`../deployment.md`).
- Pendiente: decidir si se añade un job periódico de verificación de integridad.
