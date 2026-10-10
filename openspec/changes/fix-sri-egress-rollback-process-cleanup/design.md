# Design

## Context

La sesión aislada tiene cuatro piezas (`docs/quality/sri-egress-allowlist.md`):
1. el supervisor (`session.ts apply`), en el anfitrión, con el proxy y los puentes de su lado;
2. `unshare --user --map-root-user --net --kill-child`, el lanzador;
3. `inside.ts`, el hijo de `unshare` dentro del espacio de nombres, con sus propios puentes;
4. la aplicación, hija de `inside.ts`.

Solo se aíslan la red y el usuario, no los PID. Los PID que se ven dentro son los del anfitrión.

El estado actual (`state.json`) guarda los PID del supervisor y de `unshare`. `rollback` y el cierre
del supervisor envían `SIGTERM` a `unshare`, y la causa del defecto está en proposal.md, en «Why».

## Goals / Non-Goals

**Goals:**
- Al terminar `rollback` no queda ningún proceso de la sesión. Si queda, el comando falla y lo dice.
- La aplicación recibe primero un cierre ordenado, con la salida todavía abierta: un envío en curso
  puede terminar.
- Nunca se señala un proceso que no sea de la sesión.

**Non-Goals:**
- No se aíslan los PID con un espacio de nombres propio (D5).
- No se cambia `inside.ts` ni la aplicación.
- No hay compatibilidad con el estado de la versión anterior (D6).

## Decisions

### D1. Identificador de la sesión heredado por el entorno

`apply` genera 16 bytes aleatorios en hexadecimal y los pone en `SRI_EGRESS_SESSION_ID`, en el
entorno con que lanza `unshare`.
- `unshare`, `inside.ts` y la aplicación los heredan.
- Los descendientes de la aplicación también, salvo que limpien su entorno.
- El identificador se fija después del archivo de entorno de la sesión, así que ese archivo no lo
  puede sustituir.

Un proceso es de la sesión si la entrada exacta `SRI_EGRESS_SESSION_ID=<id>` está en su
`/proc/<pid>/environ`. Ese archivo es el entorno con que arrancó el proceso, y el usuario dueño lo
puede leer, también dentro del espacio de nombres de usuario de la sesión.
- Un PID reutilizado no lleva el identificador.
- Un huérfano reasignado a otro padre sigue llevándolo.
- No se compara ningún nombre de proceso.

Alternativas descartadas:
- **Solo PID.** No ve a la aplicación ni a sus descendientes y no resiste la reutilización.
- **Árbol de padres.** Se pierde justo cuando el proceso queda huérfano.
- **Nombre de proceso.** Afecta a procesos ajenos.

### D2. Espacio de nombres de red como segundo criterio

También es de la sesión todo proceso del espacio de nombres de red de un proceso que lleve el
identificador, siempre que ese espacio no sea el del anfitrión. Así se encuentra a un descendiente
que limpió su entorno, mientras quede alguien con el identificador. El espacio solo se toma de un
proceso vivo y verificado, nunca de un número guardado: un número de espacio liberado se puede
reutilizar.

### D3. Supervisor por PID e instante de arranque

El supervisor arranca fuera de la sesión y no lleva el identificador. El estado guarda su PID y su
instante de arranque (campo 22 de `/proc/<pid>/stat`), y solo se le señala si los dos coinciden. Lo
mismo se guarda del lanzador, con fines informativos. Cada proceso se vuelve a verificar justo antes
de enviarle una señal.

### D4. Orden de detención, espera y verificación

Un único módulo de ciclo de vida, con el acceso a `/proc`, las señales y el reloj inyectables para
las pruebas. Lo usan `rollback` y el cierre del supervisor:
1. `SIGTERM` a la aplicación y a sus descendientes, todo lo que no sea el lanzador ni el supervisor.
   - Se espera hasta 20 s, porque el backend espera hasta 8 s los jobs en curso.
   - El proxy y los puentes siguen abiertos.
2. `SIGTERM` a `inside.ts`, a `unshare` y, en `rollback`, al supervisor. Se espera hasta 10 s.
3. `SIGKILL` a lo que quede de la sesión. Se espera hasta 5 s.
4. Nueva búsqueda. Un proceso en estado zombi cuenta como terminado.

