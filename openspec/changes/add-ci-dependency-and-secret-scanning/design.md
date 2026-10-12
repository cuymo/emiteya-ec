# Design

## Context

La motivación está en `proposal.md`. Este es el estado observado durante la readiness
(2026-10-12):

- **CI actual.** `.github/workflows/verify.yml` tiene un solo job, `verify`:
  - en push y pull request, sobre `ubuntu-24.04`;
  - con `permissions: contents: read`, `timeout-minutes: 45` y sin secretos del repositorio;
  - sin caché ni artefactos;
  - con `actions/checkout@v5` y `actions/setup-node@v5` en sus valores por defecto (historial de
    profundidad 1 y credenciales persistidas).

  Las corridas verdes de `main` tardan de 37 min 28 s a 40 min 41 s. El paso `corepack pnpm verify`
  ocupa casi todo.
- **Funciones de GitHub.** El repositorio es privado y de una organización. Las alertas de
  Dependabot, el grafo de dependencias, el escaneo de secretos y el de código (y con él SARIF)
  están desactivados o no disponibles.
- **Dependencias.**
  - Un workspace pnpm 12.4.2 con cuatro manifiestos y versiones exactas (`check:versions`).
  - `pnpm-lock.yaml` tiene dos documentos YAML: primero el de pnpm, con la versión del gestor; después
    el grafo del proyecto, con 818 entradas.
  - `pnpm audit --json` consulta `/-/npm/v1/security/advisories/bulk` del registro, con los avisos
    por GHSA, y ve las 833 dependencias.
  - Funciona sin `node_modules`, solo con los manifiestos y el lockfile, en unos 0,7 s.
  - Con el registro inalcanzable, sale con código 1 tras unos 70 s de reintentos, sin JSON y con
    `ERR_PNPM_AUDIT_BAD_RESPONSE` en stderr. Es el mismo código que «hay vulnerabilidades».
  - Ignora avisos por GHSA en `pnpm-workspace.yaml`, sin responsable, motivo ni vencimiento.
- **Hallazgos actuales:**

  | Aviso | Severidad | Paquete | Origen | Corrección publicada |
  | --- | --- | --- | --- | --- |
  | GHSA-3f6p-5ww8-9rcr | HIGH | `mysql2` | `backend>@prisma/client>prisma>mysql2` | `>=3.22.0` |
  | GHSA-rgwj-5xj2-c3m3 | MODERATE | `mysql2` | Igual | `>=3.23.1` |
  | GHSA-ggr8-5vv4-36mx | HIGH | `deepmerge-ts` | `…>prisma>@prisma/config>deepmerge-ts` | `>=8.0.0` (major) |
  | GHSA-86w9-cpqp-85rv | HIGH | `node-forge` | Directa de `backend` (producción) | Ninguna |
  | GHSA-vfj7-8cjw-p6xm | HIGH | `braces` | `frontend>@next/eslint-plugin-next>…>braces` (desarrollo) | Ninguna |

  El código usa `node-forge` en `modules/signing/infrastructure/pkcs12/` solo para leer el PKCS#12,
  el ASN.1 y los campos del certificado. No hay ninguna llamada de verificación de firmas RSA, que
  es la operación del aviso.
- **Secretos.**
  - Nunca se versionó un `.p12`, `.pfx`, `.pem`, `.key` ni `archivosensible.env` (548 commits, 8 MiB).
  - El `.gitignore` versionado cubre `.env` y `.env.*` salvo `.env.example`. Los demás patrones viven
    solo en `.git/info/exclude`.
  - En el directorio de trabajo hay un `archivosensible.env` real y un `.env`, sin versionar.
  - Las firmas sintéticas de las pruebas se generan en directorios temporales.
- **Posibles falsos positivos** (archivos versionados, sin el lockfile):
  - asignaciones de contraseña en 44 archivos, casi todas de pruebas;
  - de la clave maestra en 24 y de `secret` en 7;
  - URL de Postgres con credenciales de desarrollo en 9;
  - claves de acceso de 49 dígitos en 87;
  - firmas XML en 12.

  Ningún encabezado de clave privada PEM, certificado, token de AWS o de GitHub, ni JWT.
