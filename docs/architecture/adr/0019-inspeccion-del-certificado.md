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
  - lee los contadores de iteraciones antes de descifrar y rechaza los que superan 100 000.
- **RUC.** Se extrae con un registro de extractores por estructura u OID documentado (design D4), nunca por el emisor ni por texto del sujeto.
- **Firma de prueba.** La firma de prueba con `XmlSigner` sigue siendo la comprobación final de compatibilidad.
- **Política de actualización.** `node-forge` y el firmador se actualizan juntos, con los fixtures del spike como pruebas de contrato.

## Consequences

- Los formatos legados, habituales en entidades certificadoras, se aceptan sin habilitar el proveedor legado de OpenSSL.
- **Rechazos:**
  - un P12 con cifrado PBES2 (AES con PBKDF2) y contraseña con caracteres fuera de ASCII. El firmador tampoco puede usarlo. Con los formatos legados las contraseñas no ASCII funcionan, y la puntuación ASCII nunca es un problema. El mensaje es: "Este archivo PKCS#12 utiliza una combinación de formato y contraseña que no podemos procesar. Intenta exportarlo nuevamente usando una contraseña con caracteres ASCII.". Es una limitación conocida hasta validarla con certificados reales;
  - una cadena con el certificado de la CA primero.
- **Coste de CPU.** La inspección y la firma son JavaScript síncrono: de 18 a 120 ms con 2048 iteraciones, y unos 1,3 s con 100 000. Por eso la inspección y la firma corren en un pool de `worker_threads` acotado y con timeout (design D18 de `add-signing-certificate`), que la emisión reutilizará.
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
