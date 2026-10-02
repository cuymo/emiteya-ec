# Design

## Context

Ver `proposal.md` (Why) y las specs `signing-certificate`, `taxpayer-setup` y `audit-trail` de
este cambio.

Estado que condiciona el diseño:

- **Decisiones aceptadas el 2026-10-02:**
  - ADR 0011 fija la custodia: metadatos y secreto por separado, cifrado envolvente, versión de la clave maestra, arranque fallido en producción sin clave y destrucción del secreto al reemplazar.
  - Q-17 fija la identidad: sin RUC detectable no se firma; un RUC distinto solo advierte.
  - ADR 0013 fija los parámetros de firma de la ficha (RSA-SHA1, clave de 2048 bits, PKCS#12).
- **Lo que dejó `add-taxpayer-setup`:**
  - la preparación para emitir ya consulta un puerto de firma, `SigningCertificateReadiness.isMet(companyId)`, que hoy siempre responde pendiente;
  - el RUC vigente de la empresa está en la versión vigente de su configuración (`configs.findCurrent`).
- **Cuerpo de las peticiones.** Express parsea JSON con un límite global de 100 KB antes del router de la API. `pino-http` no registra cuerpos ni cabeceras, y `pino` redacta `password`, `token` y `secret`.
- **Lectura de PKCS#12.** Node.js no trae un lector de PKCS#12. OpenSSL 3 rechaza sin el proveedor legado los P12 cifrados con RC2 o 3DES, habituales en entidades certificadoras. La librería se elige en el spike S-6 (D15), que es el gate previo a `/opsx:apply`.

## Goals / Non-Goals

**Goals:**

- Que una filtración de la base de datos, de los logs o de un error no exponga nunca el archivo, la contraseña ni la clave privada.
- Que el cambio de emisión solo tenga que abrir el secreto y firmar: aceptar una firma ya garantiza que se abre, firma con los parámetros de la ficha y tiene RUC.
- Que la preparación para emitir y el aviso de vencimiento se calculen al leer, sin jobs.

**Non-Goals:**

- Abrir el secreto fuera de la operación de firma: este cambio solo lo cifra (D5).
- Validar la confianza de la cadena o la revocación: el SRI lo hace y su rechazo es de `add-sri-transmission`.
- Historial navegable de firmas reemplazadas: sus metadatos se conservan y la auditoría los cuenta (P3).
- Rotación de la clave maestra (requisito del go-live, ADR 0011).

## Decisions

### Brief de operaciones sensibles

| # | Pregunta | Respuesta |
| --- | --- | --- |
| 1 | Quién ejecuta | Cargar, reemplazar, consultar metadatos y fijar la anticipación: `ADMIN`. Consultar la vigencia: `ADMIN` y `OPERATOR` (D10). |
| 2 | Tenant del llamante | `RequestContext.companyId`. |
| 3 | Tenant del recurso | `company_id` de los metadatos, del secreto y de la anticipación. |
| 4 | Validación de propiedad | Las rutas no llevan identificadores: siempre operan sobre la firma de la empresa de la sesión. El valor esperado se compara con la firma vigente de esa empresa. |
| 5 | ¿Cambiar un ID alcanza otra cuenta? | No hay ID de recurso en la ruta. Un `companyId` en el cuerpo se rechaza por el esquema estricto. |
| 6 | Petición repetida | Cargar otra vez la firma vigente (misma huella) no cambia nada ni audita. Fijar la misma anticipación tampoco. |
| 7 | Peticiones simultáneas | Lock advisory por empresa en la transacción, valor esperado de la firma vigente e índice único parcial de una firma `ACTIVE` por empresa (D7). |
| 8 | Idempotencia | Por estado deseado (huella) y valor esperado. |
| 9 | Restricciones | Índice único parcial; claves foráneas compuestas por empresa; metadatos sin borrado y solo con la transición `ACTIVE` → `REPLACED`; secreto sin actualización; `CHECK` de la anticipación (D2). |
| 10 | Auditoría | Carga, reemplazo y anticipación, en la misma transacción y solo con metadatos (D11). |
| 11 | Pruebas de autorización | Operador: `403` en carga, consulta completa y anticipación, y `200` en la vigencia. Una empresa B no ve nada de la empresa A. |
| 12 | Fugas | Respuestas, errores, logs, auditoría y métricas sin bytes, contraseña ni clave privada. Una prueba busca los secretos de los fixtures en todas esas salidas y en la base de datos sin cifrar (D16). |

### D1. Módulo `signing`

Módulo nuevo en `backend/src/modules/signing/`, con dominio, aplicación e infraestructura como
`taxpayer` y `fiscal`. Aquí vivirá también el adaptador XAdES de `add-invoice-emission`
(ADR 0013), que será el único que abra el secreto.

- **Usa de otros módulos:** el `Authorizer` de `identity`, la auditoría de `audit` y la lectura del RUC vigente de `taxpayer`.
- **Ofrece a `taxpayer`:** la implementación de `SigningCertificateReadiness`, que `main.ts` inyecta en `taxpayerRouters`.

### D2. Modelo e invariantes

Tres tablas:

- **`signing_certificate` (metadatos):**
  - identificación: `id`, `company_id`, `status` (`ACTIVE` o `REPLACED`);
  - certificado: `subject` (titular), `issuer`, `serial_number`, `fingerprint_sha256`, `not_before`, `not_after`, `detected_ruc`, `key_algorithm`, `key_bits`;
  - historia: `uploaded_by`, `created_at`, `replaced_at`, `replaced_by_id`.
  - Restricciones:
    - índice único parcial `(company_id) WHERE status = 'ACTIVE'`;
    - `UNIQUE (company_id, id)` como destino de la clave compuesta;
    - un trigger impide borrar e impide cambiar nada salvo la transición `ACTIVE` → `REPLACED` con `replaced_at` y `replaced_by_id`.
- **`signing_certificate_secret` (secreto):**
  - `certificate_id` (PK), `company_id`, `format_version`, `key_version`, `key_check`;
  - la clave de datos envuelta con su nonce;
  - el P12 cifrado y la contraseña cifrada, cada uno con su nonce;
  - `created_at`.
  - Restricciones:
    - clave foránea compuesta `(company_id, certificate_id)` a los metadatos;
    - un trigger impide `UPDATE`: reemplazar es borrar el secreto anterior e insertar el nuevo;
    - el borrado está permitido: es la destrucción intencional del ADR 0011, como excepción a la escritura única de los ADR 0010 y 0017.
- **`signing_certificate_settings`:** `company_id` (PK), `expiry_alert_days` con `CHECK BETWEEN 1 AND 90`. Sin fila, vale 30.

Estados:

- **Persistidos:** `ACTIVE` (la firma vigente) y `REPLACED`.
- **Derivados al leer** (D8):
  - vigencia: `VALID`, `EXPIRING`, `EXPIRED` o `KEY_UNAVAILABLE`, y `NONE` sin firma;
  - coincidencia del RUC: `MATCH`, `MISMATCH` o `PENDING` sin RUC de la empresa.
- **Incompatible (sin RUC detectable)** no llega a persistirse: la carga se rechaza (D4).
  - Q-17 admitía conservarla para diagnóstico. Se descarta porque una carga incompatible desplazaría a una firma vigente utilizable y guardaría un secreto que no sirve.
  - El rechazo devuelve titular y emisor para el diagnóstico, sin guardar nada.

### D3. Validación de la carga

`PUT /api/v1/signing-certificate` recibe JSON `{ file, password, expectedCurrentId }`:

- `file` es el P12 en base64, de 1 B a 64 KiB decodificado. Cabe en el límite global de 100 KB.
- `password` es una cadena de 1 a 256 caracteres, sin recortar ni normalizar: es exactamente lo que abre el archivo.
- `expectedCurrentId` es la firma vigente que el administrador ve, o `null`.
- El esquema es estricto.

Se descarta `multipart/form-data`: exigiría una dependencia más y separaría la contraseña del archivo en el parseo, sin ganar nada para archivos de pocos KB.

Pasos de la validación, antes de abrir la transacción porque es trabajo de CPU sin I/O:

1. Decodificar y abrir con la contraseña, con el puerto `CertificateReader` cuya implementación elige el spike. Errores posibles:
   - `400 CERTIFICATE_UNREADABLE` si no es un PKCS#12;
   - `400 CERTIFICATE_PASSWORD_INVALID` si la contraseña no lo abre (falla el MAC o el descifrado).
2. Comprobar la clave: debe haber una clave privada RSA de al menos 2048 bits que corresponda al certificado. La prueba es una firma con RSA-SHA1, el algoritmo de la ficha (ADR 0013), verificada con la clave pública del certificado. Si falla: `400 CERTIFICATE_KEY_UNSUPPORTED`.
3. Comprobar la vigencia con el reloj del servidor, `notBefore <= ahora <= notAfter`. Si falla: `400 CERTIFICATE_NOT_VALID_NOW`, con las fechas.
4. Detectar el RUC (D4). Si no se detecta: `400 CERTIFICATE_RUC_NOT_FOUND`, con titular y emisor.
5. Cadena: los certificados adicionales del P12 deben poder leerse (CTX §20.6). No se valida la confianza.

Los mensajes nunca incluyen la contraseña ni contenido del archivo. El error de la librería se
traduce a uno de estos códigos y su texto original no sale del adaptador.

### D4. Detección del RUC

- El RUC se busca solo en los lugares que documentan las entidades certificadoras soportadas: atributos del sujeto o extensiones con su OID.
- La tabla de ubicaciones vive en el módulo y la completa el spike S-6 a partir de las políticas de certificación publicadas.
- El valor encontrado debe pasar la validación de RUC de `packages/contracts`: trece dígitos, terminación y dígito verificador.
- No se buscan cadenas de trece dígitos en cualquier campo, porque daría falsos positivos.
- Un certificado de una entidad no soportada, o sin RUC, se rechaza con un mensaje que lo dice. Añadir una entidad es añadir una fila a la tabla, con su prueba.
- La coincidencia con la empresa se calcula al leer, contra el RUC vigente de `configs.findCurrent`: el RUC de la empresa puede corregirse mientras no esté bloqueado (Q-31).

### D5. Custodia y formato cifrado

Una abstracción única, `CertificateVault`, es el único código que cifra. Sus operaciones:

- `seal(material, binding)` cifra el material para guardarlo;
- `open(sealed, binding)` lo descifra. En este cambio solo lo usan las pruebas; lo usará el adaptador de firma;
- `canOpen(sealed)` dice si el secreto puede abrirse, sin descifrarlo.

Formato 1:

- **Clave de datos:** 32 bytes aleatorios por certificado (`crypto.randomBytes`).
- **P12 y contraseña:** cada uno se cifra con AES-256-GCM y la clave de datos, con nonce aleatorio de 12 bytes y etiqueta de 16. El AAD liga el texto cifrado a su registro: `signing-certificate|1|<company_id>|<certificate_id>|p12` o `|password`. Copiar un secreto a otra empresa o a otro registro hace fallar el descifrado.
- **Envoltura:** la clave de datos se cifra con la clave maestra, también con AES-256-GCM. El AAD lleva la versión de la clave.
- **Columnas:** se guardan `format_version = 1` y `key_version`.
- **Comprobación sin descifrar:** se guarda también `key_check = HMAC-SHA256(clave maestra, "signing-certificate-key-check|<key_version>")`. Permite saber si la clave configurada es la que envolvió el secreto sin descifrar nada; `canOpen` y la vigencia (D8) la usan.
- **Rotar más adelante** será volver a envolver la clave de datos con la clave nueva, sin volver a cifrar el P12. El anillo de claves admite varias versiones desde ahora, aunque hoy se configure una.
- **Memoria:** el material en claro se guarda en `Buffer`, que se sobrescribe con ceros tras usarlo, en la medida en que Node lo permite. El tipo secreto redefine `toJSON` e `inspect` para que nunca se serialice.

### D6. Configuración de la clave maestra

Variables nuevas, validadas en `config/env.ts` al arrancar:

- `CERTIFICATE_CUSTODY`: `enabled` (por defecto) o `disabled`.
- `CERTIFICATE_MASTER_KEY` o `CERTIFICATE_MASTER_KEY_FILE`, exactamente una: 32 bytes en base64, o la ruta del archivo que los contiene.
- `CERTIFICATE_MASTER_KEY_VERSION`: identificador corto, `1` por defecto.

Reglas:

- En producción no arranca si `CERTIFICATE_CUSTODY = disabled`, si falta la clave, si no decodifica a 32 bytes, si el archivo no se puede leer, o si es la clave de ejemplo de `.env.example`.
- Los mensajes nombran la variable y el problema, nunca el valor, como el resto de `loadEnv`.
- En desarrollo, `.env.example` trae una clave de ejemplo explícita. En pruebas, el arnés configura una clave generada o el modo `disabled` de forma expresa.
- El modo `disabled` nunca se activa por omisión: con la variable ausente vale `enabled`, y entonces la clave es obligatoria.
- Con `disabled`, la carga responde `409 CERTIFICATE_CUSTODY_DISABLED` y la firma nunca es utilizable.

### D7. Reemplazo y concurrencia

1. Se valida el P12 (D3) fuera de la transacción.
2. En la transacción se toma `pg_advisory_xact_lock` sobre `signing-certificate:<company_id>` y se lee la firma `ACTIVE`.
3. Si su huella es la de la carga, se responde `200` con `unchanged: true`, sin escribir ni auditar: el estado deseado ya existe.
4. Si su `id` difiere de `expectedCurrentId`, se responde `409 CERTIFICATE_CHANGED`.
5. Si no, en la misma transacción:
   - la firma anterior pasa a `REPLACED`;
   - se borra su secreto;
   - se insertan los metadatos nuevos y su secreto;
   - se registra el evento de auditoría.

Dos reemplazos simultáneos sobre la misma firma se serializan en el lock: el segundo ve otra
firma vigente y recibe `409`. El índice único parcial es la última defensa. Si la auditoría
falla, la transacción revierte y la firma anterior conserva su secreto.

La anticipación (`PUT .../expiry-alert`) es un estado deseado: el mismo valor no escribe ni
audita.

### D8. Vigencia, utilizable y aviso

Todo se calcula al leer, con el reloj del servidor:

- **`EXPIRED`** si `ahora > notAfter`.
- **`KEY_UNAVAILABLE`** si el secreto no puede abrirse con la clave configurada (`canOpen` falso: falta la versión o no coincide `key_check`), o si la custodia está deshabilitada.
- **`EXPIRING`** si quedan menos días que la anticipación. Los días que faltan son `ceil((notAfter − ahora) / 1 día)`.
- **`VALID`** en el resto de casos.
- **Utilizable** significa `VALID` o `EXPIRING`. `SigningCertificateReadiness.isMet` devuelve eso, y la emisión consultará lo mismo antes de firmar.

Sin un estado `EXPIRED` persistido no hace falta un job que lo marque, y la preparación para
emitir cambia sola al vencer la firma. Al arrancar, si la firma vigente de alguna empresa no
puede abrirse con la clave configurada, se registra un error sin secretos.

### D9. API

| Ruta | Permiso | Respuesta |
| --- | --- | --- |
| `GET /api/v1/signing-certificate` | `certificate.read` | `{ certificate, expiryAlertDays }`. `certificate` es `null` o lleva: titular, emisor, serie, huella, vigencia, RUC detectado, coincidencia de RUC con el RUC de la empresa, estado derivado, días que faltan, utilizable y fecha de carga. |
| `GET /api/v1/signing-certificate/validity` | `certificateValidity.read` | `{ state, usable, notAfter, daysToExpiry }`, con `state = NONE` sin firma. |
| `PUT /api/v1/signing-certificate` | `certificate.manage` | `{ certificate, unchanged }`. |
| `PUT /api/v1/signing-certificate/expiry-alert` | `certificate.manage` | `{ expiryAlertDays }`; el cuerpo es `{ days }`. |

Errores de la carga (D3), `409 CERTIFICATE_CHANGED`, `409 CERTIFICATE_CUSTODY_DISABLED`, y `400`
para una anticipación fuera de rango. Contratos en `packages/contracts/src/signing-certificate.ts`,
publicados en OpenAPI.

### D10. Permisos

- **`certificate.read`:** solo `ADMIN`.
- **`certificate.manage`:** solo `ADMIN`.
- **`certificateValidity.read`:** `ADMIN` y `OPERATOR`. Es la fila "solo su vigencia" de la matriz propuesta en `access-control.md`, que este cambio confirma.

### D11. Auditoría

Acciones nuevas:

- `signing_certificate.loaded` (primera firma);
- `signing_certificate.replaced`;
- `signing_certificate.expiry_alert_changed`.

`changes` lleva los metadatos de la firma anterior (en el reemplazo) y de la nueva: titular,
emisor, serie, huella, vigencia, RUC detectado y coincidencia con el RUC de la empresa en ese
momento. Para la anticipación, el valor anterior y el nuevo. Nada secreto. El evento va en la
misma transacción.

### D12. Preparación para emitir

`signing` implementa `SigningCertificateReadiness`. El contrato de `GET /company/status` no
cambia: el requisito sigue siendo `MET` o `PENDING`, y la pantalla de la firma y el aviso explican
el motivo. En Inicio, el requisito de firma pendiente lleva la acción "Cargar la firma
electrónica" (solo administradores) a la pantalla nueva.

### D13. Observabilidad

- **Logs:** solo id y huella de la firma. Se añaden a la redacción `file` y `*.file`. Una prueba captura el logger durante cargas válidas y rechazadas y busca la contraseña, el base64 y los marcadores PEM.
- **Métricas:** gauges `signing_certificate_days_to_expiry` y `signing_certificate_usable` (CTX §48), calculados al consultar `/metrics` con una lectura de metadatos, sin descifrar.
- **Error de arranque:** el del final de D8.

### D14. Interfaz: `Firma electrónica`

Destino nuevo en `Configuración`, solo para administradores (`certificate.read`), en
`/configuracion/firma`.

| Pregunta | Respuesta |
| --- | --- |
| Usuario | Administrador. |
| Objetivo | Tener una firma utilizable para emitir y saber cuándo renovarla. |
| Decisión principal | Si cargar o reemplazar la firma. |
| Información mínima | Estado (utilizable, por vencer, vencida, no disponible), vencimiento y días que faltan, titular, RUC detectado y su coincidencia, emisor. |
| Acción principal | `Cargar firma`, o `Reemplazar firma` con una firma vigente. |
| Frecuencia y riesgo | Rara (una o dos veces al año); riesgo alto: sin firma utilizable no se emite. |

- **P0:** estado con `StatusBadge`, vencimiento y la acción principal.
- **P1:**
  - titular, RUC detectado y la advertencia de RUC distinto, presentada como comprobación preventiva y no como error del SRI;
  - anticipación del aviso, editable en línea con un campo numérico y "Guardar".
- **P2:** emisor, número de serie y fecha de carga.
- **P3:** huella y firmas reemplazadas, fuera.

**Diálogo `Cargar firma` o `Reemplazar firma`** (`FormDialog`):

- campos: `FileField` para `.p12` y `.pfx`, con tamaño máximo; `PasswordField`;
- al reemplazar, una línea con la firma que se sustituye;
- errores:
  - contraseña incorrecta, en el campo de contraseña;
  - archivo ilegible, clave no compatible o vigencia, en el campo de archivo;
  - RUC no encontrado, en el cuerpo del diálogo, con titular y emisor;
  - conflicto, con `Recargar`.
- Se envía una sola vez. La contraseña se borra del formulario al cerrar.

**Aviso en el shell**, para todos los roles con `certificateValidity.read`:

- **Por vencer:** "La firma electrónica vence el 12/11/2026 (faltan 9 días)."
- **Vencida o no disponible:** "La firma electrónica venció el …: no se puede emitir." o "…no está disponible: vuelve a cargarla."
- El administrador ve el enlace a la pantalla; el operador ve a quién pedírselo.
- Es una condición persistente, así que va como franja, igual que el aviso de Pruebas.

**Estados de la pantalla:**

- esqueleto;
- vacío: "Carga la firma electrónica para poder emitir", con la acción;
- error con reintento;
- sin permiso;
- móvil con objetivos de 44 px;
- ambos temas;
- checklist de frontend.

Toda mutación pasa por `useMutationFeedback`.

### D15. Spike S-6: compatibilidad PKCS#12 y custodia (gate previo a `/opsx:apply`)

Es el gate previo a `/opsx:apply`: se hace en un workspace temporal o en una rama que no se
fusiona, con timebox de 1 día, y termina con un ADR de dependencia y el estado de S-6 en
`open-questions.md`.

- **Candidatos:**
  - un parser en JavaScript puro (por ejemplo, `node-forge`);
  - uno sobre WebCrypto (`pkijs`);
  - el binario `openssl` del contenedor detrás del mismo puerto.
- **Entorno:** Node LTS, sin flags del proveedor legado de OpenSSL y sin red.
- **Fixtures sintéticos,** generados por un script con `openssl` o la propia librería, nunca certificados reales:
  1. P12 moderno: PBES2 con AES-256-CBC, PBKDF2 y MAC SHA-256 (el formato por defecto de OpenSSL 3).
  2. P12 legado: `pbeWithSHAAnd3-KeyTripleDES-CBC` para la clave, RC2-40 para los certificados y MAC SHA-1.
  3. Contraseña correcta e incorrecta, incluida una con caracteres no ASCII.
  4. Certificado vigente, vencido y todavía no vigente.
  5. Certificados con el RUC en las ubicaciones documentadas por las entidades que se decidan soportar, otro sin RUC y otro con trece dígitos inválidos.
  6. P12 sin clave privada, con una clave que no corresponde, con una clave EC y con RSA de 1024 bits.

**Criterios de éxito**, todos con cada fixture:

1. Abre los formatos moderno y legado, y falla con una contraseña incorrecta sin revelarla.
2. Extrae el X.509, la clave privada y los metadatos de D2; distingue vigente, vencido y no vigente; y firma con RSA-SHA1 verificable con el certificado.
3. Extrae el RUC donde está documentado y detecta su ausencia y los inválidos.
4. Recorre el ciclo completo de D5 sobre PostgreSQL con `key_version`: cifrar, persistir, descifrar y reemplazar, con la eliminación del secreto anterior. Falla al descifrar con otra clave o con el AAD de otra empresa.
5. Con el logger en `trace`, ninguna salida de log, error ni evento contiene la contraseña, el base64, bytes del P12 ni marcadores PEM.

**Si falla un criterio:** se prueba el siguiente candidato. Si ninguno abre el formato legado sin
el proveedor legado, se escribe un ADR de desviación.

**P12 reales:** un P12 sintético prueba la compatibilidad de formato, no la de certificados reales
ecuatorianos. Si el dueño del producto aporta uno:

- se usa solo como fixture local y temporal;
- nunca se commitea ni se copia a OpenSpec o a la documentación;
- su contraseña no se registra;
- se documentan la entidad, sus características técnicas (algoritmos, ubicación del RUC) y el resultado.

Sin ese P12 real, la validación queda como requisito del go-live (`definition-of-done.md`).

### D16. Pruebas

- **Fixtures:** las pruebas generan los P12 sintéticos al ejecutarse con el script del spike. No se commitean claves privadas, aunque sean de prueba.
- **Sin fugas:** una prueba de integración busca la contraseña y el base64 de cada fixture en las respuestas, los errores, el logger capturado, la tabla de auditoría y los volcados en claro de las tablas, y confirma que el secreto guardado no contiene ninguno de los dos.

### D17. Datos y migración

- Una migración crea las tres tablas, el índice parcial y los triggers.
- No hay datos que migrar.
- **Despliegue:** en producción hay que configurar la clave maestra antes de actualizar, o el backend no arranca (BREAKING de instalación). La clave se respalda aparte de la base de datos (`deployment.md`, R-15).
- **Marcha atrás:** revertir la versión deja las tablas sin uso. Las firmas cargadas habría que volver a cargarlas si se borran las tablas.

## Risks / Trade-offs

- [Ningún lector abre los P12 legados sin el proveedor legado] → El spike S-6 es el gate. Si falla, el binario `openssl` o un ADR de desviación.
- [Falsos negativos de RUC con entidades no contempladas] → Ubicaciones documentadas por entidad, mensaje explícito con titular y emisor, una fila más por entidad y el P12 real como requisito del go-live.
- [Pérdida o cambio de la clave maestra] → `key_check` lo detecta sin descifrar, la firma figura como no disponible, se pide volver a cargarla y se registra al arrancar (R-15).
- [Reloj del servidor desviado] → La vigencia usa el reloj del servidor. NTP y su vigilancia son requisito de instalación (CTX §20.5, `deployment.md`).
- [Contraseña en el cuerpo JSON] → Ni `pino-http` ni el manejador de errores registran cuerpos, y la redacción cubre `password` y `file`. La prueba de fugas lo verifica.
- [Material en claro en memoria] → Vida mínima, sobrescritura con ceros en la medida de lo posible y nunca en logs.
- [Una sola clave maestra por instalación] → Basta para una empresa por instancia (ADR 0009). La versión permite rotarla después.
