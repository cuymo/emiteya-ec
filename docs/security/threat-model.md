# Threat Model

## Assets

- User data.
- Auth sessions.
- Database credentials.
- External provider tokens.
- Generated files and exports.
- The isolation between tenants.
- Balances, credits, inventory, and other counted values.

## Trust Boundaries

- Browser to API.
- API to database.
- API to external provider.
- External provider webhooks to API.
- Tenant to tenant, inside the same database.
- Background job runner to database.
- CI/deployment to production environment.

## Threats

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Token leakage | Provider abuse | Keep tokens server-side and out of logs. |
| Unauthorized data access | Privacy breach | Enforce auth middleware and permission checks. |
| IDOR / BOLA: editing an ID in the request | Another account's record exposed or changed | Scope every private query by tenant and ownership. See `access-control.md`. |
| Tenant hopping: sending another tenant's ID | Cross-account breach | Resolve the tenant from the session only; composite foreign keys; cross-tenant tests. |
| Role manipulation | Vertical privilege escalation | Server-side role policy; roles never client-writable; no self-promotion. |
| Mass assignment | Tampered role, tenant, or balance | Strict allowlisted schemas for every write. |
| Resource enumeration | Discovery of other accounts' records | `404` outside the tenant; non-sequential public identifiers. |
| Leaked signed URL | File exposure | Short expiry, single-object scope, ownership checked before signing, never logged. |
| Duplicate request: retry, double submit, replay | Double charge or duplicate record | Natural idempotency or scoped idempotency keys. See `../architecture/idempotency.md`. |
| Concurrent writes | Negative balance, oversold stock | Database constraints, guarded updates, transactions, and locks. |
| Webhook replay or forgery | Repeated or forged effects | Signature on the raw body, timestamp tolerance, event ID deduplication. |
| Unvalidated bulk input | Data corruption | Validate, chunk, and report progress. |
| Hand-rolled authentication | Account compromise | Use Better Auth and documented auth middleware. |
| Overprivileged database user | Production data loss | Reduce privileges after migrations. |
| External outage | Workflow failure | Normalize errors and expose retry-safe states. |

## Activos y amenazas del producto

Activos propios del facturador, además de los genéricos:

- Certificado de firma y su contraseña: permiten firmar en nombre del contribuyente.
- Clave maestra de cifrado del certificado.
- Integridad de la numeración: secuenciales y claves de acceso únicos.
- Artefactos fiscales: prueba de largo plazo con datos personales de terceros.
- Ambiente activo: Pruebas frente a Producción.
- XSD, catálogos fiscales y matriz de casos especiales distribuidos con cada release.
- Reloj del servidor, del que depende la validez de la firma.

Límites de confianza adicionales:

- API y job runner hacia los Web Services del SRI.
- Repositorio y release hacia los XSD y los catálogos que se empaquetan.

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Exfiltración del certificado o su contraseña | Suplantación tributaria del contribuyente | Cifrado envolvente con AES-256-GCM, clave de datos por certificado y AAD ligado a empresa y registro; clave maestra fuera de la base de datos; descifrado solo en el adaptador de firma; sin endpoint de lectura; ni logs, ni errores, ni auditoría con el material; el secreto anterior se destruye al reemplazar (ADR 0011). |
| Pérdida o cambio de la clave maestra | Firmas inutilizables | Comprobación de la clave sin descifrar (`key_check`): la firma figura como no disponible y se pide volver a cargarla; respaldo de la clave aparte (R-15). |
| P12 malicioso con un coste de derivación enorme | CPU agotada | Límite de 100 000 iteraciones leído antes de descifrar, tamaño máximo configurable y pool de workers acotado con timeout (ADR 0019). |
| Cambio de ambiente malicioso o accidental | Comprobantes con validez tributaria no deseada | Solo administrador, auditado, con aviso persistente de Pruebas; cada comprobante se envía al endpoint de su ambiente (CTX I-09). |
| Retroceso del secuencial para reutilizar números | Comprobantes duplicados ante el SRI | Solo administrador con motivo y auditoría; unicidad en base de datos; nunca se reutiliza un número (ADR 0003). |
| Alteración de artefactos archivados | Pérdida de valor probatorio | Escritura única, hash SHA-256 verificado en cada lectura (ADR 0010). |
| XSD o catálogo manipulado en el repositorio | XML incorrecto firmado y enviado | Hash en el registro de esquemas, revisión obligatoria de esos archivos, falla cerrada (ADR 0008). |
| Datos personales en logs o volcados SOAP | Exposición de datos de terceros | Redacción por defecto; los logs llevan identificadores y códigos (CTX §47). |
| Interceptación del tráfico con el SRI | Comprobantes alterados o respuestas falsas | TLS con validación estándar, nunca desactivada; respuestas originales conservadas. |
| Desfase o manipulación del reloj | Firmas rechazadas por el SRI | NTP obligatorio y alerta de desviación (CTX §20.5). |
| Clave de acceso usada para consultar comprobantes ajenos | Exposición de datos fiscales | La clave es dato fiscal con control de acceso; las consultas se limitan a la empresa de la sesión (CTX §47). |
| Abuso de la emisión por un usuario autorizado | Consumo de secuenciales o comprobantes indebidos | Roles por operación, límite de tasa en la emisión y auditoría de cada transición. |
