# Tasks

## 1. Imágenes de producción y contexto de build

- [x] 1.1 Crear el `.dockerignore` de la raíz con lista de permitidos (design D10): admite solo los
  manifiestos de la raíz, `backend/`, `frontend/`, `packages/contracts/` y las fuentes de los XSD
  bajo `docs/product/` que copia `copy-xsd`, y excluye en cualquier nivel `node_modules`, `.next`,
  `dist`, `coverage`, logs, exportaciones temporales, `.env` y `.env.*`, PKCS#12, PFX, claves
  privadas, `archivosensible.env`, las pruebas y las salidas locales.

  Verificar con un script de prueba de contexto (`scripts/deployment/`) que construye un árbol
  temporal con el `.dockerignore` del repositorio, archivos permitidos y archivos prohibidos
  sintéticos, y comprueba con un Dockerfile de sonda (`FROM scratch` y `COPY . /`) que ningún
  prohibido llega al contexto y que todos los permitidos sí. El script nunca lee un archivo privado
  real.
- [x] 1.2 Crear `deploy/backend.Dockerfile` (design D2) sobre `node:24.21.0-bookworm-slim`, sin
  digest, con Corepack, pnpm 12.4.2 y `--frozen-lockfile`. Etapas de build de `contracts` y del
  backend (`tsc`, `copy-xsd`, `copy-ride-assets`), dependencias de producción sin scripts de
  instalación, objetivo `migrate` (CLI de Prisma, esquema, migraciones y `schema-engine` de
  Debian/OpenSSL 3, ejecuta `db:migrate:deploy` como `node` con `CHECKPOINT_DISABLE=1`) y objetivo
  `runtime`:
  - `dist`, las dependencias de producción y `package.json`;
  - `/var/lib/facturador/exports` de `node` con modo `0700`;
  - `USER node` y `node dist/main.js`;
  - sin `NODE_ENV` fijado;
  - sin npm ni Corepack si nada los necesita en ejecución.

  Verificar:
  - las dos imágenes se construyen;
  - el runtime corre como un UID distinto de 0;
  - sin `NODE_ENV`, el runtime termina con `NODE_ENV: es obligatoria`;
  - la imagen no trae código fuente, pruebas ni dependencias de desarrollo;
  - una búsqueda no encuentra archivos de entorno, PKCS#12, PFX ni claves privadas bajo el
    directorio de la aplicación.
- [x] 1.3 Crear `deploy/frontend.Dockerfile` (design D3) sobre la misma base, con `API_INTERNAL_URL`
  como argumento obligatorio sin valor por defecto y `NEXT_TELEMETRY_DISABLED=1`. Runtime: `.next`
  sin su caché de build, las dependencias de producción, `package.json`, `next.config.ts` y
  `src/lib/api-internal-url.ts` (más `tsconfig.json` o `public/` solo si `next start` los necesita);
  `USER node`; `next start --port 3000`; nunca la salida `standalone`.

  Verificar:
  - la imagen se construye con el argumento, y sin él el build falla con `API_INTERNAL_URL`;
  - el runtime corre como un UID distinto de 0;
  - sin `API_INTERNAL_URL` en ejecución, `next start` termina con código 1;
  - la imagen solo trae los archivos de ejecución y nada del resto del repositorio.
- [x] 1.4 Actualizar `docs/architecture/stack.md` con las versiones de las imágenes
  (`node:24.21.0-bookworm-slim`, `nginx:1.30.5-alpine` y `postgres:17-alpine`) y documentar en
  `docs/architecture/deployment.md` las imágenes, sus objetivos y el contexto de build.

  Verificar que `corepack pnpm format:check` pasa.

## 2. Topología de referencia y borde nginx