Las señales se manejan así:
- `ESRCH` significa que el proceso ya no existe y no es un error.
- Otro error, como `EPERM`, queda registrado en ese proceso.
- Lo que sigue vivo al final sale con el motivo `STILL_ALIVE` o con el error de la señal.

El cierre del supervisor detiene la sesión antes de cerrar sus servidores. Solo borra el estado y
los sockets si no queda nada; si queda algo, informa `TEARDOWN_INCOMPLETE` y conserva el estado
para `rollback`.

### D5. Sin espacio de nombres de PID

`unshare --pid` haría que el núcleo matara a todos al morir el primer proceso, pero:
- la detención sería con `SIGKILL`, sin cierre ordenado;
- cambiaría los PID que ven `inside.ts` y la aplicación;
- y cambiaría el aislamiento ya validado con el backend real.

El identificador y la verificación final cubren la clase de fallo encontrada sin esos costos.

### D6. Estado de la versión anterior

Un `state.json` sin `sessionId` no permite identificar los procesos de forma segura. En ese caso
`rollback` informa `ROLLBACK_INCOMPLETE` con el motivo `STATE_WITHOUT_SESSION_ID`, sale con error y
conserva el estado. No adivina por nombre. En este equipo no queda ninguna sesión de la versión
anterior.

### D7. `status` y `rollback`

- **`status`.**
  - `NOT_RUNNING` sin estado.
  - Si no:
    - `RUNNING` con el supervisor vivo;
    - `STALE` si hay procesos de la sesión sin supervisor o con el estado de la versión anterior.
  - Informa `supervisor`, `launcher`, `isolatedProcess` (`inside.ts`), `app` y la cantidad de
    procesos de la sesión.
- **`rollback`.**
  - Sin estado, `ROLLED_BACK` sin procesos.
  - Con todo detenido, borra los sockets y el estado e informa `ROLLED_BACK` con lo que detuvo.
  - Si queda algo, informa `ROLLBACK_INCOMPLETE`, sale con código 1 y conserva todo.
  - El registro `egress.log` se conserva siempre como evidencia.

### D8. Pruebas

- **Unitarias del módulo, con una tabla de procesos simulada:**
  - A: sesión normal y orden de las señales;
  - B: aplicación sin supervisor;
  - C: sesión parcialmente detenida, con un `ESRCH` en carrera, e idempotencia;
  - D: procesos ajenos con otro identificador, el mismo nombre o la red del anfitrión, que nunca se
    señalan;
  - E: un `EPERM` y un proceso que no muere, con `ROLLBACK_INCOMPLETE` y el estado conservado;
  - un PID reutilizado del supervisor, que no se señala.
- **De punta a punta, con `unshare` real** (se omiten sin espacios de nombres de usuario):
  - la aplicación de prueba escribe su PID;
  - tras `rollback` no existe ningún proceso con el identificador, ni ese PID con su instante de
    arranque;
  - un proceso ajeno lanzado por la prueba sigue vivo;
  - otra sesión reproduce el defecto: se matan con `SIGKILL` el supervisor y el lanzador, `status`
    da `STALE` con la aplicación viva y `rollback` la detiene.

  Las pruebas se escriben antes que la corrección, para reproducir el defecto con el código anterior.

Ninguna prueba contacta el SRI ni Internet: las sesiones usan un servidor falso de base de datos y
una aplicación de prueba.

## Risks / Trade-offs

- **[Un descendiente limpia su entorno y además sobrevive a todos los portadores del
  identificador]** → El backend no lanza subprocesos: usa hilos y WASM. D2 lo cubre mientras quede un
  portador vivo. Fuera de eso, `status` no lo vería; queda documentado.
- **[Leer `/proc` de procesos de otros usuarios falla]** → Esos procesos se ignoran. No pueden ser de
  la sesión, porque la sesión corre con el usuario del operador.
- **[El cierre ordenado alarga `rollback` hasta 35 s en el peor caso]** → En el caso normal la
  aplicación termina en pocos segundos. La espera es lo que permite que un envío en curso termine.
- **[Un PID reutilizado entre la búsqueda y la señal]** → Se vuelven a verificar el identificador o el
  instante de arranque justo antes de cada señal.
