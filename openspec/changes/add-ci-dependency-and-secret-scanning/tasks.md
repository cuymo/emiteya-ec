# Tasks

## 1. Seguridad de las dependencias

- [x] 1.1 Ejecutar `corepack pnpm audit --json` sobre el lockfile vigente y revalidar los avisos
  (design D3, revisión):
  - comparar cada HIGH conocido (`mysql2`, `deepmerge-ts`, `node-forge`, `braces`) por GHSA, paquete,
    severidad y rutas;
  - anotar los MODERATE y LOW.

  Si aparece un HIGH o CRITICAL nuevo, o uno conocido cambió, detenerse antes de crear excepciones,
  e informar el hallazgo y una propuesta. Verificar con el resumen de los avisos, sin datos privados.
- [x] 1.2 Crear `scripts/check-dependency-security.ts`, solo con módulos `node:*` (design D1, D2 y
  D3):
  1. ejecuta `corepack pnpm audit --json`;
  2. trata como `DEPENDENCY SECURITY: ERROR` una salida vacía, malformada o no JSON, con el código de
     pnpm y sin volcarla. Nunca la interpreta como cero vulnerabilidades;
  3. aplica la política: HIGH y CRITICAL bloquean, MODERATE y LOW se informan;
  4. valida y aplica las excepciones;
  5. imprime la línea final `PASS`, `FAIL` o `ERROR`, el resumen del job y las anotaciones sin
     valores. Sale con 0 solo en `PASS`.

  La lógica de política y excepciones queda como función pura con la fecha inyectada.

  Verificar con `scripts/check-dependency-security.test.ts` (proyecto `scripts`), sobre salidas de
  `pnpm audit` de muestra y fechas inyectadas, sin depender del reloj:
  - **Una excepción coincidente** neutraliza solo su hallazgo y su alcance de rutas.
  - **Lo que vuelve a bloquear:** una ruta nueva hacia un paquete exceptuado, o una excepción con
    otro GHSA o con otro paquete, que no coinciden.
  - **Excepciones inválidas, que fallan:** vencida, de más de 90 días, sin un campo, duplicada u
    obsoleta.
  - **Severidad:** un HIGH nuevo falla, un CRITICAL falla, y un MODERATE solo se informa sin fallar.
  - **Error de la fuente:** una salida vacía, malformada o no JSON da `ERROR`, nunca `PASS`.
  - **Salida:** ningún contenido crudo de pnpm.
- [x] 1.3 Crear `security/dependency-audit-exceptions.json` solo para los HIGH de la tarea 1.1 que
  siguen apareciendo con el mismo GHSA, paquete y rutas:
  - `mysql2`, 30 días;
  - `deepmerge-ts`, 45 días;
  - `node-forge`, 90 días;
  - `braces`, 90 días.

  Las fechas son las de la implementación. Añadir el script `security:dependencies` a
  `package.json`.

  Verificar que `corepack pnpm security:dependencies`:
  - termina en `PASS`, con los exceptuados y su vencimiento, y los MODERATE visibles;
  - no modifica `pnpm-lock.yaml` ni `pnpm-workspace.yaml`.
- [x] 1.4 Documentar el grupo:
  - **`docs/security/hardening.md`:** la política de severidad, el esquema y los límites de las
    excepciones, y por qué no se usan `--ignore-unfixable` ni los ignorados de `pnpm-workspace.yaml`.
  - **`docs/quality/testing.md`:** el comando y cómo reproducir un fallo por un aviso HIGH, por una
    excepción vencida y por un `ERROR` de la fuente.
  - **`docs/quality/technical-debt.md`:** una entrada con su vencimiento por cada aviso que siga
    presente: corregir `mysql2`, corregir `deepmerge-ts` de forma compatible con Prisma 7, y
    reevaluar `node-forge` y `braces`. Cada corrección, en un cambio propio, sin tocar la firma
    congelada.

  Verificar que `corepack pnpm format:check` pasa.

## 2. Seguridad de los secretos

