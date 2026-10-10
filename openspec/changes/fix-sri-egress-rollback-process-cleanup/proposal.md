# Proposal

## Why

El operador de la certificación en Pruebas no puede confiar en que `sri:egress rollback` deje la
sesión aislada realmente detenida. El 2026-10-10, después de la primera factura autorizada:
- `rollback` informó `ROLLED_BACK`, pero el proceso de la aplicación siguió vivo en el espacio de
  nombres de red de la sesión anterior.
- Las ejecuciones locales de la prueba de punta a punta dejaban el mismo tipo de huérfano.

Antes de enviar otro documento real hace falta que detener una sesión sea verificable.

La causa:
- `rollback` y el cierre del supervisor envían `SIGTERM` a `unshare`.
- Con `--kill-child`, `unshare` mata con `SIGKILL` al lanzador `inside.ts` antes de que este reenvíe
  la señal a la aplicación.
- La aplicación queda huérfana, hija del gestor de servicios del usuario. Sin sus puentes, no tiene
  red ni base de datos, pero sigue viva y conserva el espacio de nombres.

## What Changes

- **Identidad de la sesión.** `apply` genera un identificador aleatorio de la sesión.
  - Lo hereda todo proceso que corre dentro: el lanzador, la aplicación y sus descendientes.
  - Lo guarda en el estado con el PID y el instante de arranque del supervisor y del lanzador.
- **Detención ordenada y verificada.** `rollback` y el cierre del supervisor detienen solo los
  procesos de esa sesión:
  - los identifican por su identificador, por compartir su espacio de nombres de red o, en el caso
    del supervisor, por su PID con el mismo instante de arranque;
  - primero la aplicación con `SIGTERM` y un plazo de cierre ordenado, con el proxy y los puentes
    todavía abiertos; luego el lanzador y el supervisor; al final `SIGKILL` para lo que quede;
  - después vuelven a buscar los procesos de la sesión.
- **Falla cerrada.** Si queda un proceso de la sesión:
  - `rollback` informa `ROLLBACK_INCOMPLETE` con cada proceso restante y su motivo, y sale con
    error;
  - conserva el estado para reintentar y nunca informa `ROLLED_BACK` en ese caso.
- **Idempotencia.** `rollback` sobre una sesión ya detenida, o con parte de sus procesos ya
  terminados, termina en `ROLLED_BACK`.
- **`status` detecta los restos.** Informa cada parte de la sesión (supervisor, lanzador, aplicación)
  y la marca `STALE` si hay procesos de la sesión sin supervisor.
- **Pruebas** de la sesión normal, de la aplicación que sobrevive al supervisor, de la sesión
  parcialmente detenida, de un proceso ajeno intacto y del fallo de limpieza. No hay tráfico real con
  el SRI, ni con Pruebas ni con Producción.
- **Documentación** de `rollback` y `status` en `docs/quality/sri-egress-allowlist.md`.

Fuera de alcance:
- cualquier comportamiento fiscal, de transmisión o de la aplicación;
- la política de salida (solo `celcer.sri.gob.ec:443`), `verify` y el archivo de entorno;
- cambiar la red o el firewall del anfitrión;
- matar procesos por nombre o en todo el anfitrión;
- el estado escrito por la versión anterior de la herramienta, que no tiene identificador: `rollback`
  lo rechaza sin borrarlo.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

Ninguna. La herramienta del operador `scripts/sri-egress/` no forma parte de `openspec/specs/`: su
comportamiento se documenta en `docs/quality/sri-egress-allowlist.md`. El cambio corrige un defecto
de esa herramienta sin cambiar el comportamiento observable del producto, por eso declara
`skip_specs: true`.

## Impact

- **Código.** `scripts/sri-egress/session.ts` (apply, status, rollback y el cierre del supervisor) y
  un módulo nuevo del ciclo de vida de los procesos de la sesión. Lo hace sin dependencias nuevas.
- **Pruebas.** `scripts/sri-egress/*.test.ts`, en el proyecto `scripts` de Vitest. La prueba de punta
  a punta sigue omitiéndose sin espacios de nombres de usuario sin privilegios.
- **Documentación.** `docs/quality/sri-egress-allowlist.md`.
- **Operación.** Sin cambios en la base de la certificación ni en los secuenciales. La sesión real se
  vuelve a aplicar con la versión corregida cuando el dueño autorice el siguiente documento.
