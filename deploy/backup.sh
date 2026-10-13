#!/usr/bin/env bash
# Respaldo lógico de la base de datos de la topología de referencia (harden-deployment-proxy-and-recovery,
# design D11; ADR 0027). Uso:
#   deploy/backup.sh <directorio-de-salida>
# Con las mismas variables de Docker Compose del despliegue (EMITEYA_PROJECT, EMITEYA_ENV_FILE,
# EMITEYA_SECRETS_DIR y PUBLIC_ORIGIN). Produce, con modo 0600:
#   <directorio>/emiteya-<AAAAmmddTHHMMSSZ>.dump         pg_dump -Fc de PostgreSQL 17
#   <directorio>/emiteya-<AAAAmmddTHHMMSSZ>.dump.sha256  su SHA-256
# El volcado contiene datos fiscales y del negocio: cífralo en reposo bajo tu control, guárdalo fuera
# del servidor y nunca junto a su clave de cifrado ni a la clave maestra de la custodia, que no
# contiene y que se respalda aparte. No es una exportación de portabilidad.
set -euo pipefail
umask 077

if [ $# -ne 1 ]; then
  echo "Uso: deploy/backup.sh <directorio-de-salida>" >&2
  exit 2
fi
out_dir=$1
here=$(cd "$(dirname "$0")" && pwd)
compose=(docker compose -f "$here/compose.yaml" -p "${EMITEYA_PROJECT:-emiteya}")

mkdir -p "$out_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="emiteya-$stamp.dump"
dump="$out_dir/$name"
partial="$dump.partial"
trap 'rm -f "$partial"' EXIT

# pg_dump por el socket local del contenedor: ninguna contraseña en los argumentos ni en el entorno
# del host. Un fallo deja solo el temporal, que se borra.
if ! "${compose[@]}" exec -T postgres sh -c \
  'exec pg_dump --format=custom --no-password --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  >"$partial"; then
  echo "respaldo: pg_dump falló; no se produjo ningún volcado" >&2
  exit 1
fi
mv "$partial" "$dump"
(cd "$out_dir" && sha256sum "$name" >"$name.sha256")

echo "respaldo: $dump ($(stat -c %s "$dump") bytes)"
echo "sha256: $(cut -d' ' -f1 "$dump.sha256")"
