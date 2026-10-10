# Design

## Context

En la sesión real, una llamada al SRI recorre esta cadena:
1. `fetch` con `NODE_USE_ENV_PROXY=1`;
2. el puente dentro del espacio de nombres, `127.0.0.1:3128` → `egress.sock`;
3. el proxy del supervisor;
4. `celcer.sri.gob.ec:443`.

La clasificación del transporte es conservadora (add-sri-transmission, D10): solo es `NOT_SENT` lo
que prueba que nada salió.

Evidencia de las facturas 300 y 301:

| Intento | Operación | TLS (inferido) | Cuerpo | Resultado | ms |
| --- | --- | --- | --- | --- | --- |
| 1 | Recepción | completo, en frío | unos 13 KB | `UND_ERR_SOCKET`, sin cabeceras | 4 110 y 4 151 |
| 2 | Autorización | completo | 380 B | 200 | 2 085 y 2 072 |
| 3 | Consulta | reanudado | 385 B | 200 | 69 y 87 |
| 4 | Recepción | reanudado | unos 13 KB | 200 | 208 y 236 |
| 5 | Autorización | reanudado | 380 B | 200 | 73 y 84 |

Cada intento abrió su propio `CONNECT`: hay cinco en `egress.log`.

Reproducción local, sin red: el cliente en `unshare --net`, el proxy real con un destino simulado y
un servidor TLS que hace de SRI:

| Escenario (proceso nuevo) | El cliente ve |
| --- | --- |
| Normal, primera y segunda solicitud | 200; 30 ms, luego 8 ms |
| El destino cierra (`FIN`) o resetea tras leer la solicitud | `UND_ERR_SOCKET`; 14 129 bytes escritos, 0 leídos |
| Silencio y cierre del destino a los 4 s | `UND_ERR_SOCKET` a los 4 048 ms; 14 129 / 0 |
| Corte durante el handshake TLS, o cierre justo tras el `CONNECT` | `ECONNRESET` |
| El destino rechaza la conexión: el proxy responde `502` | `UND_ERR_ABORTED` |
| Proxy sin escuchar | `ECONNREFUSED`, que es `NOT_SENT` |
| Puente sin proxy detrás | `ECONNRESET` |

## Goals / Non-Goals

**Goals:**
- Que el próximo fallo diga en qué fase ocurrió, qué lado cerró, cómo y cuántos bytes pasaron.
- Corregir el `502` escrito dentro de un túnel establecido.
- Fijar con pruebas cómo llega cada fallo a la aplicación a través de un proxy.

**Non-Goals:**
- Explicar la causa sin evidencia nueva. Queda como desconocida (D5).
- Reclasificar como `NOT_SENT` los fallos previos al TLS a través del proxy (D4).
- Cambiar los reintentos o los plazos, o añadir calentamientos.

## Decisions

### D1. Diagnóstico del fallo en el resultado del transporte, solo en el log

El resultado de fallo del transporte gana un campo opcional `diagnostic`:
- `phase`: `BEFORE_HEADERS` o `BODY`;
- `causes`: hasta cinco eslabones, cada uno con `name`, `code` (texto) y `syscall`;
- `socket`: `bytesWritten` y `bytesRead` del primer eslabón que los trae (el `SocketError` de
  undici), o `null`.

Nunca se copian el mensaje, las direcciones ni los puertos: el mensaje puede contener el nombre del
host o la dirección.

`transmission-step` añade `transportDiagnostic` al log «intento con el SRI clasificado», tomado del
intercambio recién hecho. El intento guardado no lo persiste.

Alternativa descartada: una columna nueva en `sri_attempt`. Pide una migración y toca la evidencia
fiscal por un dato de operación.

### D2. Ciclo de vida del túnel en el proxy

La línea de decisión de un `CONNECT` admitido gana un `tunnel`, un número secuencial del proceso.
Después se registran, como líneas con `event`:
- `UPSTREAM_CONNECTED`: `connectMs` y la familia de la dirección (`IPv4` o `IPv6`), sin la dirección;
- `UPSTREAM_CONNECT_FAILED`: `code` y `connectMs`;
- `TUNNEL_CLOSED`: `closedFirstBy` (`upstream` o `client`), `upstreamEnd` (`FIN`, `ERROR` o `null`),
  `upstreamError`, `clientError`, `bytesToUpstream`, `bytesToClient`, `durationMs` y
  `clientIdleBeforeCloseMs`, el tiempo entre el último byte del cliente y el primer cierre.

Los bytes salen de los contadores del socket del destino. Nunca se registra contenido.

### D3. Sin `502` dentro de un túnel establecido

El proxy marca el túnel como establecido al escribir `200 Connection Established`. Un error del
destino después de eso solo destruye la conexión del cliente. Antes de eso responde
`502 UPSTREAM_FAILED`, como hasta ahora.

La prueba reproduce el defecto: con el código anterior, el cliente recibe los bytes del destino
seguidos de `HTTP/1.1 502`.

### D4. La clasificación no cambia

Un corte durante el TLS, un cierre justo tras el `CONNECT`, un `502` del proxy o un puente sin proxy
no envían la solicitud. Aun así, la aplicación los ve como `ECONNRESET` o `UND_ERR_ABORTED`, códigos
que en una conexión directa también aparecen después de enviar. Siguen siendo inciertos y llevan a
`SEND_UNKNOWN` y a reconciliar.

Es la frontera conservadora de D10: cuesta una consulta, nunca un duplicado. Las pruebas lo fijan.

### D5. Conocido, inferido y desconocido

- **Conocido.**
  - El fallo ocurrió con el TLS ya establecido y la solicitud en curso. Solo en ese caso undici da
    `UND_ERR_SOCKET`; un corte durante el TLS o tras el `CONNECT` da `ECONNRESET`.
  - El proxy y los puentes no cierran por su cuenta: no tienen plazos, y la primera solicitud de un
    proceso nuevo pasa por la cadena completa.
  - El SRI no tenía la clave tras el intento 1.
  - Solo falló el primer envío grande con el TLS en frío.
- **Inferido.** Cerró el lado lejano, el SRI o un equipo del camino, unos segundos después de recibir
  la solicitud, sin responder.
- **Desconocido.** La causa. Las hipótesis son un plazo del lado del servidor sobre una primera
  conexión, un equipo intermedio o la MTU del camino en el primer envío grande. No se pueden
  distinguir sin los datos de D1 y D2 de un próximo envío autorizado.

## Risks / Trade-offs

- **[Los contadores de bytes de un socket TLS no son bytes de la aplicación]** → Se informan tal
  cual, solo para comparar órdenes de magnitud: si se escribió la solicitud completa y si llegó algo.
- **[Un log más largo por intento]** → Solo en los fallos y en los túneles, con campos acotados.
- **[Un `NOT_SENT` real que se ve como incierto]** → Ya era así (D4). La reconciliación lo resuelve
  sin duplicar.
