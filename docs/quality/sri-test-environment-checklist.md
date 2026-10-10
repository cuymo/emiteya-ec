# SRI TEST ENVIRONMENT CHECKLIST: certificación en Pruebas

Lista de comprobación previa a la sesión de certificación real, **solo en el ambiente de Pruebas**
del SRI (`celcer.sri.gob.ec`). Es el paso que sigue al ensayo offline del P12. El procedimiento
completo está en `sri-certification.md`, el runbook, y esta lista remite a sus secciones.

**Estado al 2026-10-10: preparada, sin ejecutar.** No se ha contactado ningún host del SRI y
`SRI_TRANSMISSION_ENABLED` sigue en `0`. Nada de esta lista habilita la transmisión por sí solo.

> **Plazo.** El certificado del P12 vence el **2026-11-12**. La certificación en Pruebas tiene que
> terminar antes de esa fecha. No es un defecto del producto ni cambia el código. Si no da tiempo, el
> operador renueva el certificado y se repite el ensayo offline (runbook, sección 5).

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
- [ ] **Contrapartes de prueba: decisión pendiente del dueño** (runbook, sección 6):
  - el comprador identificado;
  - el sujeto retenido;
  - el proveedor de la liquidación, sin RUC activo.

  No se usan identidades reales de terceros sin su consentimiento.

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
- [ ] Una **lista de permitidos de salida, exclusivamente `celcer.sri.gob.ec:443`**: un proxy
  `CONNECT` local (`NODE_USE_ENV_PROXY=1` y `HTTPS_PROXY`) o una regla equivalente del firewall,
  activa y documentada. Hoy es la herramienta pendiente de la sección 14 del runbook. Su regla se
  revisa por escrito; no se prueba contra Producción.
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

## F. Ejecución (solo cuando A a E estén completas y el dueño lo autorice)

- [ ] El orden y la matriz de los siete documentos, uno a la vez, cada uno hasta `AUTHORIZED` (runbook,
  secciones 7 y 8).
- [ ] Las condiciones de parada a la vista (runbook, sección 10). Ante cualquier duda, se detiene.
- [ ] La evidencia y el registro, sin secretos ni identidades (runbook, secciones 11 a 13).
