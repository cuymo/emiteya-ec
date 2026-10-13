# ADR 0027: topología de despliegue de producción de referencia

## Status

Accepted el 2026-10-13, en la revisión de `harden-deployment-proxy-and-recovery`. Es la prioridad 5,
el último bloque del hardening del go-live.

## Context

- **No había despliegue reproducible.** El repositorio solo traía el Compose de desarrollo con
  PostgreSQL; las imágenes, el proxy, TLS, HSTS, los volúmenes y la recuperación eran prosa en
  `deployment.md`. `stack.md` ya declaraba Docker como empaquetado por defecto.
- **El borde tenía compromisos abiertos:** HSTS (spec `web-security-policy`), un techo de cuerpo de
  al menos 4 MiB, una espera de al menos 120 s antes del primer byte de la descarga de portabilidad,
  y el valor real de `TRUST_PROXY`, que la prioridad 4 dejó para la topología.
- **Medido en la readiness y la implementación:**
  - el reenvío de `/api` de Next.js corta a los 30 s y no reescribe `X-Forwarded-For`;
  - la salida `standalone` de Next.js incrusta la configuración y no vuelve a evaluar
    `next.config.ts`;
  - las migraciones de Prisma necesitan su `schema-engine` nativo de Debian con OpenSSL 3, y la API
    en ejecución no;
  - la API envía su propia HSTS con `includeSubDomains` (el `helmet()` por defecto);
  - la imagen oficial de nginx necesita las capacidades `CHOWN`, `NET_BIND_SERVICE`, `SETGID` y
    `SETUID`, y ninguna más.
- **La custodia de la firma depende de una clave maestra que el volcado no contiene** (ADR 0011).

## Decision

- **Un solo host con Docker Compose** (`deploy/compose.yaml`), sin orquestador: nginx, la interfaz,
  la API, PostgreSQL 17 y un servicio de migración de un solo uso.
- **nginx es el borde TLS de referencia y el único servicio público** (443 y 80 solo para
  redirigir):
  - termina TLS y emite la única HSTS pública (`max-age=31536000`, sin `includeSubDomains` ni
    `preload`), descartando la de la aplicación;
  - normaliza las cabeceras reenviadas, con `X-Forwarded-For` sobrescrita con la IP que observa;
  - fija el techo de cuerpo (8 MiB en `/api/`, 1 MiB en el resto) y la espera de la descarga de
    portabilidad (180 s, sin almacenarla);
  - no publica la salud ni las métricas de la API.

  Otros proxies o plataformas valen si cumplen el mismo contrato (spec `production-deployment`); no
  son referencias del repositorio.
- **`/api/*` va del borde directo a la API**, y el resto a la interfaz. El reenvío de Next.js queda
  para el desarrollo y como respaldo interno.
- **Red privada sin salida a Internet:** la interfaz, la API y PostgreSQL solo están en una red
  interna; nginx está además en la red pública. Dar salida a la API para el uso real del SRI es un
  override explícito (`deploy/compose.sri-egress.yaml`), separado de habilitar la transmisión.
- **`TRUST_PROXY` es la IP fija de nginx en la red interna**, de la misma variable de Compose que su
  `ipv4_address`: nunca un número de saltos, toda la subred ni `true`.
- **Imágenes por versión exacta y sin digest:** `node:24.21.0-bookworm-slim` para la API (`runtime`
  y `migrate`) y para la interfaz (`next start`, no `standalone`), `nginx:1.30.5-alpine` y
  `postgres:17-alpine`. Los procesos de la aplicación corren sin root, sin capacidades y, donde se
  midió, con la raíz de solo lectura.
- **Las migraciones son un paso explícito de un solo uso:** la API arranca solo si terminan con
  éxito, y nunca migra al arrancar.
- **Volúmenes con nombre:** el de PostgreSQL, que se respalda, y el del directorio de exportación,
  que persiste entre reinicios y no se respalda: sus paquetes caducan y se regeneran. La imagen
  aprovisiona ese directorio; la API nunca lo crea.
- **La recuperación es un volcado lógico** (`pg_dump -Fc` de PostgreSQL 17 y su SHA-256), restaurado
  solo en una base vacía, salvo con una opción destructiva explícita. El cifrado, la retención y el
  almacenamiento fuera del host son del operador, y la clave maestra se guarda aparte: el volcado
  solo no recupera la custodia de la firma.

## Consequences

- El operador despliega, actualiza, respalda y restaura con un procedimiento documentado, y la CI
  lo comprueba en cada cambio con el workflow `deployment`, con TLS efímero, secretos sintéticos y
  sin tráfico al SRI.
- La subred fija puede chocar con una red del host; entonces el operador cambia la subred y la IP
  del proxy, y `TRUST_PROXY` cambia con ellas.
- Varias instancias de la API, alta disponibilidad, un registro de imágenes y la fijación por
  digest quedan fuera.
- La revisión final del go-live pide la evidencia del operador: el reloj del host, el certificado y
  su renovación, el cifrado y la retención de los respaldos.
