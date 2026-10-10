# Tasks

## 1. Proxy de salida

- [ ] 1.1 En `scripts/sri-egress/proxy.test.ts`, contra destinos simulados, reproducir el `502`
  dentro de un túnel establecido (design D3). Verificar que con el código anterior el cliente recibe
  `HTTP/1.1 502` después de los bytes del destino.
- [ ] 1.2 En `scripts/sri-egress/proxy.ts`:
  - el túnel numerado y sus eventos `UPSTREAM_CONNECTED`, `UPSTREAM_CONNECT_FAILED` y
    `TUNNEL_CLOSED` (design D2);
  - el `502` solo antes de establecer el túnel (design D3).

  Verificar con `proxy.test.ts`:
  - el cierre del destino con `FIN` y con un reset;
  - el cierre del cliente primero;
  - el fallo de conexión del destino;
  - Producción sin marcar;
  - que el registro no lleva contenido.

## 2. Diagnóstico del transporte

- [ ] 2.1 En `transport.ts` y `soap-transport.ts`, el `diagnostic` del fallo (design D1). Verificar
  en `soap-transport.contract.test.ts`:
  - el puerto cerrado da `NOT_SENT` con `ECONNREFUSED` y `connect`;
  - el corte tras la solicitud da `CONNECTION_LOST` con los contadores, con lo escrito al menos del
    tamaño del sobre y nada leído;
  - los plazos propios llevan su fase;
  - la clasificación no cambia;
  - el diagnóstico no contiene direcciones, puertos ni mensajes.
- [ ] 2.2 Crear `backend/test/sri-engine/soap-transport-proxy.contract.test.ts`: el transporte en
  un proceso hijo con el proxy del entorno, un proxy `CONNECT` local y un servidor TLS local para
  un nombre `.test` (design D4). Cubre la respuesta normal, el cierre y el reset tras la solicitud,
  el primero que falla y el segundo que pasa, el silencio y el cierre, el corte durante el TLS, el
  cierre tras el `CONNECT`, el `502` del proxy y el proxy ausente. Verificar la clasificación de
  cada uno: solo el proxy ausente es `NOT_SENT`.
- [ ] 2.3 En `transmission-step.ts`, `transportDiagnostic` en el log «intento con el SRI
  clasificado». Verificar con una prueba del paso de transmisión:
  - el log de un `CONNECTION_LOST` lleva el diagnóstico;
  - el de una respuesta no lo lleva.

## 3. Documentación

- [ ] 3.1 Actualizar:
  - `docs/quality/observability.md`: el diagnóstico del intento;
  - `docs/quality/sri-egress-allowlist.md`: los eventos del túnel y el `502` solo antes de
    establecerlo;
  - `docs/quality/sri-certification.md`: la observación del primer envío, con lo conocido, lo
    inferido y lo desconocido (design D5).

  Verificar contra el comportamiento de las pruebas.

## 4. Verificación

- [ ] 4.1 Ejecutar las pruebas focalizadas, `corepack pnpm verify` y `openspec validate --all
  --strict`. Si `verify` no sale con 0 por una clase de fallo ya documentada, aplicar la política de
  evidencia compuesta y registrar el código de salida real. Nada contacta el SRI.
