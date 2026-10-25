## 1. Imágenes publicadas

- [x] 1.1 Agregar `.github/workflows/images.yml` (etiqueta `vX.Y.Z` o ejecución manual, comprobación de la etiqueta contra `package.json`, las tres imágenes para `linux/amd64` con etiquetas semánticas, etiquetas OCI, procedencia y SBOM, acciones fijadas por SHA) y `EMITEYA_IMAGE_PREFIX` en `deploy/compose.yaml`; verificar con `docker compose config` con y sin el prefijo y con la validación del YAML.
- [x] 1.2 Documentar el despliegue con las imágenes publicadas en `docs/architecture/deployment.md`, el README y el registro de cambios.
