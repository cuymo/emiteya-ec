# ADR 0019: Inspección del certificado de firma con `node-forge`

## Status

Accepted el 2026-10-02, tras el spike S-6.

## Context

Al cargar la firma, la aplicación debe abrir el PKCS#12 y leer el certificado y la clave
(design D3 de `add-signing-certificate`, CTX §20.6, Q-17):

- verificar la contraseña;
- leer titular, emisor, serie, huella, vigencia, y tipo y tamaño de la clave;
- comprobar que la clave corresponde al certificado;
- extraer el RUC.

`EcSriSigner` de `facturacion-electronica-ec` (ADR 0018) firma, pero su API pública no expone
nada de eso, y no se usan imports privados de la librería ni de `ec-sri-invoice-signer`.

El spike S-6 comparó `node-forge` 1.4.0 y PKIjs 3.4.1, sobre Node 24.21.0, sin el proveedor
legado de OpenSSL y con P12 sintéticos:

| Caso | `node-forge` | PKIjs | `EcSriSigner` |
| --- | --- | --- | --- |
| Moderno (PBES2, AES-256, MAC SHA-256), contraseña ASCII | Abre | Abre | Firma |
| Legado (RC2-40 y 3DES, MAC SHA-1) y solo 3DES | Abre | No abre: WebCrypto no tiene RC2 ni 3DES | Firma |
| Legado o 3DES, contraseña no ASCII | Abre | No abre | Firma |
| Moderno, contraseña no ASCII | No descifra, aunque el MAC verifica | Abre | No firma: mismo error |
| Contraseña incorrecta frente a archivo corrupto | Distingue: MAC frente a ASN.1 | Distingue | Distingue |

`node-forge` es la misma familia de parser que usa el firmador: acepta y rechaza los mismos P12.

## Decision

- **Dependencia.** El puerto `CertificateReader` del módulo `signing` se implementa con `node-forge`, en versión exacta 1.4.0, la misma que resuelve `ec-sri-invoice-signer` 1.8.2.
- **Frontera.** Solo el adaptador del lector importa `node-forge`.
- **Lo que comprueba la inspección:**
  - abre el P12 y distingue una contraseña incorrecta de un archivo ilegible;
  - exige una clave RSA de al menos 2048 bits que corresponda a un certificado del P12;
  - exige que ese certificado sea el primero, porque el firmador usa el primero;
  - rechaza un P12 que no puede descifrar aunque el MAC verifique (cifrado moderno con contraseña no ASCII);
  - lee los contadores de iteraciones antes de descifrar y rechaza los que superan 131 072 (sección «Techo de iteraciones»).
- **RUC.** Se extrae con un registro de extractores por estructura u OID documentado (design D4), nunca por el emisor ni por texto del sujeto.
- **Firma de prueba.** La firma de prueba con `XmlSigner` sigue siendo la comprobación final de compatibilidad.
- **Política de actualización.** `node-forge` y el firmador se actualizan juntos, con los fixtures del spike como pruebas de contrato.

## Consequences

- Los formatos legados, habituales en entidades certificadoras, se aceptan sin habilitar el proveedor legado de OpenSSL.
- **Rechazos:**
  - un P12 con cifrado PBES2 (AES con PBKDF2) y contraseña con caracteres fuera de ASCII. El firmador tampoco puede usarlo. Con los formatos legados las contraseñas no ASCII funcionan, y la puntuación ASCII nunca es un problema. El mensaje es: "Este archivo PKCS#12 utiliza una combinación de formato y contraseña que no podemos procesar. Intenta exportarlo nuevamente usando una contraseña con caracteres ASCII.". Es una limitación conocida hasta validarla con certificados reales;
  - una cadena con el certificado de la CA primero.
- **Coste de CPU.** La inspección y la firma son JavaScript síncrono: de 18 a 120 ms con 2048 iteraciones, y unos 1,3 s con 100 000 (spike S-6; el benchmark de la sección «Techo de iteraciones» da las cifras por perfil). Por eso la inspección y la firma corren en un pool de `worker_threads` acotado y con timeout (design D18 de `add-signing-certificate`), que la emisión reutilizará.
- La compatibilidad con P12 reales de cada proveedor sigue requiriendo un P12 real (requisito del go-live).

## Compatibilidad por proveedor (2026-10-09)

**Security Data: SUPPORTED por evidencia pública.** El extractor
`extension-oid:1.3.6.1.4.1.37746.3.11` coincide con la documentación oficial del proveedor. No se
agrega ningún extractor ni se cambia el soporte por emisor. La prueba con el P12 real sigue
pendiente (procedimiento offline de `../../quality/sri-certification.md`, sección 5).

- **Fuente.** Security Data Seguridad en Datos y Firma Digital S.A., «OIDs: Objetos Identificadores
  Únicos de los Certificados», uso público, versión 9 (sustituye a la 5), emitido el 6/02/2012 y
  revisado el 07/07/2020.
  - URL: `https://www.securitydata.net.ec/wp-content/downloads/descargas/Manuales/Oids/OID.pdf`.
  - Descargado el 2026-10-09, SHA-256
    `71c21b6b6b4433bc1bd0436537f7207d54f8ea1fc403394b2a1685c2a1b1f52e`.