- **Herramientas descartadas en la readiness:**
  - `gitleaks-action` exige una clave de licencia en repositorios de organizaciones; la CLI de
    Gitleaks es MIT.
  - TruffleHog es AGPL-3.0 y verifica credenciales contra las API de los proveedores.
  - `dependency-review-action` exige Advanced Security en repositorios privados.

## Goals / Non-Goals

**Goals:**
- Ningún aviso HIGH o CRITICAL entra en silencio.
- Ningún secreto entra en el historial sin que la CI lo detecte.
- El camino crítico de la CI no se alarga.
- Las mismas comprobaciones se reproducen en local sin secretos de producción y sin leer archivos
  sin versionar.
- Ningún valor encontrado aparece en los logs.

**Non-Goals:**
- Medir o reducir la duración del job `verify`.
- Proteger la rama `main` o exigir checks en GitHub: es configuración de la cuenta.
- Escanear imágenes de contenedores o fijar la de PostgreSQL por digest.
- Reglas de calidad de código (SAST).

## Decisions

### D1. Comprobador de dependencias sobre `pnpm audit`

`scripts/check-dependency-security.ts` corre con Node, sin dependencias npm: solo `node:*`. Así
funciona antes de cualquier instalación.

1. Ejecuta `corepack pnpm audit --json`, sin `--audit-level` (recibe todas las severidades) ni
   `--ignore-unfixable`.
2. **Si la salida no es JSON válido**, informa `DEPENDENCY SECURITY: ERROR` con el código de error de
   pnpm (por ejemplo `ERR_PNPM_AUDIT_BAD_RESPONSE`), sin volcar la salida, y sale con un código
   distinto de cero. Una caída del registro nunca pasa.
3. **Con JSON válido**, ignora el código de salida de pnpm y normaliza cada aviso: GHSA, paquete,
   severidad, versiones vulnerables y corregidas, rutas, y si es de desarrollo o de producción.
4. Aplica la política (D2) y las excepciones (D3) y sale con 0 (`PASS`) o 1 (`FAIL`).

**Separación.** La lógica de política y excepciones es una función pura, sin red, con la fecha
inyectada, para que la pruebe Vitest (proyecto `scripts`, como `check-versions`).

**Alternativas descartadas:**
- **`pnpm audit --audit-level high` a secas:** no distingue una caída de un hallazgo, ni aplica
  vencimientos.
- **Ignorar en `pnpm-workspace.yaml` (`audit.ignore`):** sin motivo, responsable ni vencimiento, y
  oculta el aviso también en local.
- **OSV-Scanner:** no se verificó que lea los dos documentos del lockfile, y la documentación de pnpm
  advierte que un lector de un solo documento puede ver cero dependencias.

### D2. Política de severidad

- **Bloquean:** HIGH y CRITICAL, sin distinguir producción de desarrollo ni directa de transitiva.
- **Se informan sin bloquear:** MODERATE y LOW. Aparecen en la salida y en el resumen del job.
- **Sin período de gracia:** la salida de pnpm no trae la fecha de publicación ni datos de
  explotabilidad. Un aviso HIGH publicado hoy hace fallar la siguiente corrida, salvo que una
  excepción revisada ya lo cubra.
- **Detección temprana:** la corrida semanal (D7) detecta los avisos nuevos aunque nadie haga push.

### D3. Excepciones revisadas con vencimiento

El archivo versionado es `security/dependency-audit-exceptions.json`. Cada entrada tiene:

| Campo | Regla |
| --- | --- |
| `advisory` | Un GHSA exacto (`GHSA-xxxx-xxxx-xxxx`) |
| `package` | El nombre exacto del paquete del aviso |
| `paths` | Prefijos de ruta de dependencias (`backend>node-forge`). Cada ruta del hallazgo debe empezar por alguno. Una ruta nueva hacia el paquete vuelve a bloquear. |
| `reason` | Motivo y contexto de explotabilidad, no vacío |
| `owner` | Responsable o contexto de la revisión |
| `reviewed` | Fecha de revisión, `AAAA-MM-DD` |
| `expires` | Fecha de vencimiento, como máximo 90 días después de `reviewed` |