- [x] 2.1 Fijar Gitleaks y crear su instalador (design D4):
  - **Fijación:** desde la release oficial vigente de `github.com/gitleaks/gitleaks`, descargar el
    artefacto de Linux x64 a un temporal fuera del repositorio. Calcular su SHA-256 y compararlo con
    el archivo de sumas de la release. Registrar la versión, el artefacto, la suma y la URL en
    `security/gitleaks.json` y en `docs/architecture/stack.md`.
  - **Instalador:** `scripts/security/install-gitleaks.sh` recibe la ruta del archivo de fijación y
    el destino. Descarga con `curl -fsSL`, comprueba con `sha256sum -c` y, si no coincide, imprime
    `SECRET SECURITY: ERROR` y sale con error sin extraer ni ejecutar nada. Si coincide, extrae y
    comprueba la versión.

  Verificar:
  - la suma registrada coincide con la publicada, sin `latest` ni alias;
  - la prueba del instalador (proyecto `scripts`), con un servidor HTTP local y un artefacto falso
    que deja una marca si se ejecuta: con una suma incorrecta sale con error e imprime `ERROR` sin
    binario ni marca, y con la correcta extrae y comprueba la versión.
- [x] 2.2 Crear `.gitleaks.toml` (design D6):
  - **Defaults:** extiende las reglas por defecto con la directiva documentada de la versión fijada,
    sin suponerla.
  - **Reglas por ruta:** `*.p12`, `*.pfx`, `archivosensible.env` y `.env` o `.env.*`, salvo los
    ejemplos.
  - **Reglas de contenido:** la clave maestra, el secreto de Better Auth y las URL de Postgres con
    contraseña.
  - **Ajuste:** ejecutar el binario verificado sobre el historial confirmado del repositorio, solo
    lo versionado. Ajustar solo con marcadores de valores sintéticos, allowlists acotadas o huellas
    comentadas en `.gitleaksignore`, sin excluir directorios, pruebas, fixtures ni documentos.

  Si un hallazgo podría ser un secreto real, detenerse sin suprimirlo, sin empujar y sin reescribir
  nada. Informar la regla, la categoría, el commit y la clasificación, sin el valor.

  Verificar que el historial da cero hallazgos tras el ajuste, y anotar el número de supresiones.
- [x] 2.3 Crear `scripts/check-secret-security.ts` (design D5 y D6):
  - **Versión:** exige la versión exacta de `security/gitleaks.json`. Si falta o es otra, falla con
    una instrucción segura y nunca descarga.
  - **En local:** el historial confirmado y los cambios preparados, nunca el directorio de trabajo
    ni un modo equivalente a `gitleaks dir`.
  - **En CI** (`--ci`): el historial al alcance del checkout del evento, con las opciones de
    `git log` documentadas.
  - **Ejecución:** Gitleaks con redacción, el informe JSON en un temporal que se borra siempre y un
    código de salida propio para los hallazgos.
  - **Supresiones:** falla si `.gitleaksignore` contiene una huella de una regla por ruta.
  - **Salida:** la regla, el archivo, la línea, el commit corto y un identificador opaco; para las
    reglas por ruta, la categoría y el directorio. La línea final es
    `SECRET SECURITY: PASS|FAIL|ERROR`, con el resumen del job y las anotaciones sin valores.

  Añadir el script `security:secrets` a `package.json`. Verificar con
  `scripts/check-secret-security.test.ts` (proyecto `scripts`), sobre informes y binarios de
  muestra:
  - **Nunca imprime** `Secret`, `Match` ni la huella cruda.
  - **Un hallazgo por ruta** no muestra el nombre del archivo.
  - **Errores:** un error de la herramienta da `ERROR`, y el temporal se borra.
  - **Versión local:** sin binario o con otra versión, falla.
  - **Alcance:** los argumentos nunca escanean el directorio de trabajo.
  - **Supresiones:** una huella de una regla por ruta en `.gitleaksignore` falla.
- [x] 2.4 Crear `scripts/security/gitleaks-rules.test.ts`, con su configuración de Vitest y el
  script `test:secret-rules` (design D7). Corre contra el binario fijado sobre repositorios git
  temporales fuera del proyecto y nunca empuja nada. Cubre:
  - **Detectados:** una credencial sintética de una regla por defecto, la clave maestra, el secreto
    de Better Auth, la URL de Postgres con contraseña, una clave privada PEM, los archivos `*.p12`,
    `*.pfx` y `archivosensible.env`, y un `.env` versionado.
  - **Permitidos, no informados:** un `.env.example`, un certificado público, un número largo con
    forma de clave del SRI, un valor de ejemplo permitido y un hallazgo suprimido por huella.
  - **Salida:** la del comprobador no contiene ningún valor sintético.

  Verificar que `corepack pnpm test:secret-rules` pasa en local con la versión fijada.
