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
- Contraseña del servidor de correo de cada empresa (`add-email-delivery`): permite enviar correo en
  su nombre.
- Direcciones de correo de los receptores: datos personales de terceros, en los terceros y en el
  historial de cada envío.
- Avatar propio de cada usuario (`redesign-account-profile`): un dato personal que solo su dueño
  consulta, por `/api/v1/me/avatar`, sin identificador en la ruta.

Límites de confianza adicionales:

- API y job runner hacia los Web Services del SRI.
- Job runner del correo hacia el servidor SMTP que configura cada empresa.
- Repositorio y release hacia los XSD y los catálogos que se empaquetan.

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Exfiltración del certificado o su contraseña | Suplantación tributaria del contribuyente | Cifrado envolvente con AES-256-GCM, clave de datos por certificado y AAD ligado a empresa y registro; clave maestra fuera de la base de datos; descifrado solo en el adaptador de firma; sin endpoint de lectura; ni logs, ni errores, ni auditoría con el material; el secreto anterior se destruye al reemplazar (ADR 0011). |
| Pérdida o cambio de la clave maestra | Firmas inutilizables | Comprobación de la clave sin descifrar (`key_check`): la firma figura como no disponible y volver a cargar el mismo P12 restablece su custodia con la clave configurada; respaldo de la clave aparte (R-15) y sustitución con el procedimiento probado de `deployment.md`. |
| P12 malicioso con un coste de derivación enorme | CPU agotada | Techo de 131 072 iteraciones por contador (MAC y cada cifrado), leído antes de descifrar. Un archivo con muchos contenidos cifrados pasa el techo: su coste total lo acotan el timeout del pool criptográfico, el tamaño máximo configurable y la concurrencia del pool. Riesgo residual: un administrador autenticado puede ocupar un worker hasta el timeout por carga (ADR 0019, «Techo de iteraciones»). |
| Cambio de ambiente malicioso o accidental | Comprobantes con validez tributaria no deseada | Solo administrador, auditado, con aviso persistente de Pruebas; cada comprobante se envía al endpoint de su ambiente (CTX I-09). |
| Retroceso del secuencial para reutilizar números | Comprobantes duplicados ante el SRI | Solo administrador con motivo y auditoría; unicidad en base de datos; nunca se reutiliza un número (ADR 0003). |
| Alteración de artefactos archivados | Pérdida de valor probatorio | Escritura única, hash SHA-256 verificado en cada lectura (ADR 0010). |
| XSD o catálogo manipulado en el repositorio | XML incorrecto firmado y enviado | Hash en el registro de esquemas, revisión obligatoria de esos archivos, falla cerrada (ADR 0008). |
| Datos personales en logs o volcados SOAP | Exposición de datos de terceros | Redacción por defecto; los logs llevan identificadores y códigos (CTX §47). |
| Interceptación del tráfico con el SRI | Comprobantes alterados o respuestas falsas | TLS con validación estándar, nunca desactivada; respuestas originales conservadas. |
| Desfase o manipulación del reloj | Firmas rechazadas por el SRI | NTP o equivalente obligatorio en la infraestructura, con evidencia operativa fuera de la aplicación (CTX §20.5; `../architecture/deployment.md`). |
| Clave de acceso usada para consultar comprobantes ajenos | Exposición de datos fiscales | La clave es dato fiscal con control de acceso; las consultas se limitan a la empresa de la sesión (CTX §47). |
| Abuso de la emisión por un usuario autorizado | Consumo de secuenciales o comprobantes indebidos | Roles por operación, límite de tasa en la emisión y auditoría de cada transición. |
| Toma de una cuenta con la recuperación por correo | Acceso a la empresa con la identidad de otro usuario | El enlace llega solo al correo de la cuenta, sirve una vez, vence en 30 minutos y su token se guarda con hash; viaja en el fragmento de la dirección, fuera de los registros y del `Referer`. La respuesta y su tiempo son los mismos exista o no la cuenta, hay límites por correo e IP, y restablecer cierra todas las sesiones (`add-password-reset-by-email`). El riesgo que queda es el del buzón del usuario. |
| Exfiltración de la contraseña SMTP | Correo enviado en nombre de la empresa | El mismo sobre AES-256-GCM que la firma, con AAD ligado a la empresa; nunca se devuelve ni se registra; la auditoría solo dice que cambió (`add-email-delivery`, design D9). |
| Inyección de cabeceras en el correo | Destinatarios o contenido alterados | Remitente, servidor y usuario sin saltos de línea (contrato y CHECK); el asunto quita los saltos de los textos del snapshot; el HTML se escapa; las direcciones se validan una por una. |
| Servidor SMTP malicioso o interceptado | Credenciales robadas o correo alterado | TLS directo o STARTTLS con el certificado verificado y TLS 1.2 o superior; sin un certificado válido no se envían las credenciales; sin cifrado solo en el buzón de pruebas local. |
| Uso del servidor SMTP configurable para sondear la red | Conexiones a servicios internos | Solo el administrador lo configura, con auditoría; la API no tiene salida sin el override explícito; el firewall del host limita la salida al servidor y al puerto SMTP; el correo de prueba tiene un límite por minuto. |
| Comprobantes de Pruebas enviados a clientes reales | Confusión sobre su validez | En Pruebas el correo va solo al correo de prueba configurado, con el asunto marcado «PRUEBAS – sin validez tributaria». |
| Envío masivo por un usuario autorizado | Spam en nombre de la empresa | Reenvío solo de comprobantes autorizados, de 1 a 10 direcciones, idempotente por clave y auditado con sus direcciones. |