- [x] 2.1 Crear `deploy/compose.yaml` (design D4, D6, D7 y D8):
  - servicios `postgres` (`postgres:17-alpine`, `POSTGRES_PASSWORD_FILE`), `migrate`, `backend`,
    `frontend` y `proxy` (`nginx:1.30.5-alpine`);
  - red `edge` solo para `proxy`, con los puertos 443 y 80 como variables;
  - red `app` interna, con subred e `ip_range` fijos y el proxy en su dirección fija;
  - `TRUST_PROXY` tomado de la misma variable que esa dirección;
  - `PUBLIC_ORIGIN` como fuente de `BETTER_AUTH_URL` y de la redirección;
  - `API_INTERNAL_URL` como argumento de build y entorno de ejecución del frontend;
  - volúmenes con nombre `postgres-data` y `exports`;
  - `NODE_ENV=production` y `SRI_TRANSMISSION_ENABLED=0` explícitos;
  - archivos de secretos de solo lectura y un archivo de entorno del operador fuera del
    repositorio;
  - healthchecks (`pg_isready`, `/health/live` y `GET /iniciar-sesion`) y orden por
    `service_healthy` y `service_completed_successfully`;
  - `stop_grace_period: 30s`, `cap_drop: [ALL]` y `no-new-privileges` en los servicios de la
    aplicación.

  Verificar con `docker compose config` que el backend, el frontend y PostgreSQL no publican
  puertos, que `app` es interna y que ningún servicio de la aplicación está en `edge`.
- [x] 2.2 Crear la plantilla de nginx en `deploy/nginx/templates/` (design D5):
  - HTTP solo redirige a `${PUBLIC_ORIGIN}$request_uri`, sin HSTS;
  - HTTPS con TLS 1.2 y 1.3, `server_tokens off` y HSTS `max-age=31536000` con `always`, sin
    `includeSubDomains` ni `preload`, sin `add_header` en los `location`;
  - `/api/` al backend con 8 MiB y `${NGINX_PROXY_READ_TIMEOUT}` (60 s por defecto);
  - la ruta de descarga de portabilidad con `${NGINX_DOWNLOAD_READ_TIMEOUT}` (180 s por defecto),
    `proxy_buffering off` y `proxy_max_temp_file_size 0`;
  - `/health/` y `/metrics` rechazados con `404`;
  - `/` al frontend con 1 MiB;
  - `Host`, `X-Forwarded-For` sobrescrita con `$remote_addr`, `X-Forwarded-Proto https`, y
    `Forwarded` y `X-Forwarded-Host` vacías;
  - log de acceso mínimo a stdout, sin IP, consulta, cabeceras, cookies ni cuerpos.

  Verificar con `nginx -t` y `nginx -T` sobre la configuración renderizada que las directivas de
  producción son esas.
- [x] 2.3 Crear `deploy/production.env.example`, solo con marcadores (sin secretos válidos, dominio
  real, identidad fiscal ni rutas privadas), con todas las variables de la prioridad 4 y
  `SRI_TRANSMISSION_ENABLED=0`. Crear `deploy/compose.sri-egress.yaml` (design D9), que solo añade
  al backend una red con salida.

  Verificar:
  - el escaneo de secretos del repositorio no informa nada en la plantilla;
  - `docker compose config` con el override solo cambia la red del backend;
  - nada en las pruebas ni en la CI levanta el override.
- [x] 2.4 Documentar en `docs/architecture/deployment.md`:
  - la topología, las redes, la subred fija y cómo cambiarla junto con `TRUST_PROXY`;
  - el enrutamiento del borde, TLS (certificado válido y renovación a elección del operador) y HSTS
    (solo con HTTPS ya funcionando);
  - las cabeceras reenviadas, el techo de cuerpo, la espera de la descarga, la salud y las métricas;
  - el log del borde, la salida bloqueada y el override para el uso real del SRI;
  - los volúmenes y su aprovisionamiento, con la alternativa de un directorio del host;
  - los secretos y el orden de arranque.

  Crear `docs/architecture/adr/0027-topologia-de-despliegue-de-referencia.md` (design D14).
  Verificar que `corepack pnpm format:check` pasa.

## 3. Ensayo de la topología y del borde

- [ ] 3.1 Crear el script de ensayo de la topología en `scripts/deployment/` (design D12). Genera en
  un directorio temporal fuera del repositorio secretos sintéticos y un certificado TLS efímero con
  `node-forge`, levanta un proyecto de Compose propio con puertos altos, espera `/health/ready` por
  la red privada, nunca imprime un secreto y siempre limpia sus contenedores, volúmenes y temporales.

  Verificar con el script:
  - solo el borde publica puertos, y los servicios internos no son alcanzables desde el host;
  - HTTP redirige al origen HTTPS canónico sin HSTS;
  - HSTS exacto en una página, en `/api`, en un `413` y en un rechazo de salud;
  - `/api/v1` y `/api/auth` los atiende la API, y las páginas la interfaz;
  - `/health/live`, `/health/ready` y `/metrics` públicos se rechazan, y por la red privada
    responden;
  - el inicio de sesión del administrador sintético da cookies `Secure`;
  - los procesos de la interfaz y de la API no corren como root.
