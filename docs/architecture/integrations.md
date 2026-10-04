# Integrations

## External Services

| Service | Purpose | Auth | Owner |
| --- | --- | --- | --- |
| SRI — Recepción | Recibir el comprobante firmado: `RECIBIDA` o `DEVUELTA`. | Ninguna; el XML va firmado con el certificado del contribuyente. | Adaptador SOAP propio de `sri-engine` (ADR 0018) |
| SRI — Autorización | Consultar por clave de acceso: en procesamiento, `AUTORIZADO` o no autorizado (`NO AUTORIZADO` o `RECHAZADO`, ficha v2.34, §7.2.3). Es también la consulta por clave con que se reconcilia. | Ninguna. | Adaptador SOAP propio de `sri-engine` |
| SRI — Consulta de validez | `ConsultaComprobante`: guarda de la reconciliación antes de un reenvío; un estado informado impide reenviar (design D15 de `add-sri-transmission`). Nunca observa anulaciones: eso es una capacidad futura (Q-16). | Ninguna. | Adaptador SOAP propio de `sri-engine` |
| SMTP (post-MVP) | Entrega por correo del RIDE y el XML (Q-24). | Credenciales SMTP del operador. | Puerto de notificación |

## Integration Rules

- Tokens stay server-side.
- Use typed payloads at boundaries.
- Normalize provider errors before exposing them internally.
- Avoid provider names in user-facing UI unless necessary.
- Document rate limits and usage gates.
- Use Axios for server-side external API calls; excepción: el adaptador SOAP del SRI usa el `fetch` nativo de Node, solo en infraestructura (ADR 0018, enmienda del transporte).
- Do not call external provider APIs directly from the browser when tokens are required.
- Add runtime timeout configuration.
- Add backoff, queueing, or persisted jobs for bulk provider calls.
- Send an idempotency key with outbound mutations to providers that accept one, derived from the local operation record. A timeout is ambiguous, and the retry must not duplicate the effect. See `idempotency.md`.

## Provider Template

### `{{PROVIDER_NAME}}`

- Base URL:
- Docs:
- Auth:
- Timeout:
- Rate limit:
- Usage endpoint:
- Internal route prefix:
- Error behavior:
- Idempotency support:
- Webhook signature scheme and event ID field:

### SRI — Comprobantes electrónicos off-line

- Base URL: un conjunto de WSDL por ambiente (Pruebas `celcer.sri.gob.ec`, Producción `cel.sri.gob.ec`), listados en CTX §7. Son valores por defecto en un módulo central versionado, sobrescribibles por configuración; la lógica de negocio nunca contiene URLs (ERS SRI-REQ-01).
- Docs: ficha técnica off-line v2.34 (CTX SRI-02) y WSDL vigentes; prevalecen en el orden de CTX §1.
- Auth: ninguna en el transporte. TLS estándar del runtime, sin certificados ni fingerprints fijados, porque el SRI puede cambiarlos (CTX §7.5).
- Protocol: SOAP, con un adaptador propio sobre el `fetch` nativo de Node (ADR 0018, enmienda del transporte). Recepción `validarComprobante(xml firmado)` y autorización `autorizacionComprobante(claveAcceso)`, que también sirve para reconciliar por clave. La consulta `consultarEstadoAutorizacionComprobante(claveAcceso)` queda para la capacidad futura de anulaciones (Q-16), salvo que el design del cambio 7 justifique usarla para reconciliar. `ConsultaFactura` tiene otro contrato y queda fuera del MVP (CTX §25). El adaptador captura la respuesta original antes de normalizarla (CTX §44).
- Timeout: de conexión y cabeceras, y de lectura del cuerpo, separados y configurables por variable de entorno. Son configuración operativa, no una regla normativa del SRI.
- Rate limit: sin cuota publicada. Un comprobante por envío, sin lotes, dentro del límite de tamaño de la ficha (CTX §29). Su cifra exacta en bytes espera la fuente oficial (Q-47). El ambiente de Pruebas no se usa para pruebas de carga (CTX §49).
- Usage endpoint: ninguno. La salud verifica la disponibilidad del WSDL de cada servicio.
- Internal route prefix: ninguno; el SRI nunca se expone a través de la API propia.
- Error behavior: mensajes con identificador, mensaje, información adicional y tipo, conservados completos junto a la respuesta original. Tratamiento por código en `fiscal-emission.md` y CTX §32.
- Idempotency support: ninguna cabecera. La idempotencia es natural por la clave de acceso: reenviar el mismo XML firmado no crea otro comprobante, mientras que generar otro secuencial o clave sí. Por eso todo resultado ambiguo se reconcilia por la misma clave antes de reenviar (ADR 0005).
- Webhook signature scheme and event ID field: no aplica; el SRI no notifica. La autorización se consulta con backoff, jitter y circuit breaker, hasta 24 horas desde `RECIBIDA` (CTX §23.1, §33).

## Inbound Webhooks

El producto no recibe webhooks en el MVP. Si una integración futura los añade, aplica:

Treat every webhook as untrusted and potentially repeated.

1. Mount the webhook route with `express.raw()` before the JSON middleware, because the signature covers the exact bytes received.
2. Verify the provider signature with a constant-time comparison, and reject on mismatch.
3. Reject events whose timestamp falls outside the provider's tolerance, typically a few minutes, so a captured request cannot be replayed later.
4. Record the provider event ID under a unique constraint. When it already exists, answer success without repeating any effect.
5. Acknowledge quickly with a `2xx`, and do the work in a persisted job.
6. Process idempotently and do not assume ordering. Check the current state before applying the event.

```text
UNIQUE (provider, provider_event_id)
```

## Usage / Quota Gates

When a provider exposes usage or quota endpoints:

- Query usage before starting bulk jobs.
- Block jobs when quota is exhausted.
- Respect provider requests-per-minute limits.
- Surface user-friendly availability state in the UI.
- Keep raw provider tokens and provider internals out of user-facing text unless needed.
