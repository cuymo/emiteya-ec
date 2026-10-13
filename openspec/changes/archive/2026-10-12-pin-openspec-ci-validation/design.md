# Design

## Context

La motivación está en `proposal.md`. Este es el estado observado durante la readiness
(2026-10-12):

- **CLI actual.** `@fission-ai/openspec` 1.14.0 está instalada solo de forma global, con
  `corepack pnpm add --global` y sin versión (`docs/architecture/bootstrap.md`). No figura en ningún
  manifiesto ni en el lockfile.
- **El paquete:**
  - licencia MIT; un solo binario, `openspec` (`bin/openspec.js`, ESM);
  - `engines.node >=20.19.0`, compatible con Node 24.21.0;
  - sin scripts de instalación;
  - sus `exports` solo exponen `.`, así que `package.json` y `bin` no se resuelven con `require`.
- **Resolución simulada** en una copia temporal, con `--lockfile-only --ignore-scripts`:
  - unos 38 paquetes nuevos, ninguno eliminado y ninguno con `requiresBuild`;
  - el lockfile pasa las políticas de cadena de suministro de pnpm;
  - `pnpm audit` mantiene 4 HIGH y 1 MODERATE, sin avisos nuevos.
- **La ruta nueva de `braces`.** Aparece la ruta `.>@fission-ai/openspec>fast-glob>micromatch>braces`,
  hacia el aviso HIGH ya exceptuado GHSA-vfj7-8cjw-p6xm. La excepción solo cubre la ruta del lint del
  frontend, así que el comprobador da `FAIL`.
  - `braces` 3.0.3 es la última versión publicada, y `micromatch` 4.0.8, también la última, la exige.
  - OpenSpec 1.14.1 mantiene `fast-glob`.
  - OpenSpec usa `fast-glob` solo para resolver los globs de salida de los artefactos del esquema del
    cambio.
- **Telemetría.** La CLI envía telemetría y consulta la versión publicada. Las dos se desactivan con
  `CI`, `OPENSPEC_TELEMETRY` distinto de un valor activo, o `DO_NOT_TRACK`.
- **La validación hoy:** `openspec validate --all --strict` pasa en 22 de 22 elementos, en 0,6 a
  0,8 s.
- **CI:**
  - `verify.yml` instala con `--frozen-lockfile` y ejecuta `corepack pnpm verify`, con las acciones
    fijadas por commit desde la prioridad 3;
  - `security.yml` audita el lockfile en cada push y pull request.
- **Archivos de agentes.** Los 35 que genera OpenSpec (`.agents`, `.claude`, `.github`) llaman a
  `openspec` a secas, llevan «generatedBy 1.14.0» y no se editan a mano (`AGENTS.md`).

## Goals / Non-Goals

**Goals:**
- La misma CLI fijada valida en local y en la CI, sin depender de una instalación global.
- La validación estricta bloquea cada push y pull request y falla pronto.
- La dependencia nueva queda bajo la compuerta de seguridad de las dependencias, sin debilitarla.

**Non-Goals:**
- Cambiar el flujo de OpenSpec, sus archivos generados o su versión.
- Cambiar los workflows o las acciones.
- Corregir el aviso de `braces`.

## Decisions

### D1. Dependencia de desarrollo de la raíz con versión exacta

`@fission-ai/openspec` se añade a las `devDependencies` de la raíz con `"1.14.0"`.
- Cumple `saveExact` y `check:versions`, y no toca `allowBuilds`, porque no hay scripts de
  instalación.
- El lockfile la fija con su integridad, y `security:dependencies` la audita.

**Alternativas descartadas:**
- **Instalación global en la CI, o `pnpm dlx`:** quedan fuera del lockfile, y sus dependencias
  transitivas no se fijan ni se auditan.
- **Un binario independiente:** OpenSpec no publica ninguno.
- **Actualizar a 1.14.1:** el objetivo es reproducir la versión con la que se generaron los
  artefactos; actualizar es otro cambio revisado.

### D2. Envoltorio del proyecto para la validación

