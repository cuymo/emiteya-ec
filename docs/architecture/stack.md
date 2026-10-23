# Stack Baseline

This is the default technology stack for new applications using this context.

## Package Manager

- Use pnpm through Corepack.
- Do not use npm or yarn for installs, scripts, audits, or lockfile updates.
- Keep the package manager version declared in `packageManager` when a code repo exists.

Recommended commands:

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
corepack pnpm verify
```

## Backend

- Node.js.
- TypeScript.
- Express.js for REST APIs.
- Zod for request, response, and environment validation.
- Better Auth for authentication.
- Prisma for database access.
- PostgreSQL as the primary database.
- Axios for external HTTP APIs; excepción: el adaptador SOAP del SRI usa el `fetch` nativo de Node, solo en infraestructura (ADR 0018, enmienda del transporte).
- nodemailer para el correo SMTP, que no es HTTP, solo en la infraestructura del módulo `email` (ADR 0029).

## Frontend

- Next.js with TypeScript.
- React.
- Tailwind CSS.
- shadcn/ui for reusable UI components.
- lucide-react for icons.
- React Hook Form for forms.
- Zod for form schemas.
- shadcn charts or a chart library integrated through shadcn conventions for dashboards.
- Auto-animate or equivalent small motion helpers only when motion improves clarity.

## Persistence

- PostgreSQL is the production database.
- Prisma migrations are the schema source of truth.
- SQLite can be used only for disposable local experiments if explicitly documented.

## Authentication

- Better Auth owns sign-in, sign-out, sessions, cookies, password hashing, and auth tables.
- Do not implement custom password hashing or session tables unless an ADR replaces Better Auth.

## Deployment

- Docker is the default packaging target.
- The database can be remote in production.
- Containers must not destroy database data on redeploy.
- Health checks should exist for API containers.
- Frontend and API can share one public domain when routed by path, for example `/` and `/api`.

## Versiones fijadas en este proyecto

- Prisma permanece en la major 7 durante esta fase: Better Auth 1.7.7 no admite Prisma 8, y la etiqueta `latest` de Prisma apunta a una release candidate de la 8. `prisma`, `@prisma/client`, `@prisma/adapter-pg` y `@prisma/engines` se fijan en versión exacta (`7.10.0`), con el generador `prisma-client`, y con overrides del workspace, para que ninguna dependencia transitiva traiga otra.
- Better Auth se fija en la versión exacta validada por el spike S-1; su política de actualización está en `authentication.md`.
- Los binarios de Prisma y de Better Auth se ejecutan siempre desde las dependencias del repositorio (`corepack pnpm exec prisma …`, `corepack pnpm exec auth …`, o los scripts de `package.json`). Nunca con `npx prisma` ni `pnpm dlx` sin versión, que descargarían la última publicada.
- Las dependencias se añaden con versión exacta, y el lockfile se versiona.

Versiones de la base técnica (`bootstrap-application`); `check:versions` impide rangos y Prisma fuera de la major 7:

| Herramienta | Versión | Nota |
| --- | --- | --- |
| Node.js | 24 LTS (`.node-version`: 24.21.0; `engines`: `>=24.21.0 <25`) | Type stripping nativo en desarrollo (ADR 0016). `facturacion-electronica-ec` exige al menos 24.18.0. |
| Motor SRI | `facturacion-electronica-ec` 1.0.1 y `ec-sri-invoice-signer` 1.8.2, versiones exactas | Builders XML, clave de acceso, XSD, XAdES-BES y SOAP detrás de puertos propios, importados solo desde `modules/sri-engine/infrastructure` (ADR 0018). |
| Inspección de PKCS#12 | `node-forge` 1.4.0, versión exacta | Lee el certificado y la clave al cargar la firma, con los mismos formatos que el firmador (ADR 0019). |
| Validación XSD | `xmllint-wasm` 5.3.0, versión exacta | libxml2 en WebAssembly, sin Java ni red, detrás del puerto `XsdValidator` del motor SRI, contra los XSD versionados del producto y sus hashes (ADR 0021). |
| Parser XML de las respuestas del SRI | `fast-xml-parser` 5.11.2, versión exacta | La misma versión que ya usaba `facturacion-electronica-ec`. Rechaza DTD y solo se importa desde `modules/sri-engine/infrastructure` (design D11 de `add-sri-transmission`). |
| RIDE en PDF | `pdfmake` 0.3.11 (sobre `pdfkit` 0.19.1), `bwip-js` 4.11.4 y `fontkit` 2.0.4, versiones exactas (MIT) | PDF en el servidor sin navegador, Code128 vectorial y comprobación de glifos con Noto Sans 2.015 (OFL 1.1) embebida (ADR 0022, spike S-4). Solo se importan desde `modules/sri-engine/infrastructure/ride/`, que carga el worker del RIDE; sin `@types/pdfmake`, que mete los tipos del navegador, sino declaraciones locales mínimas. |
| Pruebas del RIDE | `pdfjs-dist` 6.3.289, `@napi-rs/canvas` 1.0.10 y `zxing-wasm` 3.1.4, solo de desarrollo | Extraer el texto del PDF, rasterizarlo y decodificar el Code128 en CI (ADR 0022). `pdfjs-dist` 6.4 no cumplía todavía la antigüedad mínima de publicación. |
| XLSX de los reportes | Escritor OOXML propio sobre `node:zlib`, sin dependencias | Solo el subconjunto de los reportes, con un contenedor ZIP mínimo sin ZIP64: `createDeflateRaw` por streaming fuera del hilo principal y `zlib.crc32` (ADR 0023). exceljs 4.4.0 se descartó por su memoria no acotada y porque altera textos. |
| Pruebas del XLSX | `fflate` 0.8.3, solo de desarrollo (MIT, sin dependencias) | Descomprime el libro con una implementación independiente del escritor; el XML lo lee `fast-xml-parser`, ya presente (ADR 0023). |
| Paquete de portabilidad | Contenedor ZIP64 propio sobre `node:zlib`, sin dependencias | Tamaño y CRC antes de cada cabecera, sin descriptor de datos; STORE o DEFLATE por entrada; directorio central volcado a un temporal, con memoria acotada (ADR 0024). yazl, zip-stream y @zip.js/zip.js se descartaron por su memoria por entrada (de 7 a 8.7 KiB) y porque Info-ZIP rechaza los archivos de más de 4 GiB de las dos últimas; fflate no escribe ZIP64. Las pruebas leen el paquete con `zipfile` de Python. |
| Aritmética decimal | `decimal.js` 10.6.0, versión exacta | Importes y tarifas exactos detrás de `platform/decimal`; es la biblioteca que Prisma usa para `Decimal`. Ningún importe pasa por `number` (`decimal-policy.md`). |
| Correo SMTP | `nodemailer` 10.2.1, versión exacta (MIT-0, sin dependencias, con sus tipos) | Entrega por correo del XML y el RIDE con el servidor SMTP de cada empresa, detrás del puerto `MailTransport` del módulo `email`: un transporte por envío, TLS con certificado verificado y TLS 1.2 o superior (ADR 0029). |
| Pruebas del correo | `smtp-server` 3.21.1, solo de desarrollo (MIT-0) | Servidor SMTP falso en proceso para las pruebas de integración del transporte y del envío (ADR 0029). El buzón de pruebas del despliegue de revisión es Mailpit, fuera del código. |
| pnpm | 12.4.2 vía Corepack | `packageManager`; configuración en `pnpm-workspace.yaml`. |
| TypeScript | 6.0.3 | `typescript-eslint` no admite todavía la 7. |
| ESLint / typescript-eslint | 10.11.0 / 8.71.0 | Frontend sin `eslint-config-next` (ADR 0016). |
| Prettier | 3.9.9 | |
| Vitest | 5.0.3 | |
| playwright-core | 1.64.0, versión exacta, solo desarrollo | Comprobación del build en un navegador real (`check:web-security-policy`, ADR 0025). Lanza el Chrome del sistema y no descarga navegadores. Apache-2.0, sin dependencias transitivas. |
| Gitleaks | 8.30.1, binario oficial `gitleaks_8.30.1_linux_x64.tar.gz`, SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`; solo CI y desarrollo, fuera de npm (MIT) | Escaneo de secretos (`security:secrets`, ADR 0026). Fijado en `security/gitleaks.json`, con la fuente `https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1`; la CI lo instala con `scripts/security/install-gitleaks.sh`, que comprueba la suma antes de extraerlo o ejecutarlo. En local se exige exactamente esta versión. Actualizarlo es un cambio revisado. |
| Acciones de GitHub | `actions/checkout` v5.1.0 (`fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`) y `actions/setup-node` v5.0.0 (`a0853c24544627f65ddf259abe73b1d18a591444`), fijadas por commit | En `verify.yml`, `security.yml` y `deployment.yml`, con la versión en un comentario (ADR 0026). Al fijarlas, las etiquetas `v5` apuntaban a esos mismos commits. Actualizarlas es un mantenimiento revisado; las imágenes de contenedor van por etiqueta exacta, sin digest (ADR 0027). |
| CLI de OpenSpec | `@fission-ai/openspec` 1.14.0, versión exacta, solo desarrollo (MIT) | Valida las specs y los cambios con `corepack pnpm openspec:validate`, dentro de `verify` (`pin-openspec-ci-validation`). Sin scripts de instalación; la cubre `security:dependencies`. Actualizarla es un cambio revisado que regenera también los archivos de agentes con `openspec update`. |
| Express | 5.2.1 | Validada por S-1. |
| Zod | 4.6.5 | Misma major que Better Auth. |
| Prisma / @prisma/client / @prisma/adapter-pg | 7.10.0 | Generador `prisma-client`. |
| PostgreSQL | 17 (`postgres:17-alpine`, por etiqueta y sin digest) | Compose de desarrollo, CI y topología de producción de referencia; el respaldo y la restauración usan las herramientas de esa misma imagen (ADR 0027). |
| Imagen base de Node | `node:24.21.0-bookworm-slim`, versión exacta y sin digest | Imágenes de producción del backend y del frontend (`deploy/`, ADR 0027). Debian con OpenSSL 3, que necesita el `schema-engine` de las migraciones. |
| nginx | `nginx:1.30.5-alpine`, línea estable, sin digest | Borde TLS de la topología de producción de referencia (ADR 0027). |
| pino / pino-http | 10.3.1 / 11.0.0 | |
| @prometheus-io/client | 0.16.1 | Sucesor oficial de `prom-client`. |
| helmet | 8.3.0 | |
| Next.js / React | 16.3.8 / 19.3.0 | |
| Tailwind CSS | 4.3.3 | |
| better-auth / @better-auth/core / CLI `auth` | 1.7.7 | Versión validada por S-1; se actualiza solo con los tests de contrato (`authentication.md`). |
| radix-ui | 1.6.7 | Primitivas accesibles de shadcn/ui (diálogo, menú, tooltip, grupo de radio, chips). |
| react-hook-form / @hookform/resolvers | 7.89.0 / 5.9.1 | Formularios con los esquemas Zod del contrato. |
| @tanstack/react-table | 8.21.3 | Tabla compartida. La 9, estable desde agosto de 2026, cambia la API; se adopta en su propio cambio. |
| @tanstack/react-query | 5.104.0 | Estado de servidor: cancelación de consultas obsoletas, invalidación tras mutaciones y deduplicación, que `frontend.md` exige y que no conviene reimplementar. |
| sonner | 2.0.8 | El sistema de avisos de shadcn/ui; un único toaster semántico. |
| recharts | 3.10.1 | La base de los charts de shadcn/ui (`components/ui/chart.tsx`), en el tablero de Inicio. MIT. Aplica sus estilos por CSSOM, no con atributos `style`, así que respeta `style-src-attr 'none'`; los gráficos solo se dibujan en el cliente, con los datos ya cargados. |
| class-variance-authority | 0.7.1 | Variantes de los primitivos derivados de la plantilla «Studio Admin» (ADR 0028), que la usan en su código fuente. Apache-2.0, solo depende de `clsx`. |
| cmdk | 1.1.1 | Lista con búsqueda de la paleta de comandos del shell. MIT; usa los paquetes de Radix que ya resuelve `radix-ui`, sin duplicarlos. |
| tw-animate-css | 1.4.0 | Animaciones de entrada y salida de los primitivos derivados, solo CSS y sin JavaScript; con `prefers-reduced-motion` se anulan. MIT. |
| geist | 1.7.2 | Geist Sans variable, una sola familia, servida desde el propio origen con `next/font/local`: el woff2 viene en el paquete, sin red en el build ni en ejecución. OFL-1.1 (aviso en `frontend/THIRD_PARTY_NOTICES.md`). |
| @playwright/test | 1.64.0, versión exacta, solo desarrollo | Harness de regresión visual local (`test:visual`), con el Chrome del sistema y sin descargar navegadores; la misma versión que `playwright-core`. Apache-2.0. Fuera de `verify`. |
| @axe-core/playwright | 4.13.0, versión exacta, solo desarrollo | Prueba de accesibilidad WCAG 2.2 AA del shell dentro del harness visual. MPL-2.0, con `axe-core` 4.13.0. |

## Documentation

When a project deviates from this stack, create an ADR in `docs/architecture/adr/`.

