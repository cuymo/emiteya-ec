# syntax=docker/dockerfile:1
# Imágenes de producción del backend (harden-deployment-proxy-and-recovery, design D2). El contexto es
# la raíz del repositorio, acotada por .dockerignore. Objetivos:
#   migrate  aplica las migraciones con `db:migrate:deploy` y termina (un solo uso);
#   runtime  la API: `node dist/main.js`, sin root, sin herramientas de build ni NODE_ENV fijado.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

FROM ${NODE_IMAGE} AS toolchain
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
# OpenSSL 3: Prisma elige con él su schema-engine de Debian, que usan las migraciones.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable \
 && corepack prepare pnpm@12.4.2 --activate \
 && chmod -R a+rX /opt/corepack
WORKDIR /repo

FROM toolchain AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY frontend/package.json frontend/
COPY packages/contracts/ packages/contracts/
COPY backend/ backend/
COPY docs/product/sri-xsd/ docs/product/sri-xsd/
COPY docs/product/w3c-xsd/ docs/product/w3c-xsd/
# El `postinstall` del backend genera el cliente de Prisma, que el build compila a dist/.
RUN --mount=type=cache,id=emiteya-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@facturador/backend..."
RUN pnpm --filter @facturador/contracts build \
 && pnpm --filter @facturador/backend build

# Solo las dependencias de producción, con los contratos ya compilados y sin scripts de instalación:
# el `postinstall` llamaría a la CLI de Prisma, que es de desarrollo.
FROM build AS production-deps
RUN --mount=type=cache,id=emiteya-pnpm-store,target=/pnpm-store \
    pnpm --filter @facturador/backend deploy --prod --ignore-scripts --store-dir /pnpm-store /deploy

FROM build AS migrate
# Sin red ni reinstalación al ejecutar: pnpm 12 comprobaría y reinstalaría las dependencias antes de
# `pnpm run`, y la imagen ya las trae.
ENV CHECKPOINT_DISABLE=1 \
    COREPACK_ENABLE_NETWORK=0 \
    pnpm_config_verify_deps_before_run=false
WORKDIR /repo/backend
USER node
CMD ["pnpm", "run", "db:migrate:deploy"]

FROM ${NODE_IMAGE} AS runtime
# Sin gestores de paquetes en ejecución. El directorio de exportación nace del usuario de la API con
# modo 0700: Docker inicializa así un volumen con nombre nuevo, y la API nunca lo crea.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && install -d -o node -g node -m 0700 /var/lib/facturador/exports
WORKDIR /app
COPY --from=production-deps /deploy/package.json ./package.json
COPY --from=production-deps /deploy/node_modules ./node_modules
COPY --from=build /repo/backend/dist ./dist
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