**La CI falla si una excepción:**
- vence (la fecha de hoy pasó `expires`);
- tiene campos ausentes o vacíos, un formato inválido o más de 90 días entre `reviewed` y
  `expires`;
- usa comodines, una ruta vacía, otro campo o una severidad en lugar de un aviso;
- ya no corresponde a ningún hallazgo (excepción obsoleta);
- está duplicada.

Una excepción solo neutraliza un hallazgo bloqueante. Los MODERATE y LOW no la necesitan, y el
hallazgo exceptuado sigue en la salida como «exceptuado hasta …».

**Excepciones iniciales**, con `reviewed` igual a la fecha de la implementación:

| Aviso | Paquete | Plazo | Motivo |
| --- | --- | --- | --- |
| GHSA-3f6p-5ww8-9rcr | `mysql2` | 30 días | Transitiva de la CLI de Prisma en un proyecto PostgreSQL. La corrección existe y requiere su propia revisión. |
| GHSA-ggr8-5vv4-36mx | `deepmerge-ts` | 45 días | Transitiva de `@prisma/config`. La corrección cruza una major, sensible para la compatibilidad de Prisma 7. |
| GHSA-86w9-cpqp-85rv | `node-forge` | 90 días | Directa, en el área de firma congelada. El uso actual es leer el PKCS#12, el ASN.1 y los campos del certificado, no verificar firmas RSA PKCS#1 v1.5. No afirma que el paquete sea seguro en general. |
| GHSA-vfj7-8cjw-p6xm | `braces` | 90 días | Transitiva de desarrollo, de las herramientas de lint, sin versión corregida identificada. |

El MODERATE de `mysql2` (GHSA-rgwj-5xj2-c3m3) no recibe excepción y sigue visible.

**Revalidación al implementar (revisión).** La tabla sale de la readiness, no de la implementación.
Antes de crear el archivo, la implementación ejecuta el escaneo real sobre el lockfile vigente:
- **Cada excepción planeada** se crea solo si ese GHSA, ese paquete y esas rutas siguen apareciendo.
- **Un hallazgo que desapareció** no recibe excepción.
- **Un hallazgo cuyo aviso, severidad o rutas cambiaron** no hereda la excepción anterior: se
  informa.
- **Un HIGH o CRITICAL nuevo** detiene la implementación antes de activar o empujar la compuerta, y se
  informa con una propuesta. Nunca se añade una excepción solo para obtener la CI en verde.

Las fechas `reviewed` y `expires` salen de la fecha real de la implementación, sin retroceder.

**Alternativas descartadas:**
- **Excepciones sin vencimiento o por paquete:** crecen en silencio.
- **Avisar sin fallar ante una excepción obsoleta:** deja entradas muertas que nadie retira.

### D4. Gitleaks: binario oficial fijado y verificado

**Herramienta:** la CLI de Gitleaks, sin `gitleaks-action`.

**Fijación, en un solo lugar del repositorio** (`security/gitleaks.json`), que leen la CI y el
comando local:
- la versión exacta;
- el nombre del artefacto oficial de Linux x64;
- su SHA-256;
- la URL de la release.

**En la CI**, el instalador `scripts/security/install-gitleaks.sh` recibe la ruta del archivo de
fijación y el directorio de destino:
1. descarga el artefacto de la release oficial con `curl -fsSL` a un temporal, sin `| sh`;
2. comprueba la suma contra el valor del repositorio con `sha256sum -c`;
3. si no coincide, imprime `SECRET SECURITY: ERROR` y sale con un código distinto de cero, sin
   extraer ni ejecutar nada;
4. si coincide, extrae solo el binario y comprueba que informa la versión fijada.

