# Observability

## Required Signals

- Application health.
- Request latency and errors.
- Background job status.
- External service failures.
- Authentication failures.
- Import/export progress when applicable.

## Audit Trail

Record an audit entry for critical actions: permission and role changes, financial
movements, deletions, exports, shares, API key and integration changes, and access to
sensitive records.

```text
user_id  tenant_id  operation  resource_type  resource_id  timestamp  request_id  ip  result
```

- Write the entry in the same transaction as the action when the action is a database write, so neither exists without the other.
- Record denied attempts as well as successful ones; a burst of `404` and `403` across many IDs is an enumeration signal.
- Audit entries are append-only for application code.
- Never record passwords, full tokens, secret keys, signed URLs, complete financial data, or sensitive values the investigation does not need.
- Expose the trail only through permission-gated audit views, as `../architecture/frontend.md` requires.

### En este proyecto: rastro de auditoría y eventos de seguridad

El proyecto separa dos conceptos que la plantilla agrupa:

| Concepto | Qué registra | Empresa | Almacenamiento | Retención |
| --- | --- | --- | --- | --- |
| Rastro de auditoría del tenant | Cambios exitosos de un actor conocido: administración de accesos y, en cambios futuros, configuración tributaria, firma, secuenciales y comprobantes (ERS RF-003, SEC-007). | Siempre conocida | Tabla de solo agregado en PostgreSQL, escrita en la misma transacción que la acción | Indefinida, como evidencia |
| Eventos de seguridad | Inicios de sesión fallidos, cuentas inexistentes, límites de intentos alcanzados y denegaciones de autorización, aunque el actor sea conocido. | Opcional: puede no existir | Logs estructurados y métricas; no se guardan en el rastro de auditoría | La del sistema de logs del operador; por defecto se propone 90 días |

- Los intentos denegados se registran como eventos de seguridad, no en el rastro de auditoría: siguen siendo revisables y detectan enumeraciones, sin llenar de ruido una tabla inmutable.
- El rastro de auditoría no guarda direcciones IP. Ni el ERS ni CTX las exigen, y una tabla inmutable no permite borrarlas.
- Better Auth guarda por defecto la IP en cada sesión; el proyecto la anula al crear la sesión, y el estado del límite de intentos vive en memoria, de modo que ninguna IP se persiste en la base de datos.
- Los eventos de seguridad pueden incluir la IP del cliente para limitar intentos y detectar abusos. Detrás de un proxy, la IP se toma de `X-Forwarded-For` solo si viene de un proxy declarado de confianza; si no, se usa la del socket. Nunca se confía en la cabecera de un cliente directo.
- Si en el futuro una IP debe persistirse fuera de los logs, se documentan antes su propósito, ubicación, retención y base legal.

## Logging Rules

- Do not log secrets.
- Do not log full sensitive payloads.
- Include stable identifiers for debugging.
- Make error messages actionable for operators and agents.