- [x] 2.5 Añadir al `.gitignore` versionado `*.p12`, `*.pfx` y `archivosensible.env`, sin cambiar
  las reglas `.env`, `.env.*` ni `!.env.example` (design D9). Verificar:
  - `git check-ignore` confirma los tres patrones, y `backend/.env.example` sigue versionado;
  - ningún archivo sensible entra en el índice.
- [x] 2.6 Documentar el grupo:
  - **`docs/security/hardening.md`:** las reglas del proyecto, lo que no se trata como secreto, la
    salida redactada y la respuesta ante un hallazgo (design D10: contener, rotar o revocar, evaluar
    y reescribir el historial solo con autorización explícita).
  - **`docs/quality/testing.md`:** los comandos, la instalación de la versión fijada y cómo
    reproducir un hallazgo con un repositorio temporal y un secreto sintético, sin secretos reales.

  Verificar que `corepack pnpm format:check` pasa.

## 3. Workflow de seguridad y acciones fijadas

- [x] 3.1 Resolver, desde los repositorios oficiales, los SHA de commit de las releases vigentes de
  `actions/checkout` y `actions/setup-node` dentro de la major 5. Fijarlos en `verify.yml` con la
  versión legible en un comentario, sin otro cambio en ese workflow (design D8). Verificar que el
  diff de `verify.yml` solo toca las dos referencias.
- [x] 3.2 Crear `.github/workflows/security.yml` (design D7):
  - **Disparadores:** `push`, `pull_request`, un `schedule` semanal y `workflow_dispatch`.
  - **Permisos:** solo `contents: read`, sin secretos ni ejecución privilegiada de pull requests.
  - **`dependency-security`** (5 minutos): checkout con `persist-credentials: false`, `setup-node`,
    Corepack y `security:dependencies`, sin `pnpm install`.
  - **`secret-security`** (10 minutos):
    - checkout con `fetch-depth: 0` y `persist-credentials: false`;
    - `setup-node`, Corepack y la instalación con `--frozen-lockfile --ignore-scripts`;
    - el instalador verificado;
    - `test:secret-rules`;
    - `security:secrets --ci`.
  - **Acciones:** fijadas por SHA.
  - **Sin** SARIF, artefactos ni pasos que contacten el SRI.

  Verificar con `corepack pnpm format:check` y una revisión de los permisos, los disparadores y los
  pasos.
- [x] 3.3 Documentar el grupo:
  - **`docs/architecture/adr/0026-…`:** el escaneo con `pnpm audit` y excepciones revisadas, la CLI
    de Gitleaks fijada por suma, el workflow aparte y las alternativas descartadas.
  - **`docs/architecture/stack.md`:** la fijación de las acciones.
  - **`docs/quality/testing.md`:** el workflow de seguridad y el alcance exacto de su historial.
  - **`docs/quality/technical-debt.md`:** `PINNED_OPEN_SPEC_CI_VALIDATION`, la validación estricta de
    OpenSpec en la CI remota con la CLI 1.14.0 fijada, como siguiente cambio pequeño.

  Verificar que `corepack pnpm format:check` pasa.

## 4. Verificación local y CI de la rama

- [x] 4.1 Antes de empujar, verificar en local:
  - las pruebas dirigidas: la política de dependencias, las excepciones, el instalador y su suma, el
    comprobador de secretos, las reglas y la seguridad del escaneo local;
  - `corepack pnpm format:check`, `openspec validate --all --strict` y `corepack pnpm verify`;
  - `corepack pnpm security:dependencies` y `corepack pnpm security:secrets`, con `PASS` en los dos.

  Si una prueba inestable ya registrada falla en `verify`, informar el código de salida real con la
  evidencia aislada o de control. Si el escaneo de secretos encuentra un posible secreto real, no
  empujar.
- [x] 4.2 Empujar la rama `add-ci-dependency-and-secret-scanning`, sin fusionar ni empujar `main`.
  Esperar los workflows de la rama y comprobar:
  - `verify`, `dependency-security` y `secret-security` en verde;
  - el resumen de cada job de seguridad con `PASS`;
  - ningún log con valores, ningún secreto de la CI, ningún permiso de escritura, ningún artefacto y
    ningún contacto con el SRI.

  Anotar las ejecuciones, las duraciones de los jobs, las versiones de los escáneres y cualquier
  reintento o fallo de red.
