#!/usr/bin/env bash
# Instala el Gitleaks fijado (add-ci-dependency-and-secret-scanning, design D4): descarga el artefacto
# oficial con curl -fsSL, comprueba su SHA-256 contra el valor del repositorio antes de extraer o
# ejecutar nada, y verifica la versión. La suma del repositorio es el ancla de confianza.
# Uso: scripts/security/install-gitleaks.sh <archivo de fijación> <directorio de destino>
set -euo pipefail

fail() {
  echo "$1"
  echo "SECRET SECURITY: ERROR"
  exit 2
}

[ $# -eq 2 ] || fail "Uso: install-gitleaks.sh <archivo de fijación> <directorio de destino>"
pin=$1
dest=$2
field() {
  node -e 'const pin = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const value = pin[process.argv[2]];
if (typeof value !== "string" || value === "") process.exit(1);
process.stdout.write(value);' "$pin" "$1" || fail "La fijación de Gitleaks no tiene el campo $1."
}
version=$(field version)
artifact=$(field artifact)
sha256=$(field sha256)
url=$(field url)
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "La versión fijada de Gitleaks no es exacta."
[[ $sha256 =~ ^[0-9a-f]{64}$ ]] || fail "La suma fijada de Gitleaks no es un SHA-256."
[[ $artifact =~ ^[A-Za-z0-9._-]+\.tar\.gz$ ]] || fail "El artefacto fijado de Gitleaks no es válido."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsSL --retry 3 --output "$work/$artifact" "$url" ||
  fail "No se pudo descargar el artefacto de Gitleaks $version."
echo "$sha256  $work/$artifact" | sha256sum --check --status - ||
  fail "La suma SHA-256 del artefacto no coincide con la fijada; no se extrae ni se ejecuta."
tar -xzf "$work/$artifact" -C "$work" gitleaks || fail "El artefacto de Gitleaks no contiene el binario."
mkdir -p "$dest"
install -m 0755 "$work/gitleaks" "$dest/gitleaks"
actual=$("$dest/gitleaks" version 2>/dev/null || true)
if [ "$actual" != "$version" ]; then
  rm -f "$dest/gitleaks"
  fail "El binario informa la versión '$actual' en lugar de $version."
fi
echo "Gitleaks $version instalado y verificado (SHA-256 ${sha256:0:12}…)."
