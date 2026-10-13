#!/usr/bin/env bash
# Restauración de un respaldo de la base de datos (harden-deployment-proxy-and-recovery, design D11;
# ADR 0027). Uso:
#   deploy/restore.sh [--replace-existing] <volcado>
# Con las mismas variables de Docker Compose del despliegue de destino y con la aplicación detenida
# (solo el servicio postgres en marcha). Pasos:
#   1. comprueba el SHA-256 de <volcado>.sha256 antes de tocar nada;
#   2. se niega si la base de destino tiene objetos, salvo con --replace-existing, que es DESTRUCTIVA:
#      borra y recrea la base de destino antes de restaurar;
#   3. pg_restore --exit-on-error --no-owner, con las herramientas de PostgreSQL 17 del contenedor.
# Después: las migraciones (`docker compose ... up migrate`) y el arranque de la aplicación. Sin la
# misma clave maestra de la custodia, los certificados custodiados quedan no disponibles.
# Códigos: 0 restaurado, 2 uso, 3 suma distinta, 4 destino con datos, 5 pg_restore falló.
set -euo pipefail

replace=no
if [ "${1:-}" = "--replace-existing" ]; then
  replace=yes
  shift
fi
if [ $# -ne 1 ]; then
  echo "Uso: deploy/restore.sh [--replace-existing] <volcado>" >&2
  exit 2
fi
dump=$1
here=$(cd "$(dirname "$0")" && pwd)
compose=(docker compose -f "$here/compose.yaml" -p "${EMITEYA_PROJECT:-emiteya}")

if [ ! -f "$dump" ] || [ ! -f "$dump.sha256" ]; then
  echo "restauración: faltan el volcado o su archivo .sha256" >&2
  exit 2
fi

# 1. La suma, antes de cualquier cambio en el destino.
expected=$(cut -d' ' -f1 "$dump.sha256")
actual=$(sha256sum "$dump" | cut -d' ' -f1)
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "restauración: el SHA-256 no coincide; no se tocó la base de destino" >&2
  exit 3
fi

psql_target() {
  "${compose[@]}" exec -T postgres sh -c \
    'exec psql -X -q -t -A -v ON_ERROR_STOP=1 --no-password --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
}

# 2. El destino tiene que estar vacío: ningún objeto fuera de los esquemas del sistema.
objects=$(psql_target <<'SQL'
select count(*)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%'
  and n.nspname not like 'pg_temp%';
SQL
)
if [ "$objects" != "0" ]; then
  if [ "$replace" != "yes" ]; then
    echo "restauración: la base de destino tiene $objects objetos; no se mezcla un respaldo con datos existentes (--replace-existing la borra antes, de forma destructiva)" >&2
    exit 4
  fi
  echo "restauración: --replace-existing: se borra y se recrea la base de destino"
  "${compose[@]}" exec -T postgres sh -c \
    'exec psql -X -q -v ON_ERROR_STOP=1 -v db="$POSTGRES_DB" -v owner="$POSTGRES_USER" --no-password --username="$POSTGRES_USER" --dbname=postgres' <<'SQL'
drop database if exists :"db" with (force);
create database :"db" owner :"owner";
SQL
fi

# 3. La restauración; un fallo nunca se presenta como recuperada.
started=$(date +%s)
if ! "${compose[@]}" exec -T postgres sh -c \
  'exec pg_restore --exit-on-error --no-owner --no-password --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  <"$dump"; then
  echo "restauración: pg_restore falló; la base de destino no está recuperada" >&2
  exit 5
fi
echo "restauración: completa en $(($(date +%s) - started)) s desde $dump"
echo "siguiente paso: aplica las migraciones y arranca la aplicación"
