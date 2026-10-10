# Proposal

## Why

En las dos transmisiones reales a Pruebas (facturas 300 y 301, 2026-10-10), el primer envío a
Recepción de cada sesión nueva terminó a los 4,1 s en `CONNECTION_LOST` (`UND_ERR_SOCKET`), sin
cabeceras. La recuperación funcionó:
- el comprobante quedó en `SEND_UNKNOWN`;
- se reconcilió la misma clave;
- se reenvió el mismo XML.

Pero el operador no puede saber en qué fase falló ni qué lado cerró:
- El transporte guarda solo el primer código de la cadena de causas y descarta el resto, incluidos
  los contadores del socket que trae el error de undici: bytes escritos y leídos.
- El proxy de salida registra solo la decisión de política, no el ciclo de vida del túnel.

La investigación local (sin red, con un SRI simulado) encontró además un defecto del proxy: si el
destino falla con el túnel ya establecido, el proxy escribe una línea `HTTP/1.1 502` en claro dentro
del túnel TLS.

## What Changes

- **Diagnóstico seguro del fallo de transporte.** Un fallo sin respuesta lleva además un
  diagnóstico, y el log del intento lo incluye:
  - la fase: antes de las cabeceras o durante el cuerpo;
  - los nombres, códigos y llamadas al sistema de la cadena de causas;
  - los bytes escritos y leídos por el socket, cuando el error los trae.

  Nunca lleva el mensaje del error, direcciones, puertos, el SOAP, el XML, la clave ni datos del
  contribuyente. La clasificación no cambia, y un corte ambiguo sigue siendo `CONNECTION_LOST`, que
  lleva a `SEND_UNKNOWN`.
- **Ciclo de vida del túnel en `egress.log`.** Cada `CONNECT` admitido registra, sin contenido:
  - la conexión al destino, con su duración, o su fallo con el código;
  - el cierre del túnel: qué lado cerró primero, cómo cerró el destino (`FIN` o error con su código),
    los bytes en cada sentido, la duración y el tiempo entre el último byte del cliente y el cierre.
- **Sin `502` dentro de un túnel establecido.** Con el túnel abierto, un fallo del destino solo
  cierra la conexión del cliente. Antes de establecerlo, el proxy responde `502` como hasta ahora.
- **Pruebas locales del transporte a través de un proxy `CONNECT`**, con el proxy del entorno como
  en la sesión real, contra servidores locales:
  - la respuesta normal;
  - un cierre o un reset tras la solicitud;
  - el primero que falla y el segundo que pasa;
  - el silencio y el cierre a los pocos segundos;
  - el corte durante el TLS o justo tras el `CONNECT`;
  - el `502` del proxy y el proxy ausente.
- **Documentación** de la investigación: lo conocido, lo inferido y lo desconocido.

Fuera de alcance:
- la máquina de estados fiscal, la clasificación (`NOT_SENT` frente a incierto), los reintentos, los
  plazos y la reconciliación;
- cualquier solicitud de calentamiento o sondeo al SRI;
- persistir el diagnóstico en la base de datos;
- todo contacto real con el SRI.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

Ninguna. El cambio añade diagnóstico a los logs, sin el SOAP, como exige
`openspec/specs/sri-transmission`. Además corrige y observa la herramienta del operador
`scripts/sri-egress/`, que no forma parte de `openspec/specs/`. Ningún requisito cambia, por eso
declara `skip_specs: true`.

## Impact

- **Código.**
  - `backend/src/modules/sri-engine/application/transport.ts`: el diagnóstico opcional del fallo.
  - `backend/src/modules/sri-engine/infrastructure/soap-transport.ts`.
  - El log de `backend/src/modules/fiscal/application/transmission-step.ts`.
  - `scripts/sri-egress/proxy.ts`.
- **Pruebas.**
  - El contrato del transporte, directo y a través de un proxy local.
  - El proxy, con destinos simulados.
- **Documentación.**
  - `docs/quality/observability.md`.
  - `docs/quality/sri-egress-allowlist.md`.
  - `docs/quality/sri-certification.md`.
- **Sin migraciones, dependencias nuevas ni cambios en la base de la certificación.**