**Prueba del instalador (revisión).** Una prueba sirve desde un servidor HTTP local un artefacto
falso, cuyo binario deja una marca si se ejecuta:
- **con una suma incorrecta**, el instalador sale con un código distinto de cero e imprime `ERROR`, y
  no queda binario ni marca;
- **con la suma correcta**, extrae y comprueba la versión.

El control no depende de revisar el workflow a mano.

La suma del repositorio es el ancla de confianza. El archivo de sumas de la propia release se usa
solo al fijar la versión, como comprobación cruzada.

**Resolución en la implementación:** se toma una release vigente de `github.com/gitleaks/gitleaks`
y se calcula la suma del artefacto descargado, comparándola con la publicada en la release. La
versión, el artefacto, la suma y la fuente quedan en `security/gitleaks.json` y en
`docs/architecture/stack.md`. Ni `latest` ni alias de versión.

### D5. Alcance del escaneo de secretos

- **En la CI (revisión):** todo el historial que el checkout del evento pone a su alcance, con
  `fetch-depth: 0`:
  - en un push, el historial alcanzable desde la rama empujada;
  - en una pull request, el del commit de prueba de la fusión, que incluye los commits de la pull
    request y su base.

  No se añade ninguna lógica de `fetch` con credenciales para ampliar el alcance.
  - Las opciones de `git log` que use Gitleaks se fijan según la semántica documentada de la
    versión fijada.
  - Si incluyen otras referencias que trae el checkout, la documentación dice exactamente cuáles,
    sin afirmar que cubre «todas las ramas» si no es así.

  Con 548 commits y 8 MiB cuesta segundos, y es más simple y más seguro que revisar solo el diff.
- **En local:** `corepack pnpm security:secrets` revisa solo lo que controla git:
  - el historial confirmado, con `gitleaks git`;
  - y lo preparado para el commit, con el modo de cambios preparados de la versión fijada.

  Nunca usa `gitleaks dir` ni recorre el directorio de trabajo. Así no lee el `archivosensible.env`
  ni los `.env` sin versionar, ni nada fuera del repositorio, como `~/.config/facturador-certification/`.
- **Versión local exacta (revisión).** El comando exige que el Gitleaks local sea exactamente la
  versión de `security/gitleaks.json`:
  - si falta, falla con la instrucción de instalar esa versión;
  - si es otra, falla con la versión encontrada y la esperada;
  - nunca descarga nada por su cuenta. Solo la CI descarga el artefacto verificado.

### D6. Reglas del proyecto, falsos positivos y salida segura

**Configuración** (`.gitleaks.toml`). Extiende las reglas por defecto, sin reemplazarlas. La
directiva exacta se toma de la documentación de la versión fijada, sin suponerla (revisión). La
evidencia exigida, sobre repositorios temporales:
- una credencial sintética que detecta una regla por defecto, detectada;
- un secreto sintético de una regla del proyecto, detectado;
- un valor de ejemplo permitido, no informado;
- una clave de acceso del SRI, no informada solo por su longitud.

Añade:
- **Reglas por ruta** (sin contenido): `*.p12`, `*.pfx`, `archivosensible.env` y archivos `.env`
  o `.env.*`, salvo `.env.example`.
- **Reglas de contenido:**
  - `CERTIFICATE_MASTER_KEY` asignada a un base64 de 32 bytes;
  - `BETTER_AUTH_SECRET` asignado a 32 caracteres o más;
  - URL `postgres://` o `postgresql://` con contraseña;
  - las claves privadas PEM, cubiertas por la regla por defecto.

**Lo que no es un secreto:** claves de acceso del SRI, certificados públicos, firmas XML ni
identificadores fiscales. Ninguna regla los marca solo por largos.

**Falsos positivos:**
- **Allowlists acotadas por valor:** solo para los marcadores que ya identifican un valor como
  sintético. Por ejemplo, el secreto y la clave maestra de ejemplo documentados (que producción
  rechaza), los valores «ci-solo-para-verificacion», «de-pruebas» y «-e2e-», y las credenciales de
  desarrollo `facturador` de Compose y de la CI.
