# SRI TEST ENVIRONMENT CHECKLIST: certificación en Pruebas

Lista de comprobación previa a la sesión de certificación real, **solo en el ambiente de Pruebas**
del SRI (`celcer.sri.gob.ec`). Es el paso que sigue al ensayo offline del P12. El procedimiento
completo está en `sri-certification.md`, el runbook, y esta lista remite a sus secciones.

**Estado al 2026-10-10: preparada, sin ejecutar.** No se ha contactado ningún host del SRI y
`SRI_TRANSMISSION_ENABLED` sigue en `0`. Nada de esta lista habilita la transmisión por sí solo.

> **Plazo operativo: el certificado del P12 vence el 2026-11-12.** La certificación en Pruebas tiene
> que terminar antes de esa fecha. No es un defecto del producto ni cambia el código. La comprobación
> final (sección G) se detiene con `CERTIFICATE_EXPIRY_TOO_CLOSE` si quedan menos de 7 días. En ese
> caso se para, se evalúa la renovación y, con el certificado nuevo, se repite el ensayo offline
> (runbook, sección 5).

**Estado de la confirmación del operador:** PENDING en todos los puntos de B y en los datos de C.
Los confirma el operador desde los canales oficiales del SRI. Lo que no se puede confirmar sin
contactar los servicios web queda PENDING; nunca se confirma con una llamada.

## Regla absoluta: Producción nunca

Durante toda la certificación, el SRI de **Producción** (`cel.sri.gob.ec`) queda fuera de cualquier
interacción, sin excepción para pruebas:

- pruebas, pruebas de humo, health checks ni diagnósticos de conectividad;
- consultas DNS, conexiones TCP, peticiones HTTP o SOAP;
- Recepción, Autorización, ConsultaComprobante, reconciliación ni descarga de WSDL.

El bloqueo de Producción se comprueba **revisando la configuración**: la regla de la lista de
permitidos y las URL sobrescritas. Nunca se comprueba intentando llegar a `cel.sri.gob.ec`.

## A. Prerrequisitos ya cumplidos

- [x] MVP completo, con su prueba integral.
- [x] Q-47 resuelta por política de producto. La política conservadora `PRODUCT_CONSERVATIVE_POLICY_V1`
  (menos de 40 000 bytes en el XML firmado, su base64 y el SOAP) rige en los dos ambientes (runbook,
  sección 2.1).
- [x] El PKCS#12 de Security Data se admite con el techo de 131 072 iteraciones.
- [x] Ensayo offline del P12 reemitido: **PASS** el 2026-10-10 (runbook, sección 5, «Ensayo 3»).
  - Emisor Security Data, con el RUC en el OID `1.3.6.1.4.1.37746.3.11` igual al de la empresa.
  - La firma, su verificación y el XSD pasan.
  - Los siete documentos miden como máximo 15 460 bytes de SOAP.
- [x] El P12 está fuera del árbol del repositorio, con permisos `600`, y se referencia solo desde la
  configuración local secreta. Su contraseña es nueva y nunca se comparte por chat.

## B. RUC y ambiente de Pruebas en el SRI (operador, en los canales del SRI)

La aplicación no crea ni modifica nada en el SRI. Detalle en el runbook, sección 4.

- [ ] El RUC está activo y habilitado para emitir comprobantes electrónicos.
- [ ] El **ambiente de Pruebas** está habilitado para ese RUC.
- [ ] Están habilitados los seis tipos: **01** factura, **03** liquidación de compra, **04** nota de
  crédito, **05** nota de débito, **06** guía de remisión y **07** comprobante de retención. Si no,
  se sabe cuáles no lo están.
- [ ] El establecimiento que se usará está registrado y abierto, con su código (normalmente `001`).
  Una guía entre establecimientos propios necesita dos establecimientos registrados.
- [ ] El titular del P12 corresponde al RUC.
- [ ] Hay un canal para consultar al SRI si aparece una respuesta desconocida.

## C. Instalación de la certificación

Detalle en el runbook, secciones 6 y 3.1.

