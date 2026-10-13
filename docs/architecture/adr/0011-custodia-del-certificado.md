# ADR 0011: Custodia del certificado de firma

## Status

Accepted el 2026-10-02.

## Context

El P12 y su contraseña permiten firmar en nombre del contribuyente. El ERS exige cifrado en
reposo, preferir un KMS cuando exista y no exponerlos nunca al navegador (RF-131, RF-132,
SEC-002); CTX §20.4 prohíbe guardarlos en claro, en logs o en respaldos sin cifrar.

## Decision

- **Metadatos y secreto por separado.**
  - Metadatos: titular, emisor, número de serie y huella, vigencia, RUC detectado, estado, fechas de carga y de reemplazo, y la información no secreta necesaria.
  - Secreto, en un almacenamiento específico de PostgreSQL: el P12 y su contraseña cifrados, los nonces y etiquetas del cifrado, la clave de datos envuelta y la versión de la clave maestra que la envolvió.
  - El P12 nunca se guarda en claro.
- **Cifrado envolvente.** El P12 y la contraseña se cifran con AES-256-GCM usando una clave de datos aleatoria por certificado, cifrada a su vez con la clave maestra.
- **Preparado para rotar.** Cada secreto guarda la versión de la clave maestra que lo envolvió, y una única abstracción de cifrado cifra y descifra. Ningún secreto asume una única clave maestra para siempre. Un puerto de bóveda permite reemplazar la clave local por un KMS.
- **La clave maestra no vive en PostgreSQL:** llega por variable o archivo de secreto.
- **Arranque.** En producción, el backend no arranca si falta la clave maestra: no hay un servidor aparentemente sano con la firma inutilizable. En desarrollo y pruebas puede existir un modo explícito sin firma, solo si se configura expresamente; nunca se activa de forma implícita ni en producción.
- **Uso.** Solo el adaptador de firma descifra, en memoria y durante la firma; el secreto es un tipo que no se serializa ni se registra.
- **Sin lectura.** No existe endpoint de lectura del certificado ni de su contraseña; la API expone solo metadatos.
- **Reemplazo.** Reemplazar el certificado elimina el secreto anterior, incluida su contraseña, y conserva sus metadatos y su auditoría. Destruir el secreto es una excepción intencional a la escritura única de los artefactos fiscales (ADR 0010) y de los assets de configuración (ADR 0017): es material criptográfico sensible, no evidencia fiscal.
- **Nunca en registros.** Bytes del P12, contraseña, clave privada y secretos no aparecen en logs, errores, respuestas ni auditoría.

## Consequences

- Una filtración de la base de datos no expone el certificado.
- Perder o cambiar la clave maestra deja la firma no disponible hasta volver a cargarla: cargar otra
  vez el mismo P12 con su contraseña restablece su custodia con la clave configurada, sin crear otra
  firma (riesgo R-15; `repair-signing-certificate-reseal-after-master-key-change`).
- La rotación automática de la clave maestra (volver a cifrar los secretos sin volver a cargarlos) no se implementa todavía, pero el formato la admite: es deuda. El requisito del go-live (`definition-of-done.md`) se cumple con el procedimiento operativo documentado y probado de `deployment.md`, «Sustitución de la clave maestra» (2026-10-13).