- **Sin exclusiones de directorios** ni línea base que oculte el repositorio.
- **Lo que quede legítimo** se suprime por la huella estable de Gitleaks en `.gitleaksignore`, con
  un comentario que lo explique.
- **Las reglas por ruta no se suprimen nunca:** un PKCS#12 versionado es un incidente, no un falso
  positivo. El comprobador falla si `.gitleaksignore` contiene una huella de una regla por ruta.
- **Un hallazgo que podría ser un secreto real** no se suprime. Detiene la implementación sin
  empujar la rama y se informa sin el valor (D10).

**Salida segura.** `scripts/check-secret-security.ts` ejecuta Gitleaks:
- con `--redact` y `--no-banner`;
- con el informe JSON en un archivo temporal;
- con un código de salida propio para los hallazgos, que los distingue de los errores de la
  herramienta.

Imprime por hallazgo solo la regla, el archivo, la línea, el commit corto y un identificador
(prefijo SHA-256 de la huella). Nunca los campos `Secret` ni `Match`, ni la huella cruda, que
contiene la ruta.

**Hallazgos de una regla por ruta:** muestran la categoría y el directorio, no el nombre del
archivo, que podría contener la identidad de un contribuyente.

El informe temporal se borra siempre al terminar, también ante un error.

### D7. Workflow `security.yml`

Un workflow aparte, para que la corrida semanal no repita el `verify` de 40 minutos:

- **Disparadores:** `push`, `pull_request`, `schedule` semanal y `workflow_dispatch`.
- **Permisos:** `permissions: contents: read` y nada más. Ni escritura, ni `id-token`, ni
  `security-events`, ni comentarios en pull requests.
- **Secretos:** ninguno del repositorio. Las pull requests de forks usan `pull_request`, sin
  secretos y con el token de solo lectura.
- **Jobs**, paralelos entre sí e independientes de `verify`:
  - **`dependency-security`** (`timeout-minutes: 5`):
    1. checkout con `persist-credentials: false`;
    2. `setup-node` con `.node-version`, sin caché del gestor;
    3. `corepack enable`;
    4. `corepack pnpm security:dependencies`.

    Sin `pnpm install`: no se ejecuta ningún script de instalación y el lockfile no cambia.
  - **`secret-security`** (`timeout-minutes: 10`):
    1. checkout con `fetch-depth: 0` y `persist-credentials: false`;
    2. `setup-node` y `corepack enable`;
    3. la instalación de las dependencias de desarrollo con `--frozen-lockfile --ignore-scripts`,
       solo para ejecutar las pruebas de las reglas con Vitest, sin scripts de instalación;
    4. la descarga verificada de Gitleaks (D4);
    5. las pruebas de las reglas contra el binario fijado;
    6. el comprobador en modo CI.

    **Configuración aparte para las pruebas de las reglas.** Necesitan el binario real, que el job
    `verify` no tiene. Viven en `scripts/security/`, fuera del proyecto `scripts` por defecto, con su
    propia configuración de Vitest. Así corren en este job y en local con la versión fijada.

    Las pruebas puras siguen en el proyecto `scripts` de `verify`: la política, las excepciones, la
    salida segura y el instalador.

  Los tiempos (5 y 10 minutos) salen de la readiness. La implementación mide las duraciones reales y
  las anota.
- **Salida de cada job:**
  - una línea final `DEPENDENCY SECURITY: PASS|FAIL|ERROR` o `SECRET SECURITY: PASS|FAIL|ERROR`;
  - un resumen en `$GITHUB_STEP_SUMMARY`;
  - anotaciones `::error` sin valores: con archivo y línea en los secretos de contenido; sin archivo
    en las reglas por ruta y en las dependencias.

  Sin SARIF ni artefactos.

### D8. Acciones fijadas por commit

- **Qué se fija:** las acciones del workflow nuevo y las dos de `verify.yml` (`actions/checkout`,
  `actions/setup-node`) pasan a SHA de commit completos de sus releases oficiales, dentro de la
  misma major (v5).
- **Cómo:** cada SHA se resuelve en la implementación desde el repositorio oficial de la acción y
  lleva la versión legible en un comentario.