- [ ] Una instalación nueva y aislada:
  - base o esquema propios;
  - el commit que se piensa desplegar, anotado;
  - `NODE_ENV=production`;
  - la custodia habilitada con su clave maestra en `CERTIFICATE_MASTER_KEY_FILE`.
- [ ] La empresa, en el ambiente de **Pruebas** desde el primer momento. El ambiente no se cambia
  durante la sesión.
- [ ] Los datos tributarios configurados coinciden con el registro del SRI, porque van al XML:
  - RUC, razón social y nombre comercial;
  - dirección de la matriz y del establecimiento;
  - obligado a llevar contabilidad;
  - contribuyente especial y agente de retención (resoluciones);
  - régimen RIMPE.
- [ ] El establecimiento, con el mismo código registrado en el RUC.
- [ ] Un **punto de emisión dedicado** a la certificación, con un código no usado antes en Pruebas con
  este RUC. Si ya se usó, se conoce el último secuencial por tipo (un secuencial repetido da el código
  45).
- [ ] Los **secuenciales de Pruebas**: cada tipo en ese punto empieza en el siguiente al último usado
  en Pruebas, o en 1 si el punto es nuevo. Los contadores de Pruebas son independientes de los de
  Producción.
- [ ] La firma electrónica, cargada desde la interfaz con el P12 validado. La readiness la marca
  utilizable y el RUC coincide.
- [ ] Productos sintéticos con «PRUEBA» en el nombre: un bien con stock inicial suficiente y un
  servicio.
- [ ] **Contrapartes de prueba** (runbook, sección 6). El repositorio solo usa estos marcadores; los
  valores concretos viven en la configuración local y en la instalación, nunca en la documentación:

  | Marcador | Uso | Requisito |
  | --- | --- | --- |
  | `TEST_IDENTIFIED_BUYER` | Comprador identificado de la factura 2; destinatario de la guía | RUC, cédula o pasaporte |
  | `TEST_WITHHOLDING_SUBJECT` | Sujeto retenido del comprobante de retención | RUC, cédula o pasaporte |
  | `TEST_PURCHASE_SETTLEMENT_SUPPLIER` | Proveedor de la liquidación de compra | Sin RUC activo: cédula o pasaporte |

  - Solo dos orígenes son válidos:
    - una identidad bajo control del operador (`OWNER_CONTROLLED`);
    - una persona con consentimiento explícito por escrito (`WRITTEN_CONSENT`).
  - No se inventan cédulas ecuatorianas.
  - No se asume que el SRI acepte un pasaporte sintético hasta comprobarlo en Pruebas.
  - Para la factura a consumidor final se usa `9999999999999`.
- [ ] **El punto de emisión de la certificación**: la combinación empresa + Pruebas + establishment +
  emission point + tipo de comprobante. En el repositorio solo figuran sus códigos públicos:
  `CERT_ESTABLISHMENT_CODE` (normalmente `001`) y `CERT_EMISSION_POINT_CODE`, que deben confirmarse.
  - Seis contadores de Pruebas propios: 01, 03, 04, 05, 06 y 07.
  - Ningún contador de Producción en ese punto.
  - No se reutiliza ni se cambia ninguna numeración de Producción.

## D. Red: solo `celcer.sri.gob.ec:443`

Detalle en el runbook, secciones 3 y 14.

- [ ] Los **endpoints de Pruebas** son los de los WSDL registrados (`docs/product/sri-wsdl/`), todos
  en `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/`:
  - Recepción: `RecepcionComprobantesOffline`;
  - Autorización: `AutorizacionComprobantesOffline`;
  - Consulta de validez: `ConsultaComprobante`.
- [ ] Los endpoints de Producción (`SRI_ENDPOINT_PRODUCTION_RECEPTION`, `_AUTHORIZATION` y
  `_VALIDITY`) están sobrescritos con una URL `https` que no lleva a ningún sitio, por ejemplo un
  puerto cerrado de `127.0.0.1`. Se comprueba leyendo la configuración.
