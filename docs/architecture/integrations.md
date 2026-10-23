# Integrations

## External Services

| Service | Purpose | Auth | Owner |
| --- | --- | --- | --- |
| SRI — Recepción | Recibir el comprobante firmado: `RECIBIDA` o `DEVUELTA`. | Ninguna; el XML va firmado con el certificado del contribuyente. | Adaptador SOAP propio de `sri-engine` (ADR 0018) |
| SRI — Autorización | Consultar por clave de acceso: en procesamiento, `AUTORIZADO` o no autorizado (`NO AUTORIZADO` o `RECHAZADO`, ficha v2.34, §7.2.3). Es también la consulta por clave con que se reconcilia. | Ninguna. | Adaptador SOAP propio de `sri-engine` |
| SRI — Consulta de validez | `ConsultaComprobante`: guarda de la reconciliación antes de un reenvío; un estado informado impide reenviar (design D15 de `add-sri-transmission`). Nunca observa anulaciones: eso es una capacidad futura (Q-16). | Ninguna. | Adaptador SOAP propio de `sri-engine` |
| SMTP de la empresa | Entrega por correo del XML y el RIDE de cada comprobante autorizado (`add-email-delivery`; Q-24 decidió el 2026-10-04 dejarlo para P1). | Usuario y contraseña SMTP de cada empresa, cifrada en reposo. | Transporte nodemailer del módulo `email` (ADR 0029) |

## Integration Rules

- Tokens stay server-side.
- Use typed payloads at boundaries.
- Normalize provider errors before exposing them internally.
- Avoid provider names in user-facing UI unless necessary.
- Document rate limits and usage gates.
- Use Axios for server-side external API calls; excepción: el adaptador SOAP del SRI usa el `fetch` nativo de Node, solo en infraestructura (ADR 0018, enmienda del transporte). El correo usa SMTP, no HTTP, con nodemailer en la infraestructura del módulo `email` (ADR 0029).
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
- Docs: ficha técnica off-line v2.34 (CTX SRI-02) y WSDL vigentes, con copia de los WSDL de Pruebas en `docs/product/sri-wsdl/`; prevalecen en el orden de CTX §1.
- Auth: ninguna en el transporte. TLS estándar del runtime, sin certificados ni fingerprints fijados, porque el SRI puede cambiarlos (CTX §7.5).
- Protocol: SOAP, con un adaptador propio sobre el `fetch` nativo de Node (ADR 0018, enmienda del transporte). Recepción `validarComprobante(xml firmado)` y autorización `autorizacionComprobante(claveAcceso)`, que también sirve para reconciliar por clave. La consulta de validez `consultarEstadoAutorizacionComprobante(claveAcceso)` solo es la guarda de la reconciliación antes de un reenvío (design D15 de `add-sri-transmission`); observar anulaciones es la capacidad futura Q-16. `ConsultaFactura` tiene otro contrato y queda fuera del MVP (CTX §25). El adaptador captura la respuesta original antes de normalizarla (CTX §44).
- Timeout: hasta las cabeceras (`SRI_REQUEST_TIMEOUT_MS`) y de lectura del cuerpo (`SRI_BODY_TIMEOUT_MS`), separados y configurables; la conexión usa el plazo interno de Node. Son configuración operativa, no una regla normativa del SRI (`deployment.md`).
- Retries: el envío solo se reintenta si el fallo demuestra que la solicitud no salió (`NOT_SENT`: DNS, conexión rechazada, plazo de conexión o certificado TLS no confiable). Cualquier otro fallo pudo ocurrir después de enviar y se reconcilia por la clave. Las consultas se repiten con backoff y jitter, y un circuit breaker por servicio y ambiente pausa las llamadas tras fallos seguidos.
- Rate limit: sin cuota publicada. Un comprobante por envío, sin lotes, dentro de la política conservadora de tamaño de EmiteYa (CTX §29; Q-47 resuelta por política de producto): menos de 40 000 bytes en el XML firmado, su base64 y el SOAP, en Pruebas y Producción, sin afirmar que sea el límite del SRI. El ambiente de Pruebas no se usa para pruebas de carga (CTX §49).
- Usage endpoint: ninguno. La readiness no llama al SRI: con la transmisión habilitada comprueba sus precondiciones (workers y endpoints válidos); la política de tamaño siempre existe y no es una precondición. La disponibilidad del SRI se ve en `sri_circuit_open` y `sri_attempts_total`.
- Switch: `SRI_TRANSMISSION_ENABLED`, apagado por defecto; se habilita tras las compuertas de `../quality/sri-certification.md`.
- Política de tamaño: `PRODUCT_CONSERVATIVE_POLICY_V1`, una constante del código sobre el cuerpo exacto de la recepción. Un comprobante que la excede se detiene antes de la red con `TRANSMISSION_SIZE_POLICY_EXCEEDED`. No hay sesión de certificación ni bandera.
- Internal route prefix: ninguno; el SRI nunca se expone a través de la API propia.
- Error behavior: mensajes con identificador, mensaje, información adicional y tipo, conservados completos junto a la respuesta original, que se guarda antes de clasificarla (`sri_attempt` y `sri_response`). Tratamiento por código en `fiscal-emission.md` y CTX §32.
- Idempotency support: ninguna cabecera. La idempotencia es natural por la clave de acceso: reenviar el mismo XML firmado no crea otro comprobante, mientras que generar otro secuencial o clave sí. Por eso todo resultado ambiguo se reconcilia por la misma clave antes de reenviar (ADR 0005).
- Webhook signature scheme and event ID field: no aplica; el SRI no notifica. La autorización se consulta con backoff, jitter y circuit breaker dentro de la ventana de conclusión, 24 horas desde la primera evidencia de recepción por defecto (`SRI_CONCLUSION_WINDOW_HOURS`; CTX §23.1, §33).

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