- **Sin otros cambios en `verify.yml`.** Fijar la imagen de PostgreSQL por digest queda para el
  hardening de contenedores.

### D9. `.gitignore` versionado

Se añade una sección de material sensible con `*.p12`, `*.pfx` y `archivosensible.env`. Las reglas
`.env`, `.env.*` y `!.env.example` no cambian. No se ignoran extensiones de certificados públicos.
La exclusión local del clon puede seguir, pero deja de ser la única protección.

### D10. Respuesta ante un hallazgo real

La CI falla y no corrige nada. El procedimiento se documenta en `docs/security/hardening.md`:
1. contener;
2. rotar o revocar el secreto;
3. evaluar la exposición;
4. reescribir el historial solo con autorización explícita del dueño.

Un hallazgo no autoriza a modificar el historial publicado.

### D11. Documentación, ADR y deuda

- **ADR 0026, escaneo de dependencias y secretos en la CI:** `pnpm audit` con excepciones revisadas
  y la CLI de Gitleaks fijada, con las alternativas descartadas.
- **`docs/architecture/stack.md`:** la fila de Gitleaks, con la versión, el artefacto, la suma y la
  fuente, y la fijación de las acciones.
- **`docs/security/hardening.md`:** las protecciones de la cadena de suministro y de secretos, la
  política de excepciones y la respuesta ante un hallazgo.
- **`docs/quality/testing.md`:**
  - los dos comandos locales;
  - cómo reproducir un fallo por un aviso HIGH, una excepción vencida y un secreto encontrado;
  - el uso de un repositorio temporal con un secreto sintético para el último caso.
- **`docs/quality/technical-debt.md`:**
  - las cuatro correcciones o reevaluaciones pendientes, ligadas a sus vencimientos;
  - la validación estricta de OpenSpec en la CI, con la CLI 1.14.0 fijada, como siguiente cambio
    pequeño.

## Risks / Trade-offs

- **[Un aviso HIGH nuevo rompe todas las corridas, también de cambios ajenos]** → Es la política
  elegida. La corrida semanal lo detecta antes, y la respuesta es corregir o añadir una excepción
  revisada con vencimiento.
- **[Las excepciones iniciales vencen en 30, 45 y 90 días y vuelven a romper la CI]** → Es lo
  buscado. La deuda registra cada corrección con su fecha.
- **[Una caída del registro de npm bloquea la CI]** → Falla en cerrado, con `ERROR` distinguible de
  `FAIL`. Se repite la corrida, sin pasar en silencio.
- **[Falsos positivos de Gitleaks desconocidos hasta ejecutarlo]** → La implementación lo ejecuta en
  local sobre el historial antes de activar la CI y ajusta solo allowlists por valor o huellas
  justificadas.
- **[El binario de Gitleaks es una dependencia más de la cadena de suministro]** → Versión exacta,
  artefacto oficial y suma en el repositorio. Actualizarlo es un cambio revisado, como cualquier
  dependencia.
- **[Un SHA de acción fijado deja de recibir parches de seguridad de la etiqueta]** → La versión
  legible queda en el comentario. Actualizarlos es mantenimiento explícito.
- **[La exclusión de `archivosensible.env` en `.gitignore` revela su nombre en el repositorio]** →
  El nombre ya figura en la documentación y no contiene datos. Su contenido sigue fuera.

## Migration Plan

1. Fijar las versiones y las sumas.
2. Medir y ajustar Gitleaks en local, sin red hacia el SRI.
3. Añadir los comprobadores con sus pruebas, las excepciones iniciales y la configuración.
4. Añadir `security.yml` y fijar las acciones de `verify.yml`.
5. Comprobar en la rama que los dos jobs pasan y anotar sus duraciones.

**Reversión:** revertir los commits del cambio. No hay datos ni comportamiento del producto
afectados.

## Open Questions

- **La versión exacta de Gitleaks y su suma** se fijan al implementar, desde la release oficial
  vigente. No cambian el enfoque ni las tareas.
