# Lista de permitidos de salida de la certificación en Pruebas

Herramienta del operador para la sesión de certificación real (`sri-certification.md`, secciones 3
y 14; `sri-test-environment-checklist.md`, sección D). Durante la sesión, el proceso de la aplicación
solo puede salir a **`celcer.sri.gob.ec:443`**. Cualquier otro destino se bloquea, y Producción
(`cel.sri.gob.ec`) con un motivo propio: `PRODUCTION_ACCESS_BLOCKED`.

Vive fuera del runtime de la aplicación, en `scripts/sri-egress/`, y se ejecuta con
`corepack pnpm sri:egress <comando>`. **No usa `sudo` ni cambia el firewall o la red del anfitrión.**

## Diseño

```text
 anfitrión                                      espacio de nombres de red de la sesión
 ─────────                                      (solo loopback, sin ruta ni DNS)
 proxy de salida ── egress.sock ◀──────────── 127.0.0.1:3128 ◀── HTTPS_PROXY de la aplicación
   solo CONNECT celcer.sri.gob.ec:443
 PostgreSQL :5432 ◀── pg.sock ◀────────────── 127.0.0.1:5432 ◀── DATABASE_URL
 127.0.0.1:<api> ──▶ api.sock ──────────────▶ 127.0.0.1:<api>  ──▶ la API de la aplicación
```

- **Aislamiento del núcleo.** La aplicación corre en un espacio de nombres de red nuevo
  (`unshare --user --map-root-user --net`), sin privilegios. Su única interfaz es loopback: no tiene
  ruta a la red ni resolución DNS. No depende de comprobar cadenas dentro de Node: aunque una
  biblioteca ignorara el proxy, no tendría por dónde salir.
- **Una única salida.** Un proxy `CONNECT` fuera del espacio de nombres, alcanzable solo por un socket
  Unix:
  - admite exactamente `CONNECT celcer.sri.gob.ec:443`;
  - decide sobre el nombre pedido antes de resolver DNS o de abrir una conexión, así que un destino
    rechazado no genera tráfico;
  - no reenvía peticiones HTTP en claro;
  - registra cada decisión en `egress.log`, sin contenido; el tráfico admitido es TLS de extremo a
    extremo y no se inspecciona.
- **Puentes locales.** Los sockets Unix con ruta cruzan los espacios de nombres de red. Así el proceso
  aislado alcanza el proxy, la base de datos y la exposición de su propia API al anfitrión, y nada más.
- **Identidad de la sesión.** `apply` genera un identificador aleatorio, `SRI_EGRESS_SESSION_ID`.
  - Lo heredan `unshare`, el lanzador `inside.ts`, la aplicación y sus descendientes.
  - Un proceso es de la sesión si arrancó con ese identificador, o si comparte el espacio de nombres
    de red de uno que lo lleva.
  - El supervisor se reconoce por su PID con el mismo instante de arranque.
  - Nunca se busca un proceso por su nombre ni se señala un proceso ajeno.
- **Falla cerrada.**
  - `apply` no arranca nada si `verify` falla, ni si el directorio ya tiene una sesión con procesos.
  - Si el proxy cae, la aplicación se queda sin salida.
  - Si la aplicación termina, el supervisor cierra la sesión.
  - Al cerrarse, el supervisor detiene primero todo proceso de la sesión y después cierra sus puentes.
    Si queda algún proceso, conserva el estado para `rollback`.
  - `unshare --kill-child` no basta por sí solo. Al morir, `unshare` mata a `inside.ts` antes de que
    reenvíe la señal, y la aplicación quedaba huérfana. Por eso la detención empieza por la aplicación
    (ROLLBACK).

Decisiones de la política (`scripts/sri-egress/policy.ts`):

| Petición | Decisión |
| --- | --- |
| `CONNECT celcer.sri.gob.ec:443` | `ALLOWED_SRI_TEST` |
| `cel.sri.gob.ec` con cualquier puerto o método | `PRODUCTION_ACCESS_BLOCKED` |
| `celcer.sri.gob.ec` con otro puerto | `PORT_NOT_ALLOWED` |
| Otro nombre, otro subdominio de `sri.gob.ec` o una dirección IP literal | `HOST_NOT_ALLOWED` |
| Una petición HTTP de proxy que no es Producción | `METHOD_NOT_ALLOWED` |
| Un destino malformado o un literal IPv6 | `MALFORMED_TARGET` |

## Archivo de entorno de la sesión

Fuera del repositorio, con permisos `600`, y nunca se imprime. `verify` y `apply` exigen:

- `SRI_ENDPOINT_PRODUCTION_RECEPTION`, `_AUTHORIZATION` y `_VALIDITY` sobrescritos con una URL
  `https` a una dirección local cerrada, por ejemplo `https://127.0.0.1:9/cerrado`. Sin ellos, la
  aplicación usaría `cel.sri.gob.ec` por defecto, así que su falta es `PRODUCTION_ACCESS_BLOCKED`.
- Ningún `SRI_ENDPOINT_*` que nombre a Producción. Los de Pruebas, si se sobrescriben, solo pueden
  ser `https://celcer.sri.gob.ec/...`.
- `DATABASE_URL` a `127.0.0.1:<puerto de --pg>`, el puente local.
- `SRI_TRANSMISSION_ENABLED` definido: `0` durante la preparación, `1` solo en la sesión controlada.
- No definir `NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY` ni `NO_PROXY`: los fija la
  herramienta.

## VERIFY (sin red)