`scripts/openspec-validate.ts` usa solo módulos de Node, como los demás comprobadores de `scripts/`.
1. **Resolución portable (revisión).** Resuelve el paquete con la resolución de módulos de Node
   anclada en la raíz del repositorio: `createRequire(<raíz>/package.json).resolve`.
   - Los `exports` solo exponen `.`, así que se resuelve la entrada del paquete y se sube hasta su
     `package.json`, comprobando el nombre.
   - Funciona con la disposición de pnpm (enlaces y almacén) sin suponer rutas fijas, no usa el
     `PATH` y no añade dependencias.
2. **Versión.** Comprueba que la versión instalada es la declarada, exacta, en el `package.json` de
   la raíz. Si el paquete falta o difiere, falla con una instrucción para instalar las dependencias.
3. **Ejecución.** Ejecuta el `bin` declarado por el paquete con `process.execPath`, en la raíz del
   repositorio y con la salida heredada.
   - Sin `shell: true` ni una cadena de comando.
   - Una CLI global del `PATH` no interviene nunca.
4. **Telemetría.** Se desactiva de forma explícita: el entorno del proceso hijo lleva
   `OPENSPEC_TELEMETRY=0`, sin depender de que `CI` esté definida. Así el comando es igual en local y
   en la CI, sin `cross-env`.
5. **Salida (revisión).** El resultado es el de la CLI:
   - 0 solo si la CLI termina con 0;
   - un código distinto de cero en cualquier otro caso: la salida de la CLI, un error al resolver o al
     lanzar el proceso, o una terminación por señal.

   Ningún error se convierte en un éxito, y la salida de la validación no se oculta.
6. **Evidencia de la versión (revisión).** Antes de validar, imprime una línea con la versión y el
   origen, por ejemplo «OpenSpec 1.14.0 del repositorio, telemetría desactivada». Así el log de la CI
   demuestra que corrió la CLI fijada y no una global.

El script `openspec:validate` de `package.json` ejecuta `node scripts/openspec-validate.ts`.

**Alternativas descartadas:**
- **`"openspec:validate": "openspec validate --all --strict"`:** pnpm antepone `node_modules/.bin`,
  pero sin la dependencia instalada caería en una CLI global del `PATH`, y la telemetría necesitaría
  una variable de entorno en línea que no es portable.
- **`cross-env`:** una dependencia solo para una variable de entorno.

### D3. Dentro de `verify`, justo después de `format:check`

El script `verify` pasa a empezar por `format:check && openspec:validate && check:versions && …`.
- **En la CI:** el job `verify` ya ejecuta `corepack pnpm verify`, después de instalar con
  `--frozen-lockfile`. Gana la compuerta sin tocar `verify.yml`: falla cerca de un minuto después de
  empezar, antes de las pruebas y el build.
- **En local:** `corepack pnpm verify` ejecuta exactamente la misma cadena.
- **Disparadores:** los de `verify`, push y pull request, sin una corrida semanal.
- **Permisos:** los de `verify` (`contents: read`), sin secretos.

**Alternativas descartadas:**
- **Un job aparte en `verify.yml`:** repetiría el checkout, Node y la instalación para una
  comprobación de un segundo.
- **Un workflow aparte:** sin una ventaja concreta.

### D4. La excepción existente de `braces` cubre la ruta exacta de OpenSpec

En `security/dependency-audit-exceptions.json`, la entrada de GHSA-vfj7-8cjw-p6xm conserva su objeto,
su paquete, `reviewed: 2026-10-12` y `expires: 2027-01-10`.
- **La ruta nueva.** Se añade a sus `paths` la ruta exacta que serializa `pnpm audit`. La readiness
  observó `.>@fission-ai/openspec>fast-glob>micromatch>braces`; la implementación confirma la cadena
  real antes de escribirla.
- **El motivo**, actualizado de forma acotada:
  - es una herramienta de desarrollo y de la CI;
  - OpenSpec llega a `braces` por `fast-glob` y `micromatch`;
  - el aviso trata de la disponibilidad del proceso ante patrones de llaves muy anidados;
  - OpenSpec procesa los globs del esquema y de los cambios del repositorio, una configuración que no
    se trata como confiable por sí misma, porque una contribución maliciosa o malformada podría hacer
    fallar el proceso del validador;
  - la exposición es la disponibilidad de las herramientas locales y de la CI, no la confidencialidad
    ni la integridad de la aplicación;
  - es temporal porque no hay una versión corregida por esta ruta, y un cambio del paquete o de la
    ruta obliga a reevaluarla.

  No afirma que `braces` sea seguro ni que el aviso sea irrelevante.
