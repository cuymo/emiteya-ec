# Design

## Context

Ver `proposal.md` (Why) y las specs `signing-certificate`, `taxpayer-setup` y `audit-trail` de
este cambio.

Estado que condiciona el diseño:

- **Decisiones aceptadas el 2026-10-02:**
  - ADR 0011 fija la custodia: metadatos y secreto por separado, cifrado envolvente, versión de la clave maestra, arranque fallido en producción sin clave y destrucción del secreto al reemplazar.
  - Q-17 fija la identidad: sin RUC detectable no se firma; un RUC distinto solo advierte.
  - ADR 0013 fija los parámetros de firma de la ficha (RSA-SHA1, clave de 2048 bits, PKCS#12).
  - ADR 0018 adopta `facturacion-electronica-ec` como motor SRI detrás de puertos propios: su `EcSriSigner` (sobre `ec-sri-invoice-signer` y `node-forge`) es el firmador.
- **Lo que dejó `add-taxpayer-setup`:**
  - la preparación para emitir ya consulta un puerto de firma, `SigningCertificateReadiness.isMet(companyId)`, que hoy siempre responde pendiente;
  - el RUC vigente de la empresa está en la versión vigente de su configuración (`configs.findCurrent`).
- **Cuerpo de las peticiones.** Express parsea JSON con un límite global de 100 KB antes del router de la API. `pino-http` no registra cuerpos ni cabeceras, y `pino` redacta `password`, `token` y `secret`.
- **Lectura de PKCS#12** (spike S-6, ejecutado el 2026-10-02, D15):
  - `EcSriSigner` firma, pero su API pública no expone los metadatos del certificado, y usa el primer certificado y la primera clave del P12 sin comprobar que se correspondan.
  - La inspección al cargar usa `node-forge` 1.4.0 (ADR 0019), la misma familia de parser que el firmador: abre y rechaza los mismos P12, también los legados con RC2 o 3DES, sin el proveedor legado de OpenSSL.

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
- **Puertos:**
  - `CertificateReader` (inspección), implementado con `node-forge` 1.4.0 (ADR 0019); solo su adaptador importa `node-forge`;
  - `XmlSigner` (firma), implementado en el módulo de infraestructura `sri-engine`. Es el único que importa `facturacion-electronica-ec`; una regla `no-restricted-imports` lo impone (ADR 0018).
- Este cambio crea `sri-engine` solo con el adaptador de firma.

### D2. Modelo e invariantes

Tres tablas:

- **`signing_certificate` (metadatos):**
  - identificación: `id`, `company_id`, `status` (`ACTIVE` o `REPLACED`);
  - certificado: `subject` (titular), `issuer`, `serial_number`, `fingerprint_sha256`, `not_before`, `not_after`, `detected_ruc`, `key_algorithm`, `key_bits`;
  - historia: `uploaded_by`, `created_at`, `replaced_at`, `replaced_by_id`.
  - Restricciones:
    - a lo sumo una `ACTIVE` por empresa. Se implementa con `active_company_id`, que es `company_id` mientras está `ACTIVE` y nulo después, con `UNIQUE` y un `CHECK` de coherencia. Equivale al índice parcial `(company_id) WHERE status = 'ACTIVE'`, que el esquema de Prisma 7.10 no expresa sin una función en preview;
    - `UNIQUE (company_id, id)` como destino de la clave compuesta;
    - un trigger impide borrar e impide cambiar nada salvo dos pasos: la transición `ACTIVE` → `REPLACED` con `replaced_at`, y después, una vez, el enlace `replaced_by_id` a la firma nueva, que solo puede existir cuando la anterior ya no es `ACTIVE`.
- **`signing_certificate_secret` (secreto):**
  - `certificate_id` (PK), `company_id`, `format_version`, `key_version`, `key_check`;
  - la clave de datos envuelta con su nonce;
  - el P12 cifrado y la contraseña cifrada, cada uno con su nonce;
  - `created_at`.
  - Restricciones:
    - clave foránea compuesta `(company_id, certificate_id)` a los metadatos;
    - un trigger impide `UPDATE`: reemplazar es borrar el secreto anterior e insertar el nuevo;
    - otro trigger solo admite el secreto de una firma `ACTIVE` de la misma empresa;
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

- `file` es el P12 en base64. El límite, `CERTIFICATE_MAX_BYTES`, es configuración y se aplica a los bytes PKCS#12 decodificados, nunca a la cadena base64.
  - Por defecto vale 64 KiB, porque todos los fixtures de S-6 caben con holgura (3,5–5,1 KB).
  - No es un límite del SRI ni una regla funcional: el gate del go-live con un P12 real comprueba que admite el archivo con su cadena completa, y subirlo no cambia la spec.
  - La ruta de carga usa su propio parser JSON, con un límite derivado de `CERTIFICATE_MAX_BYTES` (4/3 más un margen para la contraseña y los demás campos). El parser global de 100 KB no la procesa.
- `password` es una cadena de 1 a 256 caracteres, sin recortar ni normalizar: es exactamente lo que abre el archivo.
- `expectedCurrentId` es la firma vigente que el administrador ve, o `null`.
- El esquema es estricto.

Se descarta `multipart/form-data`: exigiría una dependencia más y separaría la contraseña del archivo en el parseo, sin ganar nada para archivos de pocos KB.

Pasos de la validación, antes de abrir la transacción porque es trabajo de CPU sin I/O. Un
certificado es **compatible** si los supera todos:

1. **Coste del cifrado, sin la contraseña.** Se leen de la estructura ASN.1 los contadores de iteraciones del MAC y de cada cifrado. Si alguno supera 100 000: `400 CERTIFICATE_INCOMPATIBLE`. Con 100 000 iteraciones, la inspección y cada firma ya cuestan unos 1,3 s de CPU síncrona. Si la estructura no se puede leer: `400 CERTIFICATE_UNREADABLE`.
2. **Abrir con la contraseña.**
   - Falla el MAC: `400 CERTIFICATE_PASSWORD_INVALID`.
   - Falla el ASN.1: `400 CERTIFICATE_UNREADABLE`.
   - El MAC verifica pero el contenido no se descifra: `400 CERTIFICATE_INCOMPATIBLE`. La limitación detectada en S-6 es concreta: un P12 con cifrado PBES2 (AES con PBKDF2) y una contraseña con caracteres fuera de ASCII. `node-forge`, y por tanto el firmador, no la descifra, mientras que con los formatos legados las contraseñas no ASCII funcionan y la puntuación ASCII nunca es un problema. El mensaje es: "Este archivo PKCS#12 utiliza una combinación de formato y contraseña que no podemos procesar. Intenta exportarlo nuevamente usando una contraseña con caracteres ASCII.", sin revelar ni repetir la contraseña. Sigue siendo una limitación conocida hasta validarla con certificados reales.
3. **Clave y certificado.**
   - Falta la clave, no es RSA, tiene menos de 2048 bits o ningún certificado le corresponde: `400 CERTIFICATE_KEY_UNSUPPORTED`.
   - El certificado del titular no es el primero del P12, que es el que embebe el firmador: `400 CERTIFICATE_INCOMPATIBLE`.
4. **Vigencia,** con el reloj del servidor, `notBefore <= ahora <= notAfter`. Si falla: `400 CERTIFICATE_NOT_VALID_NOW`, con las fechas.
5. **RUC** (D4). Si no se detecta: `400 CERTIFICATE_RUC_NOT_FOUND`, con titular y emisor.
6. **Cadena:** los certificados adicionales del P12 deben poder leerse (CTX §20.6). No se valida la confianza.
7. **Firma de prueba** con `XmlSigner` (`EcSriSigner`) sobre un XML fijo. La firma debe verificarse con la clave pública del certificado inspeccionado, con RSA-SHA1 (ADR 0013), y el certificado embebido debe tener la misma huella. Si no: `400 CERTIFICATE_INCOMPATIBLE`.

Los mensajes nunca incluyen la contraseña ni contenido del archivo. El error de la librería se
traduce a uno de estos códigos y su texto original no sale del adaptador.

Los pasos 1 a 3, 5, 6 y 7 se ejecutan en el pool criptográfico (D18), nunca en el event loop
principal: el handler espera el resultado sin bloquear. El orden de la cadena no se normaliza ni
se reescribe el P12. Si los P12 reales muestran que la CA primero es frecuente, se evaluará aparte.

### D4. Detección del RUC y compatibilidad por capacidades

- **Sin lista de entidades.** La compatibilidad es técnica (D3): el emisor del certificado nunca decide por sí solo si se acepta o se rechaza.
- **Registro de extractores** (`RucExtractor[]`), por estructura u OID documentado. Cada uno declara su identificador, la estructura que lee y la fuente pública que la documenta.
  - El primero lee la extensión `1.3.6.1.4.1.37746.3.11`, que Security Data documenta como RUC, codificada como `UTF8String`, `PrintableString` o `IA5String`.
  - Se prueban en orden, y el primero que devuelve un valor fiable gana.
- **Valor fiable.** El valor completo debe cumplir el patrón de RUC de `packages/contracts` (13 dígitos terminados en 001, el del XSD), sin recortar texto ni buscar dígitos dentro de él.
- **Sin inferencias.** No se infiere el RUC del texto del sujeto ni de cadenas de 13 dígitos en cualquier campo.
- **Sin valor fiable:** `CERTIFICATE_RUC_NOT_FOUND`.
- **Añadir una estrategia** exige su documentación pública, un fixture que la reproduzca y su prueba.
- **Compatible frente a proveedor validado:**
  - *compatible* = el certificado supera las reglas técnicas de D3;
  - *proveedor validado* = se probó al menos un P12 real de ese proveedor.
  - Con fixtures sintéticos ningún proveedor figura como validado; Security Data está cubierto solo estructuralmente.
  - La lista de proveedores validados vive en `fiscal-emission.md`, vacía hasta probar el primer P12 real, preferentemente el del primer cliente piloto (requisito del go-live).
- **Coincidencia con la empresa.** Se calcula al leer, contra el RUC vigente de `configs.findCurrent`, porque el RUC de la empresa puede corregirse mientras no esté bloqueado (Q-31).

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

### D15. Spike S-6: resultado (ejecutado el 2026-10-02)

Entorno: Node 24.21.0, `facturacion-electronica-ec` 1.0.1, `ec-sri-invoice-signer` 1.8.2,
`node-forge` 1.4.0 y PKIjs 3.4.1, sin el proveedor legado de OpenSSL en el runtime. La CLI de
OpenSSL lo usó solo para generar fixtures legados. Solo P12 sintéticos, ningún certificado real.
La firma la verificó `signxml` (Python), independiente de `xml-crypto` y `xmldom`.

| P12 | Firmador (A) | Firma independiente | XSD | Inspección `node-forge` (B) | PKIjs |
| --- | --- | --- | --- | --- | --- |
| Moderno (PBES2, AES-256, MAC SHA-256), contraseña ASCII | Firma | Válida (3 referencias) | Válido | Compatible | Abre |
| Legado (RC2-40 y 3DES, MAC SHA-1) | Firma | Válida | Válido | Compatible | No abre |
| Solo 3DES | Firma | Válida | Válido | Compatible | No abre |
| Legado o 3DES, contraseña no ASCII | Firma | Válida | Válido | Compatible | No abre |
| Moderno, contraseña no ASCII | Falla: no descifra | — | — | `INCOMPATIBLE` | Abre |
| Contraseña incorrecta | Error de MAC, sin la contraseña | — | — | `PASSWORD_INVALID` | Falla integridad |
| Truncado o aleatorio | Error ASN.1 | — | — | `UNREADABLE` | Falla |
| RSA 4096 | Firma | Válida | Válido | Compatible | Abre |
| RSA 1024 | Firma | Válida | Válido | `KEY_UNSUPPORTED` | Abre |
| EC P-256 | Falla ("Couldn't find certificate") | — | — | `KEY_UNSUPPORTED` | Abre |
| Clave que no corresponde | Firma | **Inválida** | Válido | `KEY_UNSUPPORTED` | No abre |
| Cadena con la CA primero | Firma y **embebe la CA** | **Inválida** | Válido | `INCOMPATIBLE` | No abre |
| Sin clave | Falla | — | — | `KEY_UNSUPPORTED` | Abre sin clave |
| Vencido o futuro | Firma | El verificador rechaza el certificado | Válido | `NOT_VALID_NOW` | Abre |
| Sin RUC, RUC inválido o mezclado con texto | — | — | — | `RUC_NOT_FOUND` | — |
| RUC en el OID de Security Data (UTF8String, PrintableString, IA5String) | — | — | — | RUC detectado | — |

**Resultados:**

- **Elección:** `node-forge` (ADR 0019). PKIjs no abre ningún P12 legado.
- **Firmador:**
  - firma todo lo compatible, incluida la liquidación de compra por la API pública;
  - no descifra un P12 moderno con contraseña no ASCII;
  - no comprueba vigencia, tamaño de clave ni correspondencia, y embebe el primer certificado: por eso D3 inspecciona primero y termina con la firma de prueba.
- **Errores y logs:** sin la contraseña, el base64 ni marcadores PEM en ninguno.
- **Coste,** síncrono y lineal en las iteraciones:
  - 2048 iteraciones: 18–44 ms de inspección y 42–120 ms de firma;
  - 100 000: unos 1,3 s cada operación;
  - 600 000: unos 8 s.
- **Límites finales:**
  - `CERTIFICATE_MAX_BYTES`, configurable y de 64 KiB por defecto, sobre los bytes decodificados;
  - hasta 100 000 iteraciones;
  - RSA de 2048 bits o más;
  - certificado del titular primero;
  - contraseña no ASCII solo en P12 legados o 3DES;
  - vigente;
  - RUC por un extractor registrado.
- **El script de fixtures** del spike (CLI de OpenSSL y `node-forge`) pasa a ser el de las pruebas (D16).

**Pendiente:** validar un P12 real. Si el dueño del producto aporta uno:

- se usa solo como fixture local y temporal;
- nunca se commitea ni se copia a OpenSpec o a la documentación;
- su contraseña no se registra;
- se documentan la entidad, sus características técnicas y el resultado, y el proveedor pasa a validado.

Sin él, sigue como requisito del go-live (`definition-of-done.md`).

### D18. Pool criptográfico fuera del event loop

S-6 midió que abrir un P12, derivar sus claves, comprobar la correspondencia entre clave y
certificado y firmar son CPU síncrona: de decenas de milisegundos a más de un segundo. En este
cambio, no solo en la emisión, ese trabajo corre en `worker_threads`.

- **Abstracción reutilizable.** `CryptoWorkerPool`, en `backend/src/platform/workers/`, ejecuta tareas con nombre registradas en un módulo de worker. Esta es la que deja este cambio:
  - `inspect-and-test-sign`: inspección de D3 y firma de prueba.

  `add-invoice-emission` añadirá la firma de XML como otra tarea del mismo pool.
- **Concurrencia acotada.**
  - Un número fijo de workers (`CRYPTO_WORKERS`, 2 por defecto, entre 1 y 8), creados al arrancar y reutilizados, nunca uno por petición.
  - Una cola limitada (16 tareas). Con la cola llena, `503 CRYPTO_BUSY`.
- **Timeout.**
  - Cada tarea tiene un límite (`CRYPTO_TASK_TIMEOUT_MS`, 30 s por defecto). Al agotarse, el worker se termina y se reemplaza, y la tarea falla con un error tipado de timeout.
  - El límite de 100 000 iteraciones mantiene el trabajo legítimo muy por debajo.
- **Errores tipados.** El worker devuelve `{ ok: true, value }` o `{ ok: false, code }`, con un código de D3. Nunca serializa el error original de la librería, que podría citar datos. Un fallo inesperado se traduce a `CERTIFICATE_UNREADABLE` o a un error interno sin detalles.
- **Sin fugas.**
  - Los bytes del P12 se transfieren como `ArrayBuffer`: quedan separados del hilo principal y se sobrescriben con ceros al terminar.
  - La contraseña viaja en el mensaje y no se guarda en el worker después de la tarea.
  - Ni el pool ni el worker registran los mensajes. Los logs solo llevan el nombre de la tarea, la duración y el código.
- **Ciclo de vida.**
  - El pool se crea en `main.ts`, entra en la readiness como dependencia y se cierra en el apagado ordenado (`shutdown`), esperando las tareas en curso hasta el timeout y terminando los workers.
  - En pruebas, cada arnés lo cierra.
- **Configuración:** `CRYPTO_WORKERS` y `CRYPTO_TASK_TIMEOUT_MS`, validadas en `config/env.ts`.

### D16. Pruebas

- **Fixtures:** las pruebas generan los P12 sintéticos al ejecutarse con el script del spike. No se commitean claves privadas, aunque sean de prueba.
- **Contratos del adaptador** (ADR 0018), antes de aceptar cualquier actualización de la librería o del firmador:
  - firma de cada fixture verificable;
  - certificado embebido igual al inspeccionado;
  - error de contraseña sin la contraseña;
  - frontera de imports.
- **Sin fugas:** una prueba de integración busca la contraseña y el base64 de cada fixture en las respuestas, los errores, el logger capturado, la tabla de auditoría y los volcados en claro de las tablas, y confirma que el secreto guardado no contiene ninguno de los dos.

### D17. Datos y migración

- Una migración crea las tres tablas, el índice parcial y los triggers.
- No hay datos que migrar.
- **Despliegue:** en producción hay que configurar la clave maestra antes de actualizar, o el backend no arranca (BREAKING de instalación). La clave se respalda aparte de la base de datos (`deployment.md`, R-15).
- **Marcha atrás:** revertir la versión deja las tablas sin uso. Las firmas cargadas habría que volver a cargarlas si se borran las tablas.

## Risks / Trade-offs

- [Firma síncrona: de 42 ms a 1,3 s por operación según las iteraciones] → Pool de workers acotado con timeout (D18) desde este cambio, límite de 100 000 iteraciones, y la emisión reutiliza el mismo pool (obligación en `fiscal-emission.md`).
- [Codificación real del OID de Security Data distinta de las probadas] → Extractor tolerante a los tres tipos de cadena, rechazo explícito si no hay valor fiable, y P12 real como requisito del go-live.
- [Rechazos que afectan a usuarios reales: P12 con cifrado PBES2 y contraseña no ASCII, o cadena con la CA primero] → Mensaje que explica exactamente la limitación y cómo exportar de nuevo la firma. Normalizar el P12 al cargarlo queda fuera de este diseño hasta ver P12 reales.
- [`EcSriSigner` no firma algún P12 soportado, o embebe un certificado que no es el del titular] → S-6 A es el gate. La firma de prueba al cargar compara el certificado embebido con el inspeccionado. Si falla, se limitan los formatos o se usa un `ISigner` propio detrás de `XmlSigner`.
- [La inspección y el firmador leen el P12 de forma distinta] → S-6 B prefiere la misma familia de parser (`node-forge`). La firma de prueba es la comprobación final.
- [Cambio incompatible en `facturacion-electronica-ec` o `ec-sri-invoice-signer`] → Versiones exactas y contratos del adaptador antes de actualizar (ADR 0018).
- [Falsos negativos de RUC con entidades no contempladas] → Ubicaciones documentadas por entidad, mensaje explícito con titular y emisor, una fila más por entidad y el P12 real como requisito del go-live.
- [Pérdida o cambio de la clave maestra] → `key_check` lo detecta sin descifrar, la firma figura como no disponible, se pide volver a cargarla y se registra al arrancar (R-15).
- [Reloj del servidor desviado] → La vigencia usa el reloj del servidor. NTP y su vigilancia son requisito de instalación (CTX §20.5, `deployment.md`).
- [Contraseña en el cuerpo JSON] → Ni `pino-http` ni el manejador de errores registran cuerpos, y la redacción cubre `password` y `file`. La prueba de fugas lo verifica.
- [Material en claro en memoria] → Vida mínima, sobrescritura con ceros en la medida de lo posible y nunca en logs.
- [Una sola clave maestra por instalación] → Basta para una empresa por instancia (ADR 0009). La versión permite rotarla después.