- **Qué dice.** `1.3.6.1.4.1.37746.3.11` es el campo «RUC» en los certificados de firma electrónica:
  - Persona Natural, con la nota «si no tiene queda en blanco»;
  - Miembro de Empresa;
  - Representante Legal.
- **Lo que no fija.** El tipo de cadena ASN.1. El extractor admite UTF8String, PrintableString e
  IA5String; el P12 real lo confirma.
- **Casos que la inspección rechaza con `CERTIFICATE_RUC_NOT_FOUND`:**
  - un certificado de persona natural sin RUC, que el SRI tampoco acepta;
  - un certificado de **sello electrónico**. Su política (SD-ID-PE-13 V2, `pcselloelectronico.pdf`,
    SHA-256 `44a8cc1667cdaba2d30f1d53fcc150033f1832e088c1a34a692f7ec577a60292`) lleva el RUC en
    `2.5.4.97` con la forma `VATEC-<RUC>`, que el extractor no lee. Soportarlo sería otro extractor
    con su evidencia, su fixture y su prueba.

## Techo de iteraciones (2026-10-09)

El ensayo offline del P12 real de Security Data falló con `CERTIFICATE_INCOMPATIBLE:ITERATIONS`. El
archivo es un PKCS#12 legado: MAC SHA-1 con 102 400 iteraciones, y clave 3DES y certificados RC2-40
con 51 200. Superaba el techo de 100 000, que se había fijado con P12 sintéticos.

**Decisión** (`support-security-data-pkcs12-iteration-profile`, design D2 a D4):
- **Techo de 131 072 iteraciones.** Se compara con el mayor de los contadores, el del MAC y el de
  cada cifrado, sin sumarlos. El borde se admite. La comprobación ocurre antes de verificar el MAC o
  descifrar nada.
- **Qué deja pasar y qué no:**
  - el perfil de Security Data entra con un 28 % de margen;
  - un P12 con un contador mayor se rechaza en menos de 1 ms con el mensaje de `ITERATIONS`.
- **El pool criptográfico acotado con timeout se mantiene** como segunda defensa. Un archivo que repite
  contenidos cifrados dentro del tamaño máximo de subida pasa el techo, y su coste total solo lo acota
  el timeout, que responde `CRYPTO_TIMEOUT`.

**Evidencia.** Benchmark con el importador y la firma reales en el pool de producción, y P12
sintéticos (`docs/quality/benchmarks/pkcs12-iterations-2026-10-09.md`).
- El coste es lineal en las iteraciones.
- La importación del perfil de Security Data tarda menos de 1 s: 954 ms de mediana.
- La del peor perfil legítimo en el techo, moderno uniforme, tarda 3,34 s. Con el techo anterior
  ya eran 2,56 s.
- 150 000 o 200 000 encarecerían ese peor caso sin evidencia de un perfil que lo necesite. No se
  encontró documentación pública de Security Data con un perfil mayor.

**Riesgo residual, igual que antes del cambio.** Un administrador autenticado puede ocupar un worker
hasta el timeout por carga con un archivo de muchos contenidos cifrados. Para rechazar ese caso de
forma barata haría falta un límite de contenidos o un presupuesto de derivaciones, que requiere una
decisión propia.

## Certificados sin RUC (2026-10-09)

El P12 real de Security Data del operador es criptográficamente compatible con el techo nuevo, pero
su certificado no trae la extensión `1.3.6.1.4.1.37746.3.11`. Trae `1.3.6.1.4.1.37746.3.1`, la cédula,
que coincide con los diez primeros dígitos del RUC de la empresa. La carga lo rechaza con
`CERTIFICATE_RUC_NOT_FOUND`.

**Decisión del dueño del producto: se mantiene la regla vigente.** El certificado que se usa para la
facturación electrónica debe contener el RUC (requisito «Identidad tributaria de la firma» de
`signing-certificate`).
- No se deriva el RUC como la cédula seguida de `001`.
- No se modifica el extractor de identidad.
- No se abre un change para aceptar certificados sin RUC.

El P12 se clasifica como `CRYPTOGRAPHICALLY_COMPATIBLE` pero
`NOT_SRI_CERTIFICATION_ELIGIBLE_FOR_THIS_COMPANY`. No es un defecto de la aplicación: hace falta un
certificado reemitido con el RUC (`../../quality/sri-certification.md`, sección 5).

**Fuentes.** Las dos del SRI las aportó el dueño del producto el 2026-10-09; no hay copia ni hash en el
repositorio.
1. SRI, «Guía para emisión de comprobantes electrónicos»: requisito «Certificado digital de firma
   electrónica obtenido con RUC».
2. Documentación técnica histórica del SRI: el procedimiento de inspección del certificado indica
   revisar el tag que contiene el RUC.
3. Security Data, «OIDs: Objetos Identificadores Únicos de los Certificados», el documento registrado
   en «Compatibilidad por proveedor»:
   - `1.3.6.1.4.1.37746.3.1` es la cédula o el pasaporte;
   - `1.3.6.1.4.1.37746.3.11` es el RUC.