- [ ] 3.2 Añadir al ensayo la IP del cliente y la salida (design D12):
  - un cliente de prueba con dirección fija en `edge` provoca un inicio de sesión fallido, y el
    campo `ip` de ese evento en el log del backend es la dirección del cliente, con y sin un
    `X-Forwarded-For` falsificado;
  - la misma llamada desde el frontend, directa al backend con la cabecera, se atribuye a la
    dirección del frontend;
  - un contenedor trampa solo en `edge` no recibe ninguna conexión del backend ni del frontend.

  El script solo muestra los campos comparados.
- [ ] 3.3 Añadir al ensayo los cuerpos y la espera (design D12):
  - 4 MiB sintéticos a la ruta de borradores de liquidación, sin sesión y con el `Origin` canónico,
    reciben el sobre de la API;
  - más de 8 MiB en `/api/` y más de 1 MiB fuera reciben `413` del borde;
  - la configuración de producción renderizada tiene 180 s sin almacenamiento solo en la descarga, y
    60 s en el resto;
  - con la misma plantilla, las esperas escaladas y un servidor de prueba de primer byte tardío, la
    descarga se entrega completa y otra ruta recibe un error de puerta de enlace.

  Sin cambiar ningún límite de la aplicación.
- [ ] 3.4 Añadir al ensayo el arranque, el apagado y la persistencia (design D7 y D12):
  - con una `DATABASE_URL` inválida solo para `migrate`, el backend no arranca;
  - `docker compose stop` del backend termina con código 0 antes de 30 s y con sus mensajes de
    cierre;
  - datos sintéticos no fiscales (el aprovisionamiento, un operador, el logo sintético y una
    exportación de portabilidad lista), y tras recrear los contenedores sin borrar volúmenes, los
    mismos datos y el mismo SHA-256 del paquete descargado de nuevo;
  - medir la raíz de solo lectura del backend y del frontend con `tmpfs` y registrar el resultado
    (design D7).
- [ ] 3.5 Documentar en `docs/quality/testing.md` el ensayo de la topología: cómo se ejecuta en local,
  qué necesita (Docker y puertos libres), qué comprueba y que nunca contacta el SRI ni otro servicio
  externo. Verificar que `corepack pnpm format:check` pasa.

## 4. Respaldo, restauración y ensayo de la recuperación

- [ ] 4.1 Crear `deploy/backup.sh` y `deploy/restore.sh` (design D11):
  - el respaldo usa `pg_dump -Fc` de la imagen de PostgreSQL 17, con modo `0600` y su SHA-256;
  - la restauración comprueba la suma, se niega con un destino que no está vacío salvo con
    `--replace-existing` (documentada como destructiva), y ejecuta
    `pg_restore --exit-on-error --no-owner`;
  - los dos solo imprimen rutas, tamaños, sumas y códigos de salida.
- [ ] 4.2 Crear el script de ensayo de la recuperación en `scripts/deployment/` (design D12):
  1. siembra solo datos sintéticos no fiscales, con un certificado sintético del generador del
     repositorio en la custodia y una exportación lista;
  2. registra las huellas: migraciones, recuentos de cada tabla, resumen de las filas sembradas y
     SHA-256 del logo y del contenido cifrado, comparados sin imprimirlos;
  3. respalda y restaura en un proyecto independiente con un PostgreSQL 17 nuevo;
  4. aplica las migraciones y arranca la aplicación sobre la base restaurada.

  Verificar:
  - las huellas coinciden y la aplicación queda lista;
  - con la misma clave sintética, la validez del certificado indica la clave disponible;
  - con otra clave sintética, la aplicación queda lista y el certificado aparece no disponible;
  - la exportación sin su archivo da `DATA_EXPORT_PACKAGE_MISSING` con su evento de auditoría;
  - se registran las duraciones como evidencia;
  - ninguna emisión fiscal y ninguna conexión externa.
