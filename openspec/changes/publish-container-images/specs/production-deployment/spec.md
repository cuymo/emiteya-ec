## ADDED Requirements

### Requirement: Imágenes publicadas de cada versión
Cada versión publicada con una etiqueta `vX.Y.Z` SHALL producir las imágenes de producción del backend, de las migraciones y de la interfaz en GitHub Container Registry, con la versión exacta, sus alias semánticos, su procedencia y su SBOM. La publicación SHALL rechazar una etiqueta que no sea `vX.Y.Z` o que no coincida con la versión del proyecto. El despliegue de referencia SHALL poder usar esas imágenes sin compilar, eligiendo el registro y la versión por variables.

#### Scenario: Versión publicada
- **WHEN** se publica la etiqueta `v1.0.0` en un proyecto cuya versión es `1.0.0`
- **THEN** el registro tiene `emiteya-backend`, `emiteya-migrate` y `emiteya-frontend` con las etiquetas `1.0.0`, `1.0`, `1` y `latest`

#### Scenario: Etiqueta que no coincide
- **WHEN** se publica una etiqueta que no es `vX.Y.Z` o que no coincide con la versión del proyecto
- **THEN** el workflow termina con error sin subir ninguna imagen

#### Scenario: Desplegar sin compilar
- **WHEN** un operador fija `EMITEYA_IMAGE_PREFIX=ghcr.io/cuymo/` y `EMITEYA_IMAGE_TAG=1.0.0`
- **THEN** `docker compose pull` descarga las imágenes publicadas y `up -d --no-build` despliega con ellas, sin compilar