- **Lo que no cambia:**
  - ampliar las rutas no reinicia los 90 días ni resuelve la deuda;
  - el hallazgo sigue visible como exceptuado;
  - cualquier otra ruta hacia `braces` sigue bloqueando.

**Si hay más avisos.** Si al añadir OpenSpec aparece cualquier HIGH o CRITICAL distinto de esta ruta
ya revisada, la implementación se detiene sin crear excepciones.

### D5. CLI global solo para los flujos de agentes

Los 35 archivos generados llaman a `openspec` a secas, y regenerarlos o editarlos queda fuera del
cambio. La documentación distingue:
- **La validación del proyecto:** la CLI fijada en el repositorio, con
  `corepack pnpm openspec:validate`.
- **Los flujos de agentes y `openspec update`:** una CLI global, ahora documentada con la versión
  exacta, `corepack pnpm add --global @fission-ai/openspec@1.14.0`.

`AGENTS.md` sigue siendo correcto, porque `openspec update` regenera los archivos con la CLI global.
Solo se cambia si la implementación encuentra una afirmación inexacta.

### D6. Verificación y documentación

**Pruebas** (`scripts/openspec-validate.test.ts`, proyecto `scripts`):
- **Resolución:** el envoltorio resuelve la CLI local 1.14.0.
- **Sin interferencia global:** un `openspec` falso antepuesto en el `PATH` no interviene.
- **Validación:** el repositorio válido pasa, y un repositorio temporal con contenido de OpenSpec
  inválido falla.
- **Solo lectura:** la ejecución no modifica `openspec/`, comparado por suma.
- **Telemetría:** el entorno del proceso hijo lleva `OPENSPEC_TELEMETRY=0`.
- **Fallos:** sin el paquete, o con otra versión instalada, el comando falla.

Ningún artefacto inválido se versiona.

**La prueba de la excepción** (`scripts/check-dependency-security.test.ts`) usa la entrada real de
`braces`:
- cubre la ruta del lint y la ruta exacta de OpenSpec;
- una tercera ruta arbitraria hacia `braces` da `FAIL`.

**Documentación:**
- **`docs/architecture/bootstrap.md`:** la instalación global fijada en 1.14.0, solo para los flujos
  de agentes, y el comando del proyecto.
- **`docs/quality/change-lifecycle.md`:** el comando canónico, la validación dentro de `verify` y la
  telemetría desactivada en ese comando.
- **`docs/quality/testing.md`:** el comando y su lugar en `verify`.
- **`docs/architecture/stack.md`:** la fila de la CLI de OpenSpec.
- **`docs/quality/technical-debt.md`:** la deuda de `braces` con la ruta nueva, sin resolverla.
  `PINNED_OPEN_SPEC_CI_VALIDATION` pasa a resueltas solo cuando la CI de `main` demuestre que la
  validación corrió.

## Risks / Trade-offs

- **[La CLI global de un desarrollador difiere de la fijada]** → La validación del proyecto no la usa.
  Los flujos de agentes sí, y la documentación fija la versión exacta.
- **[Actualizar OpenSpec exige más pasos]** → Cambiar la dependencia, revisar el lockfile y el
  escaneo, y regenerar los archivos de agentes con `openspec update` en el mismo cambio revisado.
- **[El aviso de `braces` abre otra ruta]** → Excepción acotada a la ruta exacta, con el mismo
  vencimiento y la deuda abierta. Cualquier otra ruta bloquea.
- **[El job `verify` tarda unos segundos más]** → Instalar los paquetes nuevos y validar cuesta poco
  frente a 27 a 41 minutos. No se quitan pruebas.
- **[Los `exports` del paquete cambian en otra versión]** → El envoltorio lee el `package.json`
  instalado por ruta, no por `require`. Una actualización revisada lo comprobaría.

## Migration Plan

1. Añadir la dependencia y regenerar el lockfile.
2. Confirmar la ruta real de `braces` y ampliar la excepción.
3. Añadir el envoltorio con sus pruebas y el script en `verify`.
4. Actualizar la documentación.
5. Verificar en local, empujar la rama y comprobar la CI.

**Reversión:** revertir los commits del cambio. No hay datos ni comportamiento del producto
afectados.
