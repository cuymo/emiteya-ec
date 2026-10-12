# Proposal

## Why

`openspec validate --all --strict` es la compuerta de gobierno de los cambios: comprueba que las specs
y los cambios en curso sigan siendo válidos. Hoy corre solo en local, con una CLI global que cada
desarrollador instala sin versión fijada (`docs/architecture/bootstrap.md`).

La CI remota no la ejecuta, así que un cambio que rompa la validación estricta puede llegar a `main`
con la CI en verde. Es la deuda `PINNED_OPEN_SPEC_CI_VALIDATION` de `docs/quality/technical-debt.md`,
que el cierre de la prioridad 3 dejó como el siguiente cambio pequeño.

El problema es de los mantenedores: la validación depende de la máquina de cada uno y no queda
garantizada en la integración.

**Evidencia de la readiness (2026-10-12):**
- **El paquete:** la CLI es `@fission-ai/openspec`, licencia MIT, binario `openspec`.
  - La versión 1.14.0 está publicada con firmas y procedencia del registro.
  - Exige Node 20.19.0 o posterior, y el proyecto usa Node 24.21.0.
  - No tiene scripts de instalación, y ninguna dependencia transitiva necesita compilarse.
- **La validación:** con la CLI global 1.14.0, `openspec validate --all --strict` pasa en 22 de 22
  elementos, en menos de un segundo.
- **El lockfile:** añadirla como dependencia de desarrollo de la raíz suma unos 38 paquetes, y ningún
  aviso nuevo.
- **Un aviso ya conocido:** abre una segunda ruta hacia el aviso HIGH ya revisado de `braces`
  (GHSA-vfj7-8cjw-p6xm), a través de `fast-glob` y `micromatch`. No hay versión corregida de `braces`.
- **Telemetría:** la CLI envía telemetría anónima, salvo en CI o con `OPENSPEC_TELEMETRY=0`.
- **Archivos generados:** los 35 archivos de agentes que genera OpenSpec llaman a `openspec` a secas y
  no se editan a mano.

## What Changes

- **CLI de OpenSpec fijada en el repositorio.** `@fission-ai/openspec` pasa a ser una dependencia de
  desarrollo de la raíz, con la versión exacta 1.14.0, cubierta por el lockfile y por
  `security:dependencies`. No se actualiza a 1.14.1: el objetivo es la reproducibilidad.
- **Un comando canónico, `corepack pnpm openspec:validate`.** Un envoltorio del proyecto, solo con
  módulos de Node:
  - ejecuta la CLI instalada en el repositorio con `validate --all --strict`, nunca una CLI global
    del `PATH`;
  - desactiva la telemetría de forma explícita (`OPENSPEC_TELEMETRY=0`);
  - falla si la validación falla o si la CLI no está instalada.
- **La validación dentro de `verify`.** El script `verify` la ejecuta justo después de
  `format:check`, antes de las pruebas y el build.
  - La CI ya ejecuta `corepack pnpm verify`, así que cada push y pull request la corre sin cambiar
    ningún workflow.
  - Es de solo lectura: no repara, reescribe ni archiva nada.
- **La excepción existente de `braces` cubre la nueva ruta.** Se añade a sus rutas solo la ruta exacta
  que introduce OpenSpec, y se actualiza su motivo. La revisión (2026-10-12) y el vencimiento
  (2027-01-10) no cambian, y no se crea otra excepción. Cualquier otra ruta nueva hacia `braces` sigue
  bloqueando.
- **La CLI global solo para los flujos de agentes.** La documentación fija esa instalación en la
  versión exacta 1.14.0 y la distingue de la validación del proyecto, que no depende de ella.

**Fuera de alcance:**
- **Workflows:** cambiar `verify.yml` o `security.yml`, y añadir workflows, jobs o una corrida
  semanal.
- **Archivos generados:** editar los 35 archivos de agentes o regenerarlos.
- **Versiones:** actualizar OpenSpec o las acciones de GitHub.
- **Dependencias:** corregir `braces` o cualquier otra; su deuda sigue abierta.
- **Otro trabajo:** la prioridad 4, y cualquier cambio fiscal o del código de ejecución. Ningún paso
  contacta el SRI.

## Capabilities

### New Capabilities
<!-- Ninguna: el cambio es de CI y de gobierno, sin comportamiento observable del producto
(`skip_specs: true`). -->

### Modified Capabilities
<!-- Ninguna. -->

## Impact

- **Herramientas:**
  - `package.json`: la dependencia de desarrollo y los scripts `openspec:validate` y `verify`;
  - `pnpm-lock.yaml`;
  - un envoltorio en `scripts/` con su prueba.
- **Seguridad de las dependencias:**
  - `security/dependency-audit-exceptions.json`: una ruta más en la excepción de `braces`, con el
    vencimiento sin cambios;
  - una prueba del alcance por rutas de esa excepción.
- **Documentación:**
  - `docs/architecture/bootstrap.md`, `docs/quality/change-lifecycle.md`, `docs/quality/testing.md` y
    `docs/architecture/stack.md`;
  - `docs/quality/technical-debt.md`: la deuda de `braces` menciona la ruta nueva, y
    `PINNED_OPEN_SPEC_CI_VALIDATION` se resuelve solo cuando la CI remota de `main` lo demuestre.
- **Sin cambios** en `verify.yml`, `security.yml`, el código de ejecución, los archivos generados de
  OpenSpec ni los flujos fiscales.
