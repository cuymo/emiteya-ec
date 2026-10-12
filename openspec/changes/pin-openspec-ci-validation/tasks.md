# Tasks

## 1. CLI de OpenSpec fijada y su escaneo

- [ ] 1.1 Añadir `@fission-ai/openspec` con la versión exacta `1.14.0` a las `devDependencies` de la
  raíz con Corepack, sin caret ni tilde, y regenerar el lockfile (design D1). Verificar:
  - `corepack pnpm install --frozen-lockfile` pasa;
  - ningún paquete nuevo lleva `requiresBuild`, y `allowBuilds` no cambia;
  - `corepack pnpm check:versions` pasa;
  - el diff del lockfile solo añade OpenSpec y sus dependencias.
- [ ] 1.2 Ejecutar `pnpm audit --json` y comparar con la línea base: 4 HIGH y 1 MODERATE.
  - **Si aparece cualquier HIGH o CRITICAL** distinto de la ruta nueva hacia `braces`
    (GHSA-vfj7-8cjw-p6xm), detenerse sin crear excepciones e informarlo.
  - **Si no:** confirmar la ruta exacta que serializa `pnpm audit` para `braces` a través de OpenSpec,
    y añadirla a las `paths` de la excepción existente de `braces` (design D4). Actualizar su motivo de
    forma acotada, sin cambiar `reviewed` (2026-10-12) ni `expires` (2027-01-10), sin crear otro
    objeto y sin tocar las demás excepciones.

  Verificar:
  - `corepack pnpm security:dependencies` termina en `PASS`, con los cuatro HIGH exceptuados y el
    MODERATE visibles;
  - en `scripts/check-dependency-security.test.ts`, sobre la entrada real de `braces`: cubre la ruta
    del lint y la de OpenSpec, y una tercera ruta arbitraria hacia `braces` da `FAIL`.
- [ ] 1.3 Documentar el grupo:
  - **`docs/architecture/stack.md`:** la fila de la CLI de OpenSpec, versión exacta y solo
    desarrollo.
  - **`docs/quality/technical-debt.md`:** la deuda de `braces` menciona la ruta de OpenSpec y el mismo
    vencimiento, sin resolverse.

  Verificar que `corepack pnpm format:check` pasa.

## 2. Comando canónico de validación

- [ ] 2.1 Crear `scripts/openspec-validate.ts`, solo con módulos de Node (design D2):
  - **Resolución:** resuelve el paquete con la resolución de módulos anclada en la raíz y comprueba
    que la versión instalada es la declarada en `package.json`. Si falta o difiere, falla con una
    instrucción.
  - **Ejecución:** ejecuta su `bin` con `process.execPath` y `validate --all --strict`, sin shell ni
    `PATH`.
  - **Entorno:** el proceso hijo lleva `OPENSPEC_TELEMETRY=0`, conservando el resto.
  - **Salida:** imprime una línea con la versión y el origen, y propaga el resultado: 0 solo si la CLI
    termina con 0; cualquier otro código, un error al lanzarla o una señal hacen fallar.

  Añadir el script `openspec:validate` a `package.json`.

  Verificar con `scripts/openspec-validate.test.ts`, sin versionar ningún artefacto inválido:
  - resuelve la CLI local 1.14.0 e imprime esa versión;
  - un `openspec` falso antepuesto en el `PATH` no interviene;
  - con una CLI simulada que termina con 0, con 3 o por una señal, el comando termina con 0, con un
    código distinto de cero y con un código distinto de cero, respectivamente;
  - el repositorio válido pasa, y no modifica `openspec/` (comparado por suma);
  - un repositorio temporal con contenido de OpenSpec inválido falla;
  - el proceso hijo recibe `OPENSPEC_TELEMETRY=0` y conserva una variable ajena;
  - sin el paquete, o con otra versión instalada, el comando falla, comprobado en repositorios
    temporales sin tocar los `node_modules` reales.

  Verificar también que `corepack pnpm openspec:validate` pasa en el repositorio.
- [ ] 2.2 Añadir `corepack pnpm openspec:validate` al script `verify`, justo después de
  `format:check` y antes de `check:versions`, las pruebas y el build (design D3), sin cambiar
  `verify.yml` ni `security.yml`. Verificar que el diff de `package.json` solo añade la dependencia y
  los dos scripts.
- [ ] 2.3 Documentar el grupo (design D5 y D6):
  - **`docs/architecture/bootstrap.md`:** la instalación global fijada en
    `@fission-ai/openspec@1.14.0`, solo para los flujos de agentes y `openspec update`, y el comando
    del proyecto para validar.
  - **`docs/quality/change-lifecycle.md`:** el comando canónico, su lugar en `verify` y la telemetría
    desactivada en ese comando.
  - **`docs/quality/testing.md`:** el comando y su lugar en `verify`.
  - **`AGENTS.md`:** revisarlo, y cambiarlo solo si alguna afirmación queda inexacta.

  Los 35 archivos de agentes generados no se tocan. Verificar que `corepack pnpm format:check` pasa.

## 3. Verificación local y CI de la rama

- [ ] 3.1 Antes de empujar, verificar en local:
  - las pruebas del envoltorio y de la excepción;
  - `corepack pnpm openspec:validate`;
  - `corepack pnpm security:dependencies` y `corepack pnpm security:secrets` con `PASS`;
  - `corepack pnpm verify` completo, con la validación justo después de `format:check`.

  Si una prueba inestable ya registrada falla en `verify`, informar el código de salida real con la
  evidencia aislada o de control.
- [ ] 3.2 Con autorización, empujar la rama y comprobar en la CI:
  - en el log de `verify`, la validación estricta con la CLI fijada corre antes de las pruebas;
  - `verify` y `security` quedan en verde;
  - `verify.yml` y `security.yml` siguen sin cambios.

  Anotar las ejecuciones y las duraciones.
- [ ] 3.3 Tras publicar en `main` con autorización, y solo cuando la CI de `main` demuestre que la
  validación estricta corrió, mover `PINNED_OPEN_SPEC_CI_VALIDATION` a resueltas en
  `docs/quality/technical-debt.md`, con la ejecución que lo demuestra. La deuda de `braces` sigue
  abierta. Verificar que `openspec validate --all --strict` pasa con la CLI fijada.
