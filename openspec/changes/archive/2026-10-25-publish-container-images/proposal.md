# Proposal

## Why

EmiteYa es open source y el despliegue de referencia hoy obliga a compilar las imágenes en el
servidor. El propietario pidió (2026-10-25) publicar imágenes compiladas en un registro público,
para que cualquiera las descargue y las use, desde v1.0.0.

## What Changes

- Un workflow (`.github/workflows/images.yml`) que, al publicar una etiqueta de versión `vX.Y.Z`, o
  a mano para una etiqueta ya publicada, construye las tres imágenes de producción y las sube a
  GitHub Container Registry:
  - `ghcr.io/cuymo/emiteya-backend`;
  - `ghcr.io/cuymo/emiteya-migrate`;
  - `ghcr.io/cuymo/emiteya-frontend`, compilada para la topología de referencia
    (`API_INTERNAL_URL=http://backend:4000`).
- Etiquetas semánticas (`1.0.0`, `1.0`, `1` y `latest` para versiones finales), etiquetas OCI con la
  licencia y el origen, procedencia (SLSA) y SBOM. Solo `linux/amd64` (decisión del propietario: un
  VPS típico con Debian).
- El workflow se niega a publicar si la etiqueta no es `vX.Y.Z` o no coincide con la versión de
  `package.json`. Solo usa `GITHUB_TOKEN` con permiso de escritura de paquetes; no contacta el SRI.
- `deploy/compose.yaml` acepta `EMITEYA_IMAGE_PREFIX`: con
  `EMITEYA_IMAGE_PREFIX=ghcr.io/cuymo/` y `EMITEYA_IMAGE_TAG=1.0.0`, `docker compose pull` y
  `up -d --no-build` usan las imágenes publicadas en lugar de compilarlas.

## Capabilities

### Modified Capabilities

- `production-deployment`: requisito nuevo «Imágenes publicadas de cada versión».

## Impact

- CI: un workflow nuevo, que corre cuando GitHub Actions puede ejecutarse en el repositorio.
- Despliegue: `deploy/compose.yaml`, `docs/architecture/deployment.md` y el README.
- Las imágenes son públicas cuando el repositorio y los paquetes lo son; la primera vez puede hacer
  falta marcar cada paquete como público en GitHub.
