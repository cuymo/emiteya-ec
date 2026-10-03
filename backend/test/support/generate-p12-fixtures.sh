#!/usr/bin/env bash
# P12 sintéticos de las pruebas (add-signing-certificate, design D15 y D16): ningún certificado ni
# clave real, y nada de esto se commitea. Compatible con OpenSSL 3.0 (Ubuntu 24.04, la CI): las
# vigencias en fechas fijas las crea node-forge (p12-fixtures.ts). Se generan al ejecutar las pruebas en el directorio que
# recibe como argumento. La CLI de OpenSSL usa el proveedor legado solo para crear los P12
# legados; el runtime nunca lo habilita.
set -euo pipefail
OUT=${1:?directorio de salida}
mkdir -p "$OUT" && cd "$OUT"
OID=1.3.6.1.4.1.37746.3.11   # RUC según la documentación pública de Security Data
RUC=1790012345001
OTHER_RUC=0992877878001
ASCII='Clave-Prueba-2026'
NONASCII='contraseña-ñ-€-Ü'

openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
  -subj "/C=EC/O=Entidad de Pruebas/CN=AC Pruebas" 2>/dev/null

issue() { # nombre, clave (rsaN o ec), extensión del RUC (o vacío), opciones de vigencia
  case $2 in
    rsa*) openssl genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:${2#rsa}" -out "$1.key" 2>/dev/null ;;
    ec) openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$1.key" 2>/dev/null ;;
  esac
  openssl req -new -key "$1.key" -out "$1.csr" \
    -subj "/C=EC/O=Empresa de Pruebas/serialNumber=0102030405/CN=TITULAR DE PRUEBA $1" 2>/dev/null
  {
    echo "basicConstraints=critical,CA:FALSE"
    echo "keyUsage=critical,digitalSignature,nonRepudiation"
    if [ -n "$3" ]; then echo "$3"; fi
  } > "$1.ext"
  # shellcheck disable=SC2086
  openssl x509 -req -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$1.crt" \
    -extfile "$1.ext" $4 2>/dev/null
}
VALID="-days 365"
issue sd-utf8 rsa2048 "$OID=ASN1:UTF8String:$RUC" "$VALID"
issue sd-printable rsa2048 "$OID=ASN1:PRINTABLESTRING:$RUC" "$VALID"
issue sd-ia5 rsa2048 "$OID=ASN1:IA5STRING:$RUC" "$VALID"
issue other-ruc rsa2048 "$OID=ASN1:UTF8String:$OTHER_RUC" "$VALID"
issue rsa4096 rsa4096 "$OID=ASN1:UTF8String:$RUC" "$VALID"
issue rsa1024 rsa1024 "$OID=ASN1:UTF8String:$RUC" "$VALID"
issue ec ec "$OID=ASN1:UTF8String:$RUC" "$VALID"
issue noruc rsa2048 "" "$VALID"
issue badruc rsa2048 "$OID=ASN1:UTF8String:1790012345002" "$VALID"
issue textruc rsa2048 "$OID=ASN1:UTF8String:RUC $RUC" "$VALID"
issue expiring rsa2048 "$OID=ASN1:UTF8String:$RUC" "-days 10"

p12() { # salida, certificado, contraseña, opciones
  local out=$1 cert=$2 pass=$3
  shift 3
  openssl pkcs12 -export -inkey "$cert.key" -in "$cert.crt" -certfile ca.crt -name "$cert" \
    -passout "pass:$pass" -out "$out" "$@"
}
for c in sd-utf8 sd-printable sd-ia5 other-ruc rsa4096 rsa1024 ec noruc badruc textruc expiring; do
  p12 "$c.modern.p12" "$c" "$ASCII"
done
p12 sd-utf8.legacy.p12 sd-utf8 "$ASCII" -legacy
p12 sd-utf8.3des.p12 sd-utf8 "$ASCII" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
p12 sd-utf8.modern.nonascii.p12 sd-utf8 "$NONASCII"
p12 sd-utf8.legacy.nonascii.p12 sd-utf8 "$NONASCII" -legacy
p12 sd-utf8.iter150000.p12 sd-utf8 "$ASCII" -iter 150000
openssl pkcs12 -export -nokeys -in sd-utf8.crt -passout "pass:$ASCII" -out nokey.p12
head -c 1200 sd-utf8.modern.p12 > corrupt-truncated.p12
head -c 2000 /dev/urandom > corrupt-random.p12
