# Proposal

## Why

Es la prioridad 5, el último bloque del hardening del go-live: el administrador técnico que instala
EmiteYa para un contribuyente no tiene hoy una forma reproducible de desplegarlo, protegerlo detrás
de TLS ni recuperarlo después de perder el servidor. La readiness del 2026-10-13 confirmó que el
repositorio solo trae el `compose.yaml` de desarrollo con PostgreSQL; todo lo demás que el go-live
exige es prosa en `docs/architecture/deployment.md`.

**Evidencia de la readiness:**
- **No hay imágenes ni topología de producción:** ni Dockerfiles, ni `.dockerignore`, ni Compose de
  producción, ni proxy, ni TLS, ni HSTS, ni el volumen del directorio de exportación, ni scripts de
  respaldo o restauración, ni CI de contenedores. `docs/architecture/stack.md` ya declara Docker
  como empaquetado por defecto.
- **Sin `.dockerignore`**, un contexto de build en la raíz incluiría unos 2,9 GB de `node_modules` y
  `.next`, `.git`, y los archivos de entorno sin versionar: el `.gitignore` no protege un contexto de
  Docker.
- **El borde TLS tiene compromisos pendientes:** HSTS (spec `web-security-policy`, «HSTS en el borde
  TLS»), el techo de cuerpo del proxy de al menos 4 MiB con 8 MiB como objetivo (deuda de H-03) y
  la espera de al menos 120 s antes del primer byte de la descarga de portabilidad (go-live de
  `definition-of-done.md`).
- **`TRUST_PROXY` necesita la topología real:** la prioridad 4 validó su gramática y dejó el valor de
  producción para este bloque; el límite de intentos de inicio de sesión depende de que `req.ip`
  sea la IP real del cliente.
- **Un respaldo no está demostrado hasta restaurarlo:** el go-live exige que «un respaldo completo se
  restaura con éxito», y la custodia de la firma depende de una clave maestra que el volcado de la
  base de datos no contiene (ADR 0011).

## What Changes

- **Imágenes de producción reproducibles** sobre `node:24.21.0-bookworm-slim`: el backend
  (`node dist/main.js`), un objetivo de un solo uso para las migraciones (`prisma migrate deploy`) y
  el frontend (`next start`, no la salida `standalone`, para que siga corriendo la comprobación de
  `API_INTERNAL_URL` de la prioridad 4). Ejecución sin root, sin secretos en las capas y con un
  `.dockerignore` estricto, comprobado con archivos sintéticos.
- **Una topología de referencia con Docker Compose:** nginx como único servicio público (443 con TLS
  y 80 solo para redirigir); el frontend, el backend y PostgreSQL 17 en una red privada sin salida a
  Internet. `/api/*` va del borde directo al backend; el resto, al frontend. PostgreSQL y el
  directorio de exportación en volúmenes con nombre. Orden de arranque por salud y por migración
  completada, y 30 s de gracia al apagar.
- **El borde nginx de referencia:** redirección de HTTP a HTTPS, HSTS
  (`max-age=31536000`, sin subdominios ni precarga) solo en HTTPS, cabeceras reenviadas normalizadas
  (la IP del cliente sobrescrita por el borde), 8 MiB en `/api/` y 1 MiB en lo demás, 180 s solo
  para la descarga de portabilidad, y la salud y las métricas del backend nunca publicadas.
- **`TRUST_PROXY` de producción:** la IP interna explícita de nginx, fija en una red propia con su
  rango declarado. Nunca un número de saltos como configuración canónica, ni toda la subred.
- **Respaldo y restauración verificados:** `pg_dump -Fc` con PostgreSQL 17 y su SHA-256;
  restauración con `pg_restore` en una base nueva y vacía, que se niega a escribir sobre una base con
  datos salvo una opción destructiva explícita; la aplicación arranca sobre lo restaurado y supera
  comprobaciones de integridad con datos sintéticos no fiscales, incluida una custodia de firma
  sintética.
- **Un workflow `deployment` separado**, en paralelo a `verify` y `security`: construye las imágenes,
  levanta la topología con TLS efímero y secretos sintéticos, y ensaya la persistencia y la
  recuperación, sin publicar imágenes ni tráfico al SRI.
- **Documentación operativa:** `deployment.md`, el README (instalación, actualización, respaldo y
  restauración), la evidencia del reloj del host, la dependencia de la clave maestra y la deuda que
  este cambio cierra.

**Fuera de alcance:**
- Cualquier tráfico al SRI, en Pruebas o en Producción; las pruebas corren con
  `SRI_TRANSMISSION_ENABLED=0` y sin salida a Internet.
- Crear o firmar comprobantes fiscales para las pruebas, y cualquier cambio fiscal (XML, firma, XSD,
  SOAP, reconciliación, numeración, catálogos, evidencia de la certificación).
- Kubernetes, orquestadores, registro o publicación de imágenes, fijación por digest, Caddy,
  Traefik u otros proxies de referencia.
- Cifrado propio de los respaldos, su retención y su almacenamiento fuera del servidor: son del
  operador, y la revisión final del go-live pide su evidencia.
- Un RTO o RPO aprobado: no existe, y las duraciones medidas en el ensayo solo son evidencia.
- La rotación de la clave maestra, `REQUEST_LOG_PATH_MINIMIZATION`, `STYLE_INLINE_DEBT`,
  `SIDE_EFFECTING_GET_SEMANTICS`, los avisos de dependencias, varias instancias con estado
  compartido, un límite de frecuencia en el borde, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CHANGELOG` y las revisiones normativas.
- Medir el reloj desde la aplicación: la evidencia es del host.

## Capabilities

### New Capabilities
- `production-deployment`: el comportamiento observable del despliegue de producción de
  referencia: qué es público y qué privado, cómo el borde TLS redirige, protege y enruta, qué IP del
  cliente llega a la aplicación, qué tamaños y esperas admite, qué estado sobrevive a recrear los
  contenedores, y cómo un respaldo restaurado en una base nueva vuelve a dar una aplicación
  utilizable.

### Modified Capabilities
<!-- Ninguna: `production-configuration` sigue siendo la dueña de validar la configuración al arrancar,
`web-security-policy` ya deja HSTS al borde TLS y `data-portability` ya declara que su paquete no es
un respaldo. Este cambio las cumple sin cambiar sus requisitos. -->

## Impact

- **Nuevo, de despliegue:** Dockerfiles multietapa del backend (con el objetivo de migración) y del
  frontend, `.dockerignore`, la topología Compose de producción, la configuración de nginx, una
  plantilla de entorno de producción solo con marcadores, y los scripts de respaldo y restauración.
- **Nuevo, de verificación:** los ensayos de la topología y de la recuperación (scripts del
  repositorio que orquestan Docker sin shell) y `.github/workflows/deployment.yml`.
- **Sin cambios de comportamiento** en el backend ni en el frontend: los límites de cuerpo de la
  aplicación, la protección de las peticiones de H-03, la configuración de la prioridad 4 y la
  emisión fiscal no cambian.
- **Documentación:** `docs/architecture/deployment.md`, `docs/architecture/stack.md` (versiones de
  las imágenes), un ADR de la topología de despliegue, `README.md`,
  `docs/quality/definition-of-done.md`, `docs/quality/testing.md` y `docs/quality/technical-debt.md`.