- [ ] 4.3 Añadir al ensayo las negativas (design D12):
  - un volcado alterado no pasa la suma y no toca el destino;
  - un volcado truncado con su suma recalculada hace fallar `pg_restore` y el script lo informa;
  - una segunda restauración sobre la base ya restaurada, sin la opción destructiva, se niega y las
    huellas no cambian.
- [ ] 4.4 Documentar en `docs/architecture/deployment.md`:
  - el respaldo y la restauración, con sus comandos;
  - que el volcado contiene datos fiscales y del negocio;
  - el cifrado, la retención y la custodia fuera del servidor, a cargo del operador, con su clave
    fuera del respaldo;
  - que el volcado solo no basta para la custodia de la firma y que la clave maestra y su versión se
    guardan aparte;
  - que las exportaciones no se respaldan;
  - la ausencia de un RTO y un RPO aprobados;
  - la versión mayor de las herramientas.

  Ampliar `docs/quality/testing.md` con el ensayo de la recuperación. Verificar que
  `corepack pnpm format:check` pasa.

## 5. Workflow `deployment`

- [ ] 5.1 Crear `.github/workflows/deployment.yml` (design D13):
  - `push`, `pull_request` y `workflow_dispatch`;
  - `permissions: contents: read` y ningún secreto del repositorio;
  - jobs paralelos `topology` y `recovery` con `timeout-minutes` acotados;
  - `actions/checkout` y `actions/setup-node` con los mismos SHA que `verify.yml`;
  - `corepack pnpm install --frozen-lockfile`;
  - la CLI de Docker y Compose del runner;
  - sin acciones de registro, inicio de sesión ni publicación, y sin artefactos.

  Verificar:
  - toda acción está fijada por el SHA de un commit, comprobado en el archivo;
  - el escaneo de secretos no informa nada;
  - `verify.yml` y `security.yml` no cambian.
- [ ] 5.2 Documentar el workflow en `docs/quality/testing.md`, junto al de seguridad. Verificar que
  `corepack pnpm format:check` pasa.

## 6. README y evidencia del reloj

- [ ] 6.1 Actualizar `README.md` con la instalación de producción, el arranque y la preparación, la
  actualización (construir, migrar y recrear), y el respaldo y la restauración, enlazando a
  `docs/architecture/deployment.md`. Sin `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md` ni `CHANGELOG`.
- [ ] 6.2 Documentar en `docs/architecture/deployment.md` la evidencia del reloj del host para el
  go-live (`chronyc tracking`, `timedatectl` u otro equivalente de la plataforma, sin NTP en los
  contenedores, sin umbral, sin endpoint de reloj en la aplicación).

  Verificar que `corepack pnpm format:check` pasa.

## 7. Cierre del go-live y verificación

- [ ] 7.1 Con la evidencia de los grupos 3 y 4 en la mano, actualizar
  `docs/quality/definition-of-done.md` y `docs/quality/technical-debt.md`. Se cierran solo las
  entradas existentes:
  - HSTS en el borde TLS;
  - el techo de cuerpo del proxy;
  - la espera de la descarga de portabilidad;
  - «Un respaldo completo se restaura con éxito», como capacidad demostrada;
  - el aprovisionamiento real de la configuración de producción;
  - el procedimiento de evidencia del reloj.

  Quedan para la revisión final del go-live la evidencia del operador: reloj real, certificado y su
  renovación, cifrado y retención de los respaldos, y la medición de la descarga en su
  almacenamiento. Verificar que ningún documento afirma un cierre sin su evidencia.
- [ ] 7.2 Ejecutar en local los dos ensayos (topología y recuperación), la prueba del
  `.dockerignore`, `corepack pnpm openspec:validate`, `corepack pnpm security:dependencies`,
  `corepack pnpm security:secrets` y el `corepack pnpm verify` completo, con cero tráfico al SRI.
  Si una prueba inestable ya registrada falla, informar el código de salida real con la evidencia
  aislada o de control, sin marcar la tarea como completa.
- [ ] 7.3 Publicar la rama del cambio (no `main`) y registrar la evidencia de su CI: `verify`,
  `security` y `deployment` en verde, con la validación estricta de OpenSpec dentro de `verify`.
