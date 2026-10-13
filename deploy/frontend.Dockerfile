# syntax=docker/dockerfile:1
# Imagen de producción del frontend (harden-deployment-proxy-and-recovery, design D3). El contexto es la
# raíz del repositorio, acotada por .dockerignore. Ejecuta `next start`, no la salida `standalone`: así
# Next.js vuelve a evaluar next.config.ts al arrancar y exige API_INTERNAL_URL (prioridad 4).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

FROM ${NODE_IMAGE} AS toolchain
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.4.2 --activate
WORKDIR /repo

FROM toolchain AS build
# Obligatorio y sin valor por defecto: sin él, `next build` falla con API_INTERNAL_URL.
ARG API_INTERNAL_URL
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/package.json backend/
COPY packages/contracts/ packages/contracts/
COPY frontend/ frontend/
RUN --mount=type=cache,id=emiteya-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --ignore-scripts \
      --filter "@facturador/frontend..."
RUN pnpm --filter @facturador/contracts build \
 && API_INTERNAL_URL="${API_INTERNAL_URL}" pnpm --filter @facturador/frontend build \
 && rm -rf frontend/.next/cache

FROM build AS production-deps
RUN --mount=type=cache,id=emiteya-pnpm-store,target=/pnpm-store \
    pnpm --filter @facturador/frontend deploy --prod --ignore-scripts --store-dir /pnpm-store /deploy

FROM ${NODE_IMAGE} AS runtime
ENV NEXT_TELEMETRY_DISABLED=1
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
COPY --from=production-deps /deploy/package.json ./package.json
COPY --from=production-deps /deploy/node_modules ./node_modules
COPY --from=build /repo/frontend/.next ./.next
COPY --from=build /repo/frontend/next.config.ts ./next.config.ts
COPY --from=build /repo/frontend/src/lib/api-internal-url.ts ./src/lib/api-internal-url.ts
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000"]