- [ ] La **lista de permitidos de salida, exclusivamente `celcer.sri.gob.ec:443`**, preparada en
  `sri-egress-allowlist.md` (`corepack pnpm sri:egress`):
  - un espacio de nombres de red sin interfaces;
  - un proxy `CONNECT` que solo admite celcer;
  - procedimientos APPLY, VERIFY y ROLLBACK, con falla cerrada y sin `sudo` ni cambios del firewall.
  - [ ] `verify` en `PASS` con el archivo de entorno de la sesión, sin red. Su salida se guarda para la
    sección G.
  - [ ] `apply`, solo en la sesión controlada y con la autorización del dueño.
- [ ] La verificación de los WSDL de Pruebas al empezar la sesión (un `GET` de lectura por servicio,
  SHA-256 igual al registrado) se hace **solo con la autorización expresa del dueño en ese momento** y
  solo contra `celcer.sri.gob.ec`.

## E. Interruptor y readiness

Detalle en el runbook, sección 3.1.

- [ ] `SRI_TRANSMISSION_ENABLED=0` hasta el inicio de la sesión controlada. Solo el proceso de la
  certificación la habilita, con su archivo de entorno fuera del repositorio.
- [ ] Al habilitarla, antes de emitir:
  - `/health/ready` responde `200` con `"sriTransmission": "enabled"`;
  - `sriSizePolicy.source` es `PRODUCT_CONSERVATIVE_POLICY_V1`, con `limitBytes` de 40 000;
  - `sri_transmission_enabled` vale `1`.
- [ ] Están ensayadas las tres formas de volver a fallar cerrado: parar el proceso, reiniciarlo con
  `SRI_TRANSMISSION_ENABLED=0` o cortar la lista de permitidos.

## G. Comprobación final de la sesión, sin red

```sh
corepack pnpm --filter @facturador/backend sri:test-session-readiness \
  --backend-env-file <archivo> --confirmations <archivo> --egress-verify <salida de verify>
```

Lee la base de la instalación de la certificación en solo lectura y no contacta ningún host. Exige a
la vez:
- empresa y comprobantes en Pruebas;
- la firma vigente con su secreto, al menos 7 días de vigencia y el RUC igual al de la empresa;
- `PRODUCT_CONSERVATIVE_POLICY_V1` activa;
- `SRI_TRANSMISSION_ENABLED=0` durante la preparación;
- los endpoints de Pruebas en celcer y los de Producción inaccesibles;
- un `verify` de la lista de permitidos en `PASS`, con menos de 24 horas;
- el establecimiento y el punto confirmados y activos, y los seis tipos confirmados;
- los secuenciales de Pruebas listos;
- las tres contrapartes resueltas.

No imprime el RUC, las identificaciones ni secretos. El archivo de confirmaciones vive fuera del
repositorio, con permisos `600`. Plantilla, solo con marcadores:

```json
{
  "rucEnabledForElectronicInvoicing": false,
  "testEnvironmentEnabled": false,
  "taxDataMatchesSri": false,
  "establishmentCode": "<CERT_ESTABLISHMENT_CODE>",
  "emissionPointCode": "<CERT_EMISSION_POINT_CODE>",
  "documentTypesEnabled": [],
  "lastUsedTestSequential": {},
  "counterparties": {
    "TEST_IDENTIFIED_BUYER": { "consent": "OWNER_CONTROLLED", "identificationType": "<04|05|06>", "identification": "<local>" },
    "TEST_WITHHOLDING_SUBJECT": { "consent": "WRITTEN_CONSENT", "identificationType": "<04|05|06>", "identification": "<local>" },
    "TEST_PURCHASE_SETTLEMENT_SUPPLIER": { "consent": "WRITTEN_CONSENT", "identificationType": "<05|06>", "identification": "<local>" }
  }
}
```

## F. Ejecución (solo cuando A a E y G estén completas y el dueño lo autorice)

- [ ] El orden y la matriz de los siete documentos, uno a la vez, cada uno hasta `AUTHORIZED` (runbook,
  secciones 7 y 8).
- [ ] Las condiciones de parada a la vista (runbook, sección 10). Ante cualquier duda, se detiene.
- [ ] La evidencia y el registro, sin secretos ni identidades (runbook, secciones 11 a 13).
