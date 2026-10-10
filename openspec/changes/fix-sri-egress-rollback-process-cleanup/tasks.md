# Tasks

## 1. Reproducción del defecto

- [x] 1.1 En `scripts/sri-egress/session.test.ts`, la aplicación de prueba escribe su PID. La prueba
  de `rollback` comprueba además:
  - que ese PID, con su instante de arranque, ya no existe;
  - que un proceso ajeno lanzado por la prueba sigue vivo.

  Se añade la sesión con el supervisor y el lanzador muertos por `SIGKILL` (design D8). Verificar que
  con el código anterior las dos pruebas fallan porque la aplicación sigue viva (reproducción local,
  sin red).

## 2. Ciclo de vida de la sesión

- [x] 2.1 Crear `scripts/sri-egress/lifecycle.ts` (design D1 a D4):
  - la búsqueda de los procesos de la sesión, por el identificador, por compartir un espacio de nombres
    de red verificado y, para el supervisor, por PID con su instante de arranque;
  - la detención ordenada con espera y con la verificación final;
  - el acceso a `/proc`, las señales y el reloj inyectables.

  Verificar con `scripts/sri-egress/lifecycle.test.ts`:
  - A: la sesión normal y el orden de las señales;
  - B: la aplicación sin supervisor;
  - C: la sesión parcialmente detenida, con un `ESRCH` en carrera, e idempotencia;
  - D: los procesos ajenos nunca se señalan;
  - E: un `EPERM` y un proceso que no muere dan procesos restantes con su motivo;
  - un PID reutilizado del supervisor no se señala.
- [x] 2.2 En `scripts/sri-egress/session.ts` (design D1, D4, D6 y D7):
  - `apply` genera `SRI_EGRESS_SESSION_ID` y guarda el estado v2;
  - el cierre del supervisor usa el módulo antes de cerrar sus servidores y conserva el estado si
    queda algo;
  - `status` informa cada parte y `STALE`;
  - `rollback`, idempotente, falla cerrado con `ROLLBACK_INCOMPLETE`, conserva el estado y rechaza el
    de la versión anterior.

  Verificar con las pruebas del grupo 1, ya en verde, y con una prueba de `rollback` que falla y
  conserva el estado. Ninguna contacta el SRI ni Internet.

## 3. Documentación

- [ ] 3.1 Actualizar `docs/quality/sri-egress-allowlist.md`:
  - la falla cerrada, sin afirmar que `--kill-child` termina todo;
  - ROLLBACK: el orden, la espera, `ROLLBACK_INCOMPLETE`, la idempotencia y la conservación de
    `egress.log`;
  - `status`, con `STALE` y cada parte;
  - las pruebas.

  Verificar leyendo la sección contra el comportamiento de las pruebas.

## 4. Verificación

- [ ] 4.1 Ejecutar las pruebas del proyecto `scripts`, `corepack pnpm verify` y
  `openspec validate --all --strict`. Si `verify` no sale con 0 por la clase de fallo de carga ya
  documentada, aplicar la política de evidencia compuesta y registrar el código de salida real.
- [ ] 4.2 Repetir localmente una sesión simulada:
  - `apply` contra la aplicación de prueba y el servidor falso de base de datos, con `status` en
    `RUNNING`;
  - `rollback`;
  - comprobar que no queda la aplicación, el supervisor, el lanzador, el proxy ni los puentes, que no
    quedan sockets ni estado y que el proceso ajeno sigue vivo.

  Todo sin tráfico real con el SRI.