```sh
corepack pnpm sri:egress verify --backend-env-file <archivo> --pg 127.0.0.1:5432 --out <archivo.json>
```

Demuestra que la configuración, cuando se aplique, solo permitirá `celcer.sri.gob.ec:443`. **No
contacta el SRI, ni Pruebas ni Producción, ni ningún otro host**:

- **la política**, una matriz con Producción, puertos, otros subdominios, direcciones IP y métodos;
- **el proxy real con un destino simulado**: admite `celcer:443` y solo «marca» ese destino, mientras
  que Producción y los demás reciben `403` sin intentar ninguna conexión;
- **el espacio de nombres**, en una sonda: la única interfaz es loopback, una conexión directa a
  `192.0.2.1` (TEST-NET-1, RFC 5737) no tiene ruta y un nombre `.invalid` no resuelve;
- **el archivo de entorno**, con las reglas de la sección anterior.

Termina en `PASS` o `FAIL`. Su salida con `--out` alimenta la comprobación final de la sesión
(`sri-test-environment-checklist.md`, sección G). El bloqueo de Producción **nunca** se demuestra
intentando llegar a `cel.sri.gob.ec`.

## APPLY (solo en la sesión controlada, con la autorización del dueño)

```sh
corepack pnpm sri:egress apply --state-dir <dir privado> --backend-env-file <archivo> \
  --api-port <puerto> --pg 127.0.0.1:5432 -- node --conditions=development backend/src/main.ts
```

1. Repite `verify`: si falla, no arranca nada.
2. Abre el proxy y los puentes en `<dir privado>` (permisos `700`, sockets `600`).
3. Arranca la aplicación en el espacio de nombres aislado, con `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY`
   al puente del proxy y el identificador de la sesión. Guarda en `state.json` el identificador, y el
   supervisor y el lanzador con su instante de arranque.
4. Queda en primer plano supervisando: si algo termina, cierra todo.

La API queda en `127.0.0.1:<puerto>` del anfitrión, para el frontend y el operador.

## STATUS

```sh
corepack pnpm sri:egress status --state-dir <dir privado>
```

Informa `supervisor`, `launcher` (`unshare`), `isolatedProcess` (`inside.ts`), `app` y
`sessionProcesses`, la cantidad de procesos de la sesión:
- `RUNNING`: el supervisor vive;
- `STALE`: hay estado sin supervisor, por ejemplo una aplicación que le sobrevivió; se resuelve con
  `rollback`;
- `NOT_RUNNING`: no hay estado.

## ROLLBACK

```sh
corepack pnpm sri:egress rollback --state-dir <dir privado>
```

Detiene todo proceso de la sesión, en este orden:
1. `SIGTERM` a la aplicación y a sus descendientes, con el proxy y los puentes todavía abiertos para
   que un envío en curso termine. Espera hasta 20 s.
2. `SIGTERM` a `inside.ts`, a `unshare` y al supervisor. Espera hasta 10 s.
3. `SIGKILL` a lo que quede. Espera hasta 5 s.

Después vuelve a buscar los procesos de la sesión:
- Si no queda ninguno, borra los sockets y el estado y termina en `ROLLED_BACK`, con la lista de lo
  detenido.
- Si queda alguno, termina en `ROLLBACK_INCOMPLETE` con código de salida 1. Informa cada proceso
  restante con su PID, su papel y su motivo (`STILL_ALIVE`, `EPERM`), y conserva el estado para
  reintentar. Nunca informa `ROLLED_BACK` en ese caso.

Además:
- Es idempotente: sobre una sesión ya detenida, o con parte de sus procesos terminados, termina en
  `ROLLED_BACK`.
- `egress.log` se conserva siempre como evidencia.
- Un `state.json` de la versión anterior, sin identificador, no permite reconocer los procesos de
  forma segura: `rollback` lo rechaza (`STATE_WITHOUT_SESSION_ID`) sin borrarlo.
- No hay nada global que revertir: la herramienta nunca cambió el firewall ni la red del anfitrión.
- Si la sesión termina sin `ROLLED_BACK`, la red del anfitrión queda igual.

## Requisitos y límites

- **Requisito:** espacios de nombres de usuario sin privilegios (`unshare --user --net`). Si no están
  disponibles, `verify` falla y `apply` no arranca. Las pruebas de la sesión de punta a punta se omiten
  de forma explícita en ese caso, por ejemplo en algunos runners de CI.
- **Alcance:** la herramienta controla la salida del proceso de la aplicación. No reemplaza el
  firewall del equipo ni limita otros programas del operador.
- **Celcer.** `celcer.sri.gob.ec` solo se contacta en la sesión real, después de aplicar la lista y con
  la autorización expresa del dueño. Ni `verify` ni las pruebas lo contactan.

Pruebas: `scripts/sri-egress/*.test.ts`:
- la política;
- el entorno;
- una sesión aplicada de punta a punta con una aplicación de prueba:
  - Producción bloqueada, sin ruta directa y la base de datos por su puente;
  - `status`;
  - `rollback`, sin que sobreviva la aplicación y sin tocar un proceso ajeno;
- una aplicación que sobrevivió a su supervisor y a su lanzador: `status` la marca `STALE` y
  `rollback` la detiene;
- el ciclo de vida, con una tabla de procesos simulada:
  - la sesión normal y el orden de las señales;
  - una sesión parcialmente detenida y la idempotencia;
  - los procesos ajenos;
  - una señal rechazada o un proceso que no muere (`ROLLBACK_INCOMPLETE` con el estado conservado);
  - un PID reutilizado;
- la falla cerrada.
