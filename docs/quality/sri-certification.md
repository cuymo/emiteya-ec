# Certificación con el SRI en Pruebas (S-3 online): runbook de los seis tipos

Runbook de la certificación real en el ambiente de **Pruebas** del SRI de los seis tipos del MVP:

- 01 factura;
- 03 liquidación de compra;
- 04 nota de crédito;
- 05 nota de débito;
- 06 guía de remisión;
- 07 comprobante de retención.

Cumple ERS AC-03 («existe al menos un caso autorizado en ambiente de Pruebas para cada tipo») y la
parte online de S-3. Reemplaza el plan anterior de diez facturas, que no cubría AC-03.

- Corre fuera de la CI, en el entorno del operador.
- No tiene rutas, banderas ni modos especiales en el código: se certifica la aplicación tal como se
  despliega.
- Producción no forma parte de este runbook. El go-live es otra compuerta, con sus propios requisitos
  (sección 15 y `definition-of-done.md`, Go-Live v1.0).

**Estado al 2026-10-11: en ejecución, 6 de 7 documentos `AUTHORIZED` en Pruebas.**

- Q-47 quedó resuelta por política de producto el 2026-10-09 y ya no bloquea la certificación ni el
  go-live (sección 2). Rige la política conservadora de tamaño de EmiteYa, la misma en Pruebas y en
  Producción (sección 2.1).
- **NEW REAL P12 CERTIFICATION READY: YES.** El P12 reemitido de Security Data, con el RUC, pasó el
  ensayo offline completo el 2026-10-10 (sección 5, «Ensayo 3»). Está fuera del repositorio, con
  permisos `600`.
- **CERTIFICATE EXPIRY: 2026-11-12.** La certificación en Pruebas tiene que terminar antes. No es un
  defecto del producto.
- La lista del entorno de Pruebas (`sri-test-environment-checklist.md`) quedó completa: la readiness
  de la sesión dio 19/19 antes y después de aplicar la lista de permitidos de salida.
- **`AUTHORIZED` en Pruebas** (sección 13), uno a la vez y cada uno con la autorización expresa del
  dueño:
  - la factura 01 a consumidor final `001-001-000000300`;
  - la factura 01 a comprador identificado `001-001-000000301`, base de 04, 05 y 06;
  - la nota de crédito 04 `001-001-000000100`, una devolución parcial de la 301;
  - la nota de débito 05 `001-001-000000100`, costos posteriores sobre la 301;
  - la guía de remisión 06 `001-001-000000100`, transporte propio con sustento en la 301;
  - la liquidación de compra 03 `001-001-000000100`, caso c) del art. 13 con
    `TEST_PURCHASE_SETTLEMENT_SUPPLIER`, sustento previsto de la 07.

  Al terminar cada sesión, la transmisión volvió a `SRI_TRANSMISSION_ENABLED=0`.
- Los siguientes secuenciales en Pruebas: 01 `302`, 03 `101`, 04 `101`, 05 `101`, 06 `101`; 07
  empieza en `100`. Producción nunca se contacta.

## 1. Compuertas

| Compuerta | Estado | Evidencia o acción |
| --- | --- | --- |
| Q-47: límite de tamaño en bytes | **Resuelta por política de producto** (2026-10-09, `RESOLVED_BY_PRODUCT_POLICY_V1`) | La ficha dice «320 Kb» sin definir la unidad (sección 2). La aplicación aplica su propia política conservadora, sin afirmar que sea la del SRI |
| Política conservadora de tamaño (`PRODUCT_CONSERVATIVE_POLICY_V1`) | Implementada (`adopt-conservative-sri-transmission-size-policy-v1`) | Menos de 40 000 bytes en el XML firmado, su base64 y el SOAP (sección 2.1). Los siete documentos miden como máximo 13 532 bytes (sección 2) |
| Vector oficial de la clave de acceso | Cumplida (2026-10-04) | Ficha v2.34, secciones 5.2 y 7.2.3, en `backend/test/sri-engine/access-keys.contract.test.ts`; extracto en `docs/product/sri-catalogs/fuentes/ficha-v2.34-clave-de-acceso.txt` |
| Endpoints y WSDL de Pruebas | Verificados el 2026-10-04; se vuelven a verificar al empezar la sesión | `docs/product/sri-wsdl/` con su SHA-256 (`wsdl-manifest.test.ts`) y `backend/src/modules/sri-engine/infrastructure/endpoints.ts` (sección 3) |
| P12 ecuatoriano real compatible | **Cumplida offline (2026-10-10)** con el P12 reemitido. **Vence el 2026-11-12** | Security Data, RUC en el OID `1.3.6.1.4.1.37746.3.11` igual al de la empresa, firma y XSD válidos, y los siete documentos dentro de la política v1 (sección 5, «Ensayo 3»). El P12 está fuera del repositorio, con permisos `600` |
| RUC habilitado en Pruebas | Cumplida (2026-10-10) | Confirmado por el operador con la lista de la sección 4; la primera factura quedó autorizada en Pruebas (sección 13) |
| Salida de red solo hacia Pruebas | Cumplida (2026-10-10) | Lista de permitidos aplicada y verificada, solo `celcer.sri.gob.ec:443` (`sri-egress-allowlist.md`, secciones 3 y 14) |
| Contrapartes de prueba | Cumplida (2026-10-10) | Configuradas fuera del repositorio con el consentimiento confirmado por el dueño; aquí solo figuran sus marcadores (sección 6) |
| Q-53 (dos ejemplares del RIDE de la liquidación) | No bloquea | Es una obligación de entrega, no de la transmisión; se revisa antes del go-live |
| Q-52 (edición vigente del Reglamento) | No bloquea | Revisión normativa separada |

## 2. Q-47: el límite de tamaño (resuelta por política de producto)

**Fuente oficial única.** Ficha técnica «Manual de usuario, catálogo y especificaciones técnicas.
Emisión de Comprobantes Electrónicos. Método de autorización Off-line», versión 2.34 (julio de 2026),
SHA-256 `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9`. El extracto literal está en
`docs/product/sri-catalogs/fuentes/ficha-v2.34-limite-de-tamano.txt`.

- **Texto exacto** (página 20, sección 7.5, «Procesos que ejecuta el Sistema de Autorización de
  Documentos Electrónicos»): «El límite máximo en tamaño y número de comprobantes electrónicos a ser
  validados y autorizados por lote es de 500 kb o 50 comprobantes aproximadamente (considerando cada
  comprobante con un solo ítem); mientras que, para el envío individual, el tamaño máximo por
  comprobante será de 320 Kb.»
- **Unidad:** no definida. La misma página da «500 kb» y «512 kb» para el mismo límite del lote, y la
  ficha usa «Kbps» para kilobits por segundo (páginas 16 y 21). No fija si «Kb» son kilobits o
  kilobytes, ni si un kilo vale 1000 o 1024.
- **A qué bytes se aplica:** no definido. Dice «por comprobante», en la validación de la recepción.
  El código 26, «Tamaño máximo superado», dice «Tamaño del archivo supera lo establecido» (RECEPCIÓN),
  sin cifra. No dice si mide el XML firmado, su base64 en el SOAP o el sobre completo. Por eso la
  política del producto mide las tres representaciones (sección 2.1).
- **A qué comprobantes y versiones aplica:** a cualquier comprobante del envío individual del esquema
  off-line, sin distinguir tipo ni versión del XSD.
- **Qué pasa al excederlo:** el SRI devuelve el código 26 en la recepción. La aplicación no llega a
  ese punto: un comprobante que excede su política no se envía. El job se detiene con
  `TRANSMISSION_SIZE_POLICY_EXCEEDED` y el comprobante queda `SIGNED`, sin llamar al SRI.
- **Búsquedas.** Las del 2026-10-03, el 2026-10-04 y el 2026-10-09 solo encontraron versiones de la
  ficha con el mismo texto; la 2.34 sigue siendo la vigente. Una guía oficial de preguntas frecuentes
  de facturación electrónica figura en la biblioteca del SRI, pero no se ha leído: obtenerla y
  revisarla es la primera vía de resolución.

### Medición frente a las lecturas posibles

Ninguna de estas cifras es oficial y ninguna se adopta como lectura del texto del SRI. La política
del producto coincide en número con la lectura más restrictiva por decisión conservadora propia, no
porque el SRI la defina. Las cifras muestran qué documentos del MVP quedarían en juego según cómo se
lea «320 Kb».

| Lectura posible de «320 Kb» | Bytes |
| --- | --- |
| Kilobits decimales | 40 000 |
| Kilobits binarios | 40 960 |
| Kilobytes decimales | 320 000 |
| Kibibytes | 327 680 |

| Tipo | Caso medido | XML firmado (bytes) | Fuente |
| --- | --- | --- | --- |
| 01 | Factura de 1 a 5 líneas | mediana 8 344; P95 9 463; máximo 9 482 | `benchmarks/emission-2026-10-03` |
| 07 | Peor caso con los límites por defecto | 46 614 | `benchmarks/withholding-receipts-2026-10-06` |
| 07 | Peor caso con los máximos absolutos | 230 114 | ídem |
| 06 | Peor caso con los límites por defecto | 78 827 | `benchmarks/shipping-guides-2026-10-06` |
| 06 | Peor caso con los máximos absolutos | 168 062 | ídem |
| 03 | Peor caso con los valores por defecto (100 líneas, 10 pagos) | 156 132 | `benchmarks/purchase-settlements-2026-10-07` |
| 03 | Máximos absolutos | 740 185 | ídem |
| 03 | Configurado a 1000 líneas | 1 467 936 | `benchmarks/purchase-settlements-2026-10-07-maximo-1000` |
| 01 de 100 líneas, 04 de 100 líneas, 05 de 100 conceptos | Sin medir | — | Pendiente (sección 14) |

### Los siete documentos de la certificación (medición offline del 2026-10-09)

Es evidencia de margen frente a la política conservadora de la sección 2.1, no una prueba del límite
oficial del SRI.

Se miden con `corepack pnpm --filter @facturador/backend measure:certification-payloads`
(`backend/test/manual/measure-certification-payloads.ts`), sin red, sin SRI y sin base de datos. Cada
documento de la sección 7:

- se construye con el builder real;
- se valida contra el XSD registrado;
- se firma con los P12 sintéticos del repositorio (RSA 2048 y RSA 4096).

Se miden tres representaciones:

- el XML firmado en UTF-8;
- su base64 en `validarComprobante`;
- el sobre SOAP completo de la recepción, que es el cuerpo de la petición HTTP sin sus cabeceras.

Hay dos perfiles de datos: el típico, y el de textos largos, con la razón social y las direcciones de
unos 280 caracteres.

| Documento | Típico, RSA 2048: XML / base64 / SOAP | Textos largos, RSA 4096: XML / base64 / SOAP |
| --- | --- | --- |
| 01 consumidor final | 6 968 / 9 292 / 9 572 | 8 849 / 11 800 / 12 080 |
| 01 comprador identificado | 7 626 / 10 168 / 10 448 | 9 938 / 13 252 / **13 532** |
| 04 nota de crédito | 7 090 / 9 456 / 9 736 | 9 227 / 12 304 / 12 584 |
| 05 nota de débito | 6 620 / 8 828 / 9 108 | 8 757 / 11 676 / 11 956 |
| 06 guía de remisión | 6 891 / 9 188 / 9 468 | 9 598 / 12 800 / 13 080 |
| 07 retención | 7 520 / 10 028 / 10 308 | 9 657 / 12 876 / 13 156 |
| 03 liquidación de compra | 7 168 / 9 560 / 9 840 | 9 477 / 12 636 / 12 916 |

- **Máximo observado:** 13 532 bytes (el SOAP de la factura con comprador identificado, con textos
  largos y RSA 4096).
- **Margen hasta 40 000:** 26 468 bytes.
- **El certificado real.** El certificado embebido sintético mide 947 bytes DER con RSA 2048 y 1 203
  con RSA 4096. Cada byte más del certificado real suma 4/3 en el XML y 16/9 en el SOAP. Por eso el
  certificado real puede ser hasta 14 887 bytes DER mayor que el sintético de 4096 antes de alcanzar
  el límite de la política en el peor caso. El tamaño exacto se ve en el ensayo offline con el P12
  real (sección 5).

- **Documentos de certificación** (pocas líneas, como los de la sección 7): rondan los 8 a 10 KB.
  Quedan por debajo de todas las lecturas.
- **Con la política v1,** con los límites por defecto, la retención de peor caso (46 614 bytes), la
  guía (78 827) y la liquidación (156 132) no se transmiten: `TRANSMISSION_SIZE_POLICY_EXCEEDED`, sin
  llamada y sin recortarlas.
- **Límites de recursos frente a transmisibilidad.** Los límites de líneas, destinatarios, detalles,
  sustentos o pagos son defensas de recursos de los borradores: no garantizan que un comprobante sea
  transmisible. Un comprobante válido puede superar la política. En ese caso no se transmite ni se
  recorta, y el usuario debe reducir o dividir el contenido cuando el tipo lo permita. Los límites
  actuales no se reducen por esta política.

### Resolución (2026-10-09)

Ninguna fuente primaria fijó la unidad ni los bytes medidos. El dueño del producto resolvió Q-47 por
**política de producto** (`RESOLVED_BY_PRODUCT_POLICY_V1`): EmiteYa aplica su política conservadora
de la sección 2.1 en Pruebas y en Producción, sin afirmar que sea el límite oficial del SRI. Q-47 deja
de ser una compuerta de la certificación y del go-live. Solo se revisa con evidencia oficial nueva del
SRI, mediante una decisión y un change nuevos, sin reabrir Q-47.

## 2.1 Política conservadora de tamaño de EmiteYa (`PRODUCT_CONSERVATIVE_POLICY_V1`)

La implementó `adopt-conservative-sri-transmission-size-policy-v1`, que retiró la sesión de
certificación de `add-sri-certification-safety-cap` y el catálogo `sri-transmission-policy`.

**Regla.** Vale para todo envío individual al SRI, en Pruebas y en Producción. Justo antes de enviar a
la recepción, el sistema construye una sola vez el cuerpo final y mide tres cosas. Ese mismo cuerpo es
el que recibe el transporte:

- `signedXmlBytes`, el XML firmado en UTF-8;
- `base64PayloadBytes`, su base64 exacto;
- `soapRequestBytes`, el cuerpo SOAP completo.

Solo envía si las tres son menores que 40 000 (39 999 pasa; 40 000 y 40 001 no).

- **Qué es:** una decisión conservadora del producto, fija en el código.
- **Qué no es:** no es configurable, ninguna variable de entorno la cambia y no es el límite oficial
  del SRI.

**Bloqueo antes de la red.** Si alguna medida llega a 40 000, el job se detiene con
`TRANSMISSION_SIZE_POLICY_EXCEEDED`:

- sin llamada, sin intento con el SRI y sin respuesta;
- sin transición fiscal;
- distinto de un `RETURNED`, de un `NOT_AUTHORIZED` y del código 26 del SRI.

El documento nunca se recorta, comprime, altera ni divide. El usuario ve: «El comprobante excede el
límite de seguridad de transmisión de EmiteYa. Reduzca el contenido antes de enviarlo.»

**La política no habilita la transmisión.** Sigue haciendo falta `SRI_TRANSMISSION_ENABLED=1`, que
nace apagada, con sus precondiciones técnicas: endpoints válidos y al menos un worker.

**Producción durante la certificación.** La política no prohíbe Producción. Durante la certificación
real, el aislamiento es operativo (secciones 3 y 14):

- la empresa en el ambiente de Pruebas;
- los endpoints de Producción sustituidos por un destino no enrutable;
- una lista de permitidos externa solo hacia `celcer.sri.gob.ec`;
- la transmisión habilitada solo durante la sesión controlada.

**Diagnóstico sin secretos.**
- `/health/ready` publica `sriSizePolicy`:
  - `source`, que es `PRODUCT_CONSERVATIVE_POLICY_V1`, nunca `SRI_OFFICIAL_POLICY`;
  - `limitBytes`;
  - la última comprobación: las tres medidas, `allowed` y `blockReason`.
- Métrica: `sri_transmission_size_policy_blocks_total`, sin etiquetas.
- Cada comprobación deja un registro con el ambiente fiscal y las medidas, sin el XML, el base64 ni
  el SOAP.

## 3. Endpoints y salida de red

**Endpoints de Pruebas.** Son las direcciones `soap:address` de los WSDL oficiales descargados de
Pruebas el 2026-10-04, con su SHA-256 (`docs/product/sri-wsdl/README.md`). La aplicación los usa por
defecto para un comprobante del ambiente de Pruebas.

| Servicio | URL | Uso |
| --- | --- | --- |
| Recepción | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline` | `validarComprobante` (XML en base64) |
| Autorización | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline` | `autorizacionComprobante` por clave: autorización, sondeo y reconciliación |
| Consulta de validez | `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/ConsultaComprobante` | `consultarEstadoAutorizacionComprobante`: guarda previa a un reenvío |

**Verificación al empezar la sesión, con autorización del dueño.** Se descarga cada `?wsdl` de
Pruebas con un solo `GET` de lectura y se compara su SHA-256 con el README. Si cambió, se detiene la
sesión: hay que revisar el contrato.

**Producción no se usa, nunca.** Durante toda la certificación, el SRI de Producción
(`cel.sri.gob.ec`) queda fuera de cualquier interacción, sin excepción para pruebas:

- pruebas de humo, health checks ni diagnósticos de conectividad;
- DNS, TCP, HTTP ni SOAP;
- Recepción, Autorización, ConsultaComprobante, reconciliación ni descarga de WSDL.

El bloqueo se comprueba revisando la configuración, nunca intentando llegar a Producción. Para que
ningún error de configuración llegue a `cel.sri.gob.ec`, la sesión aplica tres capas:

1. **La empresa solo está en Pruebas.** La sesión se hace en una instalación nueva con la empresa en el
   ambiente de Pruebas, y nunca se cambia el ambiente durante la sesión. Los endpoints salen del
   ambiente de cada comprobante.
2. **Los endpoints de Producción no van a ninguna parte.**
   `SRI_ENDPOINT_PRODUCTION_RECEPTION`, `_AUTHORIZATION` y `_VALIDITY` se sobrescriben con una URL
   `https` que no lleva a ningún sitio. Por ejemplo, un puerto cerrado de `127.0.0.1`: es válida para
   la configuración y falla en el transporte.
3. **La salida de red solo permite Pruebas.** La lista de permitidos de `sri-egress-allowlist.md`
   admite únicamente `celcer.sri.gob.ec:443`:
   - la aplicación corre en un espacio de nombres de red sin interfaces;
   - su única salida es un proxy `CONNECT` que bloquea Producción con `PRODUCTION_ACCESS_BLOCKED`;
   - tiene procedimientos APPLY, VERIFY y ROLLBACK, con falla cerrada y sin `sudo`.

## 3.1 Interruptor de la transmisión

- **Por defecto.** `SRI_TRANSMISSION_ENABLED` es `0` (`backend/src/config/env.ts`) y no se cambia.
  Con `0`, la firma y el barrido crean los jobs `sri.*`, pero el runner no los toma: ninguna llamada
  de red.
- **Habilitación, solo durante la sesión.** Un proceso propio de la certificación, separado de
  cualquier otro despliegue, arranca con un archivo de entorno fuera del repositorio:
  - `NODE_ENV=production`;
  - `SRI_TRANSMISSION_ENABLED=1`;
  - `SRI_JOB_WORKERS=1`;
  - las tres sobrescrituras de Producción;
  - el proxy de la lista de permitidos;
  - la custodia habilitada con su clave maestra en `CERTIFICATE_MASTER_KEY_FILE`.

  Antes de emitir se comprueba lo siguiente. Si la readiness da `503`, se corrige la precondición
  que nombra el log; no se rodea.
  - `/health/ready` responde `200` con `"sriTransmission": "enabled"`;
  - `sriSizePolicy` informa la fuente `PRODUCT_CONSERVATIVE_POLICY_V1` y `limitBytes: 40000`;
  - `sri_transmission_enabled` vale `1` en `/metrics`.
- **Vuelta a fallar cerrado.** Hay tres formas, de la más suave a la más inmediata:
  1. Parar el proceso (`SIGTERM`): el runner espera hasta 8 s a los jobs en curso y vence los
     arriendos.
  2. Reiniciarlo con `SRI_TRANSMISSION_ENABLED=0`.
  3. Si hay prisa, cortar el proxy de la lista de permitidos: toda llamada falla en el transporte y
     nada sale.

  Los comprobantes pendientes conservan su estado y se reconcilian por clave al volver.

## 4. Lista del RUC en Pruebas

La comprueba el operador en los canales del SRI antes de la sesión. La aplicación no crea ni modifica
nada en el SRI.

- [ ] El RUC está activo y habilitado para emitir comprobantes electrónicos en el **ambiente de Pruebas**.
- [ ] Están habilitados los seis tipos (01, 03, 04, 05, 06 y 07), o se conoce cuáles no lo están.
- [ ] El establecimiento que se usará está registrado y abierto en el RUC, con su código (por ejemplo
  `001`). El código 56 de la ficha es «Establecimiento cerrado».
- [ ] Se eligió un código de punto de emisión que no se haya usado antes en Pruebas con este RUC, o se
  conoce el último secuencial usado por tipo en ese establecimiento y punto. Un secuencial repetido
  da el código 45 (sección 8).
- [ ] El titular del P12 corresponde al RUC: la persona natural o el representante legal.
- [ ] Los datos tributarios que se configurarán coinciden con el registro del SRI, porque van al XML:
  - razón social y nombre comercial;
  - dirección de la matriz y del establecimiento;
  - obligado a llevar contabilidad;
  - contribuyente especial (número de resolución);
  - agente de retención (resolución);
  - régimen RIMPE.
- [ ] Hay un canal para consultar al SRI si aparece una respuesta desconocida.

## 5. Certificado real

**Contrato operativo de la aplicación**, verificado en el código y en el ADR 0019:

- **Carga.** El P12 se carga desde la interfaz, en «Firma electrónica», con su contraseña en el
  formulario. La API lo inspecciona y lo guarda cifrado con la clave maestra de la custodia
  (`CERTIFICATE_MASTER_KEY` o `CERTIFICATE_MASTER_KEY_FILE`, nunca en la base).
- **Nada se reconstruye después.** El archivo ni la contraseña se vuelven a mostrar, a registrar ni a
  devolver. No hay ruta de archivo ni contraseña en variables de entorno: el archivo queda fuera del
  repositorio, en el equipo del operador, y solo pasa por el formulario.
- **Formatos.** PKCS#12 moderno (PBES2, AES-256, MAC SHA-256), legado (RC2-40 y 3DES) o solo 3DES.
  Una clave RSA de al menos 2048 bits. El certificado del titular debe ir primero en la cadena. El
  archivo decodificado no puede superar `CERTIFICATE_MAX_BYTES` (64 KiB por defecto, configurable).
- **Iteraciones.** La inspección admite hasta 131 072 iteraciones por contador (el MAC y cada
  cifrado), antes de descifrar nada. El perfil observado en Security Data entra: MAC 102 400,
  cifrado 51 200. Ver ADR 0019, «Techo de iteraciones».
- **Contraseña no ASCII.** Funciona con los formatos legados. Con PBES2, el P12 se rechaza al cargarlo,
  con un mensaje que pide exportarlo de nuevo con una contraseña ASCII (limitación de S-6).
- **RUC del certificado: compatibilidad por proveedor.** El RUC se extrae solo con extractores
  documentados (`ruc-extractors.ts`).
  - **Security Data está SUPPORTED** por su documentación pública (ADR 0019, «Compatibilidad por
    proveedor»): OID `1.3.6.1.4.1.37746.3.11` en los certificados de firma de persona natural con
    RUC, miembro de empresa y representante legal. Esto no afirma que el P12 concreto del operador
    sea compatible: se valida en el ensayo offline de esta sección.
  - Se rechazan con `CERTIFICATE_RUC_NOT_FOUND`:
    - un certificado de persona natural sin RUC;
    - un **sello electrónico**, que lleva el RUC en `2.5.4.97` como `VATEC-<RUC>`.
  - El RUC extraído debe coincidir con el de la empresa.
- **Firma.** XAdES-BES con los parámetros del ADR 0013.
- **Metadatos seguros que muestra la interfaz:**
  - titular y emisor;
  - número de serie;
  - huella SHA-256 del certificado;
  - vigencia;
  - algoritmo y tamaño de la clave;
  - RUC detectado y si coincide con el de la empresa;
  - si la firma es utilizable.

**Antes de abrir el P12 real**, el operador ya informó la entidad: Security Data. Si el P12 es un
PKCS#12 moderno y la carga falla por una contraseña no ASCII, se detiene y se pide exportarlo de
nuevo con una contraseña ASCII. El P12 original nunca se transforma en silencio.

**Procedimiento, cuando el dueño lo autorice.** Nunca se imprime la contraseña, los bytes, el base64
ni la clave privada; no se usa `cat`, `printenv`, volcados de `process.env`, base64, `hexdump` ni
logs.

1. **Instalación de ensayo descartable.** Esquema propio, mismo commit, `NODE_ENV=production`,
   `SRI_TRANSMISSION_ENABLED=0` y una clave maestra nueva en un archivo de secreto. Sin salida de red
   hacia el SRI.
2. **Carga del P12** desde la interfaz. Se anotan solo los metadatos seguros de la lista anterior.
3. **Firma local de un documento sintético.** Una factura a consumidor final, en Pruebas, queda
   `SIGNED` y no se envía porque la transmisión está apagada. Se descarga el XML firmado y se
   comprueban fuera de línea:
   - el XSD registrado;
   - la firma XAdES;
   - el certificado embebido, que debe ser el del titular.
4. **Se descarta la instalación de ensayo:** su esquema, su clave maestra y la factura firmada. Así,
   una factura con fecha antigua no llega nunca al SRI; el código 65 de la ficha es «Fecha de emisión
   extemporánea».
5. **Certificación real** en una instalación nueva (sección 6), con el mismo P12 cargado de la misma
   forma.

**Ensayos offline del P12 real (2026-10-09).** Se usaron los módulos reales de la aplicación, sin
red. Solo se registran datos no sensibles.

- **Ensayo 1: rechazado.**
  - Motivo: `CERTIFICATE_INCOMPATIBLE:ITERATIONS`, antes de comprobar la contraseña.
  - El P12 es un PKCS#12 legado: MAC SHA-1 con 102 400 iteraciones, y clave 3DES y certificados
    RC2-40 con 51 200 cada uno. Superaba el techo anterior de 100 000.
  - Se resolvió con `support-security-data-pkcs12-iteration-profile` (techo de 131 072), sin
    convertir ni reexportar el archivo.
  - Incidente: DNS lookup occurred; no TCP/HTTP/SOAP connection.
- **Ensayo 2 (con el techo de 131 072): el contenedor es compatible, el certificado no trae el RUC.**
  - Sin red, en un espacio de nombres de red sin interfaces, con `SRI_TRANSMISSION_ENABLED=0` y la
    contraseña leída de la configuración local.
  - Los contadores son [102 400, 51 200, 51 200]. El lector abre el P12.
  - El importador real en el pool de producción pasa: inspección, firma de prueba, verificación de la
    firma y certificado embebido igual al inspeccionado.
  - Emisor Security Data, vigente, clave RSA de 2048 bits y cadena de tres certificados.
  - **Se detiene en el RUC.**
    - El certificado del titular no trae la extensión `1.3.6.1.4.1.37746.3.11`.
    - Trae en `1.3.6.1.4.1.37746.3.1` un valor de 10 dígitos que coincide con los diez primeros del
      RUC de la empresa.
    - El RUC de la empresa no aparece en ningún campo del certificado, y no es un sello electrónico
      (sin `2.5.4.97`).
    - Es un certificado de persona natural sin el campo RUC. La carga lo rechazaría con
      `CERTIFICATE_RUC_NOT_FOUND`, como fija la especificación, porque el SRI rechaza las firmas cuyo
      certificado no contiene RUC.
  - **No se ejecutaron** el XSD ni la medición de los siete documentos: el ensayo se detiene en la
    compuerta del RUC.
  - **Resultado: `BLOCKED_BY_CERTIFICATE_PROFILE` / `CERTIFICATE_RUC_NOT_FOUND`.**

    | Comprobación | Resultado |
    | --- | --- |
    | Inspección del contenedor | PASS |
    | Descifrado e importación | PASS |
    | Firma de prueba y su verificación | PASS |
    | Emisor Security Data | PASS |
    | Vigencia | PASS |
    | Requisito del RUC | FAIL |
    | Elegible para la certificación | FAIL |

    - PKCS12 CONTAINER COMPATIBLE: YES.
    - CRYPTOGRAPHICALLY USABLE: YES.
    - SRI IDENTITY REQUIREMENT SATISFIED: NO.
    - REAL P12 CERTIFICATION READY: NO.

    El P12 se clasifica como `CRYPTOGRAPHICALLY_COMPATIBLE` pero
    `NOT_SRI_CERTIFICATION_ELIGIBLE_FOR_THIS_COMPANY`. No es un defecto de la aplicación.
- **Decisión del dueño sobre el certificado sin RUC (2026-10-09).** Se mantiene la regla vigente: el
  certificado para facturación electrónica debe contener el RUC. Fuentes en el ADR 0019, «Certificados
  sin RUC».
  - No se deriva el RUC como la cédula seguida de `001`.
  - No se modifica el extractor de identidad.
  - No se abre un change para aceptar certificados sin RUC.
  - No se modifica la empresa, y no se prueba contra el SRI con este certificado.
- **EXTERNAL CERTIFICATE REISSUE REQUIRED.** Responsable: externo, Security Data.
  - El operador consulta a Security Data, fuera de la aplicación, por la reemisión o corrección de un
    certificado para facturación electrónica que incluya el RUC. Esa gestión no se automatiza.
  - El P12 nuevo o reexportado usa una **contraseña nueva**: la actual no se reutiliza porque quedó
    expuesta. Debe ser ASCII y suficientemente fuerte, por la limitación conocida de PKCS#12 moderno
    con contraseñas no ASCII. Nunca se pide ni se comparte por chat.
- **Cuando llegue el P12 nuevo**, se repite exactamente el ensayo offline:
  1. el techo de iteraciones;
  2. la importación del PKCS#12;
  3. el emisor;
  4. el OID `1.3.6.1.4.1.37746.3.11`;
  5. la lectura del RUC;
  6. RUC igual al de la empresa;
  7. la vigencia;
  8. la firma y su verificación;
  9. el XSD de los siete documentos;
  10. la medición del XML firmado, su base64 y el SOAP;
  11. la política conservadora de tamaño (< 40 000 bytes en las tres medidas).

  Solo después: READY FOR SRI TEST ENVIRONMENT CHECKLIST.
- **Ensayo 3 (2026-10-10), con el P12 reemitido: PASS.**
  - **Condiciones:** sin red, en un espacio de nombres de red sin interfaces, con
    `SRI_TRANSMISSION_ENABLED=0`. El P12 estaba fuera del repositorio con permisos `600`, y la
    contraseña nueva se leyó de la configuración local.
  - **Contenedor:** contadores con un máximo de 102 400, dentro del techo de 131 072. El lector y el
    importador real en el pool lo abren: inspección, firma de prueba y verificación.
  - **Certificado:**
    - emisor Security Data;
    - OID `1.3.6.1.4.1.37746.3.11` presente, con un RUC legible e igual al de la empresa;
    - vigente del 2026-10-09 al **2026-11-12**;
    - RSA 2048, firma del certificado `sha256WithRSAEncryption` y cadena de tres certificados;
    - perfil soportado.
  - **Los siete documentos:** datos sintéticos, firma con el firmador real en el pool y la firma XML
    `rsa-sha1` del ADR 0013. En los catorce casos (dos perfiles de datos por documento) pasan:
    - el XSD antes y después de firmar;
    - la firma, verificada con la clave del certificado embebido;
    - el certificado embebido, igual al importado;
    - los digests de las tres referencias, comprobados con un verificador independiente.

    Medidas del perfil típico, en bytes:

    | Documento | XML firmado | base64 | SOAP | Política v1 |
    | --- | --- | --- | --- | --- |
    | 01 consumidor final | 9 434 | 12 580 | 12 860 | PASS |
    | 01 comprador identificado | 10 092 | 13 456 | 13 736 | PASS |
    | 04 nota de crédito | 9 556 | 12 744 | 13 024 | PASS |
    | 05 nota de débito | 9 086 | 12 116 | 12 396 | PASS |
    | 06 guía de remisión | 9 357 | 12 476 | 12 756 | PASS |
    | 07 retención | 9 986 | 13 316 | 13 596 | PASS |
    | 03 liquidación de compra | 9 634 | 12 848 | 13 128 | PASS |

    Con textos largos, el máximo es 15 460 bytes de SOAP (01 con comprador identificado), con un
    margen de 24 540 hasta 40 000.
- **MOVE REAL P12 OUTSIDE REPOSITORY TREE: hecho (2026-10-10).**
  - El P12 que usa la configuración está fuera del repositorio, con permisos `600`.
  - La copia idéntica que había quedado en la raíz se borró con la autorización del operador, tras
    comprobar por hash que era igual al archivo externo.
  - Se retiró el patrón temporal de `.git/info/exclude`. Ningún nombre real figura en `.gitignore`.

## 6. Instalación y datos de la certificación

- **Instalación nueva y aislada:**
  - base o esquema propios;
  - el mismo commit que se piensa desplegar, que se anota;
  - la empresa con el RUC del operador y el ambiente de **Pruebas** desde el primer momento.
- **Establecimiento.** El código registrado en el RUC, normalmente `001`. Una guía de traslado entre
  establecimientos propios necesita dos establecimientos registrados; si el RUC solo tiene uno, esa
  variante no se certifica.
- **Punto de emisión** dedicado a la certificación (sección 4).
- **Productos sintéticos:**
  - un bien con control de stock e inventario inicial suficiente (por ejemplo 100);
  - un servicio.

  Los nombres llevan la palabra «PRUEBA».
- **Contrapartes.** No se usan identidades reales de terceros ni números inventados con dígito
  verificador válido, porque pueden pertenecer a una persona real.
  - **Consumidor final:** `9999999999999`, el oficial, para la factura.
  - **Comprador, sujeto retenido y proveedor identificados:** el repositorio usa solo los marcadores
    `TEST_IDENTIFIED_BUYER`, `TEST_WITHHOLDING_SUBJECT` y `TEST_PURCHASE_SETTLEMENT_SUPPLIER`.
    - Sus valores viven en la configuración local y en la instalación.
    - Solo valen dos orígenes: una identidad bajo control del operador o una persona con consentimiento
      explícito por escrito.
    - No se inventan cédulas, y no se asume que un pasaporte sintético sea aceptado hasta comprobarlo
      en Pruebas (`sri-test-environment-checklist.md`, sección C).
  - **Proveedor de la liquidación:** según la política del producto, debe ser una persona sin RUC
    activo (cédula o pasaporte).
  - **Transportista de la guía:** el propio, la empresa (`SELF`), sin un tercero.

## 7. Orden y matriz

El orden minimiza las dependencias:
- 04, 05 y 06 necesitan una factura 01 `AUTHORIZED` de este sistema;
- la 04 no admite una factura a consumidor final;
- 07 y 03 son independientes.

Se emite **un comprobante a la vez** y no se pasa al siguiente hasta que el anterior termine en
`AUTHORIZED`.

| # | Tipo (versión XML) | Prerrequisito | Datos | Transición esperada | PASS |
| --- | --- | --- | --- | --- | --- |
| 1 | 01 factura (1.1.0) | Firma utilizable y readiness `200` | Consumidor final por debajo del monto máximo; una línea del bien con IVA 15 % | `RESERVED → SIGNED → RECEIVED → AUTHORIZED` | `AUTHORIZED`, el inventario descuenta una vez, el RIDE se genera |
| 2 | 01 factura (1.1.0) | 1 | Comprador identificado según la sección 6; el bien y el servicio; forma de pago | Ídem | Ídem; es la factura base de 3, 4 y 5 |
| 3 | 04 nota de crédito (1.1.0) | 2 `AUTHORIZED` | Devolución parcial del bien con retorno físico | Ídem | `AUTHORIZED`, `DEVOLUCION_NC` en el kárdex, crédito de la factura actualizado |
| 4 | 05 nota de débito (1.0.0) | 2 `AUTHORIZED` | Un concepto de intereses de mora | Ídem | `AUTHORIZED`, sin movimiento de inventario |
| 5 | 06 guía de remisión (1.1.0) | 2 `AUTHORIZED` | Transporte propio, partida desde el establecimiento, destinatario de la factura, sustento la factura 2 | Ídem | `AUTHORIZED`, sin movimiento de inventario |
| 6 | 07 retención (2.0.0) | Ninguno | Proveedor según la sección 6; un sustento externo declarado; una retención de renta y una del IVA; período del mes en curso | Ídem | `AUTHORIZED`, sin movimiento de inventario |
| 7 | 03 liquidación de compra (1.1.0) | Ninguno | Proveedor sin RUC activo según la sección 6; las cuatro declaraciones; una línea; un pago | Ídem | `AUTHORIZED`, sin retención automática ni movimiento de inventario |

**Cobertura ampliada, opcional.** Solo después de los siete y sin repetir lo ya autorizado:
- factura con varias tarifas de IVA, descuento por línea, varias formas de pago y decimales en la
  frontera de la precisión;
- anulación total por nota de crédito;
- guía con transportista tercero.

## 8. Flujo y verificación por documento

`borrador → reserva → firma → envío a Recepción → RECIBIDA o DEVUELTA → Autorización → AUTORIZADO
o NO AUTORIZADO → artefacto autorizado → RIDE → archivo`.

Cada documento se emite desde la interfaz, como lo haría un usuario. Al terminar se verifica con
consultas de **solo lectura** y con la interfaz:

- **Documento** (`electronic_document`):
  - tipo, número, ambiente `TEST`;
  - versión del esquema;
  - estado `AUTHORIZED`;
  - `authorization_number`, `authorization_date` y `authorization_environment`.
- **Transiciones** (`document_state_transition`): `RESERVED → SIGNED → RECEIVED → AUTHORIZED`, con sus
  instantes, sin estados intermedios inesperados.
- **Intentos** (`sri_attempt`):
  - el `id` de cada intento y su operación;
  - el `endpoint`, que debe ser el de Pruebas de la sección 3;
  - `transport_outcome` y `http_status`;
  - `sent_artifact_sha256` y `sent_artifact_size`, iguales al `SIGNED_XML` de `document_artifact`;
  - `envelope_sha256`.
- **Respuestas.** El cuerpo original quedó guardado en `sri_response`, con su `sha256` y su tamaño,
  antes de clasificarse. En `sri_attempt_result` constan el resultado, los mensajes y la
  `classifier_version`.
- **Artefactos** (`document_artifact`): `SIGNED_XML` y `AUTHORIZED_XML` con su `sha256`. El autorizado
  contiene la clave del documento, y el RIDE se descarga desde el detalle.
- **Interfaz.** La sección «Transmisión al SRI» y su historial muestran el envío, la consulta y la
  autorización.

## 9. Errores, reconciliación y recuperación

No se provocan errores artificiales contra el SRI. El comportamiento negativo ya se probó contra el
SRI simulado (`manual-mvp-test-2026-10-09.md`, MVT-050 a MVT-054) y en las pruebas de recuperación A
a E (AC-06).

La matriz de `testing.md` (CTX §49) menciona además casos negativos en Pruebas: XSD inválido, firma
inválida, devuelto, no autorizado y timeout. La aplicación valida el XSD y la firma antes de enviar,
y no tiene rutas especiales para saltárselo. Ejecutarlos contra el SRI real exigiría documentos
fabricados fuera de la aplicación. Queda como decisión del dueño (`NEEDS_USER_DECISION`); este
runbook no los ejecuta.

Si un error ocurre de verdad, se sigue esta tabla:

| Situación | Lo que hace la aplicación | Lo que hace el operador |
| --- | --- | --- |
| SRI caído o timeout en la recepción | Reintenta con backoff y circuit breaker. Si no sabe si el SRI recibió, `SEND_UNKNOWN` y reconciliación por clave antes de cualquier reenvío | Espera; no vuelve a emitir ni crea otro documento |
| `RECIBIDA` pero la autorización tarda | `RECEIVED`, sondeo con backoff dentro de la ventana de conclusión (24 h); error 70: espera `SRI_ERROR70_DELAY_SECONDS` y reconcilia | Espera |
| Errores 43 o 45 | Reconciliación por clave | Si el 45 viene de un secuencial ya usado en Pruebas por otro sistema: detener (sección 10) y revisar la estrategia de la sección 4 |
| El proceso local cae después del envío | Al volver, el arriendo vence y el job reconcilia por clave. Solo reenvía el mismo XML si el SRI no conoce la clave y no hay evidencia de recepción | Revisa el historial; no fuerza nada |
| `DEVUELTA` (`RETURNED`) | Estado terminal con sus mensajes; no hay corrección automática (BR-28, capacidad futura) | Detener. Se analizan los mensajes guardados. La causa se corrige en un cambio y se emite un documento nuevo con otro secuencial |
| `NO AUTORIZADO` | Terminal (Q-07) | Detener y analizar |
| `MANUAL_REVIEW` | La transmisión espera una decisión humana | El administrador usa «Reconciliar con el SRI» con un motivo, que consulta por clave y aplica la evidencia. Nunca reenvía «de todas formas» |

### Observación: el primer envío de cada sesión (2026-10-10 y 2026-10-11)

En los cuatro documentos (300, 301, la 04 y la 05, sección 13) se dio la misma secuencia en cada sesión
nueva:
1. El primer envío a Recepción terminó a los 4,1 s en `CONNECTION_LOST` (`UND_ERR_SOCKET`), sin
   cabeceras.
2. La aplicación siguió la tabla de arriba: `SEND_UNKNOWN`, la misma clave sin evidencia en el SRI y
   el reenvío del mismo XML, que quedó `RECIBIDA` y `AUTORIZADO`.

No hubo secuencial nuevo ni duplicado. La investigación se hizo sin contactar el SRI, con un SRI
simulado (`improve-sri-transport-failure-diagnostics`).

- **Conocido.**
  - El fallo ocurrió con el túnel y el TLS ya establecidos y la solicitud en curso. Solo ahí la
    aplicación ve `UND_ERR_SOCKET`; un corte durante el TLS o justo tras el `CONNECT` da `ECONNRESET`.
  - El proxy y los puentes no cierran por su cuenta. La primera solicitud de un proceso nuevo pasa por
    la cadena completa.
  - Solo falló el primer envío grande con el TLS en frío. Los intentos con el TLS reanudado tardaron
    entre 69 y 236 ms.
  - El SRI no tenía la clave tras el primer intento.
- **Inferido.** Cerró el lado lejano, el SRI o un equipo del camino, unos segundos después de recibir
  la solicitud, sin responder. Un SRI simulado que calla y cierra a los 4 s reproduce la misma firma.
- **Desconocido.** La causa. Hay tres hipótesis:
  - un plazo del servidor sobre una primera conexión;
  - un equipo intermedio;
  - la MTU del camino en el primer envío grande.
- **Defecto local encontrado y corregido (no era la causa).** Si el destino fallaba con el túnel
  abierto, el proxy escribía `HTTP/1.1 502` dentro del túnel TLS.
- **Medido en la 04 y la 05 con el diagnóstico nuevo, de forma pasiva.** El primer túnel se
  comportó igual las dos veces:
  - conectó con el destino en 35 y 29 ms;
  - recibió del destino los mismos 3 093 bytes, el vuelo TLS del servidor, así que el TLS completó;
  - envió la solicitud completa: 15 261 y 14 657 bytes, del orden del reenvío que sí se recibió;
  - **el destino reseteó la conexión (`ECONNRESET`) exactamente 4 017 ms después del último byte del
    cliente**, sin enviar ningún byte de respuesta;
  - la aplicación escribió la solicitud completa y no leyó nada (`UND_ERR_SOCKET`).

  El caché de rutas del núcleo no tenía una MTU aprendida tras el fallo, lo que debilita la hipótesis
  de la MTU sin descartarla. Que el plazo sea idéntico sugiere un temporizador fijo del lado lejano
  sobre la primera conexión con el TLS sin reanudar. La causa última sigue fuera de lo observable.
- **En la guía 06 no se repitió (4 de 5).** El primer túnel, también con el TLS completo en una sesión
  nueva, recibió su respuesta en 341 ms. Así que no ocurre en toda primera conexión.
  No se hace ningún sondeo ni calentamiento contra el SRI para explicarlo, y la recuperación no
  cambia.
- **En la liquidación de compra 03 reapareció (5 de 6)**, con la misma firma:
  - el primer túnel conectó en 30 ms y recibió los 3 093 bytes del vuelo TLS;
  - envió la solicitud completa, 15 413 bytes;
  - el destino reseteó (`ECONNRESET`) 4 019 ms después del último byte del cliente, sin responder;
  - la aplicación escribió 13 649 bytes y no leyó ninguno.

  La recuperación fue la misma.

## 10. Condiciones de parada

La sesión se detiene de inmediato, con la transmisión vuelta a fallar cerrado (sección 3.1), si
ocurre cualquiera de estas condiciones. No se sigue «para ver qué pasa».

- **Compuertas:**
  - P12 rechazado, RUC del certificado distinto o firma no utilizable;
  - RUC no habilitado en Pruebas o tipo no habilitado.
- **Endpoints:**
  - un WSDL distinto del registrado;
  - un endpoint de un intento distinto de los de la sección 3;
  - cualquier destino de red que no sea `celcer.sri.gob.ec`.
- **Respuestas:**
  - una respuesta que el clasificador no reconoce;
  - un estado o código no previsto;
  - `DEVUELTA` o `NO AUTORIZADO`.
- **Integridad:**
  - el hash enviado no coincide con el del `SIGNED_XML`;
  - el `AUTHORIZED_XML` lleva otra clave;
  - una clave de acceso distinta de la reservada;
  - un secuencial inesperado.
- **Configuración:**
  - empresa, ambiente, establecimiento o punto equivocados;
  - un comprobante del ambiente de Producción;
  - cualquier intento de usar Producción.
- **Secretos:** un secreto aparece en un log, una pantalla o un archivo.

## 11. Evidencia

**Puede entrar al repositorio**, en el registro de la sección 13:
- fecha, commit y tipo;
- número del documento (establecimiento, punto y secuencial);
- resultado y estados con sus instantes;
- códigos y mensajes del SRI sin datos del contribuyente;
- `classifier_version`;
- SHA-256 de los artefactos y de las respuestas;
- notas redactadas.

**Queda fuera del repositorio**, en almacenamiento cifrado del operador:
- las claves de acceso y los números de autorización, que contienen el RUC;
- el RUC y la razón social;
- los XML firmados y autorizados, los RIDE y los cuerpos de las respuestas sin anonimizar.

**Nunca se guarda en ningún lado:** el P12, su contraseña, la clave privada, la clave maestra ni el
archivo de entorno.

## 12. Respuestas reales como fixtures

1. Exportar el cuerpo guardado (`sri_response.body`) de una recepción y una autorización de cada tipo,
   y de las respuestas con mensajes si las hubo.
2. Anonimizarlas:
   - RUC, razón social, nombres e identificaciones se reemplazan por los datos sintéticos de las
     pruebas;
   - la clave de acceso se recompone con esos datos y su dígito verificador;
   - nada de la firma ni del certificado del operador queda en el fixture.
3. Guardarlas como fixtures **reales anonimizados**, con la fecha y la versión de la ficha, junto a
   pruebas de cada clasificador.

## 13. Registro de la ejecución

| Fecha | Commit | Tipo | Número | Resultado | Códigos del SRI | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-10 | `352ed01` | 01 (consumidor final) | `001-001-000000300` | `AUTHORIZED` | Recepción y Autorización sin mensajes; en la reconciliación, ConsultaComprobante respondió el identificador 99 | Primer envío con la conexión perdida: `SEND_UNKNOWN`, reconciliación de la misma clave y reenvío del mismo XML. Detalle debajo |
| 2026-10-10 | `f4d9492` | 01 (comprador identificado) | `001-001-000000301` | `AUTHORIZED` | Recepción y Autorización sin mensajes; en la reconciliación, ConsultaComprobante respondió el identificador 99 | El mismo patrón que la 300: primer envío con la conexión perdida, `SEND_UNKNOWN`, reconciliación de la misma clave y reenvío del mismo XML. Es el documento base de 04, 05 y 06. Detalle debajo |
| 2026-10-11 | `bb9c18e` | 04 (devolución parcial) | `001-001-000000100` | `AUTHORIZED` | Recepción y Autorización sin mensajes; en la reconciliación, ConsultaComprobante respondió el identificador 99 | Una unidad del bien de la 301, con retorno físico; el inventario sube una vez. El mismo patrón del primer envío, ya con el diagnóstico. Detalle debajo |
| 2026-10-11 | `bb9c18e` | 05 (costos posteriores) | `001-001-000000100` | `AUTHORIZED` | Recepción y Autorización sin mensajes; en la reconciliación, ConsultaComprobante respondió el identificador 99 | Sobre la 301; sin efecto en el inventario ni en la capacidad de crédito. El mismo patrón del primer envío. Detalle debajo |
| 2026-10-11 | `7612887` | 06 (transporte propio) | `001-001-000000100` | `AUTHORIZED` | Recepción y Autorización sin mensajes | Sustento la 301; una unidad del bien, sin movimiento de inventario. Camino feliz: el primer túnel respondió sin la anomalía. Detalle debajo |
| 2026-10-11 | `d26317c` | 03 (caso c) del art. 13) | `001-001-000000100` | `AUTHORIZED` | Recepción y Autorización sin mensajes; en la reconciliación, ConsultaComprobante respondió el identificador 99 | Proveedor `TEST_PURCHASE_SETTLEMENT_SUPPLIER`; un servicio, sin movimiento de inventario y sin crear la 07. Reapareció el patrón del primer envío. Detalle debajo |
| Pendiente | | 07 | | | | |

Con los seis tipos en `AUTHORIZED`, S-3 online y AC-03 pasan a cumplidos aquí y en
`docs/product/open-questions.md`.

### 2026-10-10 · 01 consumidor final `001-001-000000300`

Commit `352ed01`, ambiente `TEST`, esquema `1.1.0`. Una línea de un bien con IVA 15 % (código 4 del
catálogo activo), por debajo del monto máximo del consumidor final. Las claves de acceso, los
números de autorización, los XML y las respuestas completas quedan fuera del repositorio
(sección 11).

- **Antes de la red.**
  - XSD `factura_V1.1.0` en `PASS`. Firma XAdES-BES válida: el valor de la firma y las tres
    referencias, con el certificado vigente de la empresa.
  - Clave de acceso de 49 dígitos con el dígito verificador correcto, ambiente `1`, serie `001001` y
    secuencial `000000300`.
  - Tamaños exactos: XML firmado 9 568 bytes, base64 12 760 y SOAP 13 040. Los tres quedan bajo la
    política v1 (menos de 40 000).
- **Estados**, en UTC:

  | De | A | Instante |
  | --- | --- | --- |
  | — | `RESERVED` | 18:01:05.509 |
  | `RESERVED` | `SIGNED` | 18:01:06.918 |
  | `SIGNED` | `SEND_UNKNOWN` | 18:08:51.926 |
  | `SEND_UNKNOWN` | `RECEIVED` | 18:08:54.422 |
  | `RECEIVED` | `AUTHORIZED` | 18:09:00.964 |

- **Intentos**, todos contra `celcer.sri.gob.ec` en `TEST`:

  | # | Operación | Transporte | Resultado (`classifier_version`) | SHA-256 del sobre | SHA-256 de la respuesta |
  | --- | --- | --- | --- | --- | --- |
  | 1 | Recepción | Conexión perdida (`UND_ERR_SOCKET`) | `UNKNOWN` (`reception/1`) | `610425dc…c0009a50` | — |
  | 2 | Autorización | HTTP 200 | `KEY_UNKNOWN`: cero comprobantes (`authorization/1`) | `35f32ff1…0aaa1730` | `6e1c88da…9df13b70` |
  | 3 | ConsultaComprobante | HTTP 200 | `NO_EVIDENCE`: `RECHAZADA`, identificador 99, «No existen datos para los parámetros ingresados» (`validity/2`) | `861f432d…52efad0d` | `81e5014f…68f340c4` |
  | 4 | Recepción | HTTP 200 | `RECEIVED`: `RECIBIDA`, sin mensajes (`reception/1`) | `610425dc…c0009a50` | `3f188de6…9b6f66b2` |
  | 5 | Autorización | HTTP 200 | `AUTHORIZED`: `AUTORIZADO`, ambiente `PRUEBAS` (`authorization/1`) | `35f32ff1…0aaa1730` | `8ae7ea91…0889f8a6` |

- **Reconciliación.** No llegó respuesta al primer envío, así que la aplicación no lo dio por enviado
  ni por devuelto: quedó en `SEND_UNKNOWN`. Antes de cualquier reenvío consultó la misma clave en
  Autorización y en ConsultaComprobante. Sin evidencia de recepción, reenvió el mismo XML, con el mismo
  SHA-256, y el sobre del intento 4 es idéntico al del intento 1. No hubo un secuencial nuevo, ni
  errores 43, 45 o 70.
- **Artefactos.**
  - `SIGNED_XML` y `AUTHORIZED_XML` son iguales: 9 568 bytes, SHA-256
    `a26329f6480f136700afaddb5bda057755e29b71a399ad4fade44ad89bc10394`.
  - `RIDE_PDF`: 23 243 bytes, SHA-256
    `9692c4ba7206f7038117f294d9bdb7581dd013dd078c3bf567b208ef41aafb52`.
  - El inventario descontó una vez (`SALIDA_FACTURA`).
- **Salida de red.** El registro del proxy tiene cinco `CONNECT` a `celcer.sri.gob.ec:443`, todos
  admitidos, ningún bloqueo y ningún intento hacia Producción.
- **Cierre.** La sesión volvió a `SRI_TRANSMISSION_ENABLED=0`, y la readiness dio 19/19. El siguiente
  secuencial de la factura en Pruebas es `301`.

### 2026-10-10 · 01 comprador identificado `001-001-000000301`

Commit `f4d9492`, ambiente `TEST`, esquema `1.1.0`. Es la factura base de 04, 05 y 06:
- el comprador identificado de la sección 6 (`TEST_IDENTIFIED_BUYER`);
- dos unidades del bien, que permiten una devolución parcial con retorno físico;
- una del servicio;
- IVA 15 % (código 4 del catálogo activo), forma de pago `01` y sin descuentos.

Las claves de acceso, los números de autorización, la identidad del comprador, los XML y las
respuestas completas quedan fuera del repositorio (sección 11).

- **Antes de la red.**
  - XSD `factura_V1.1.0` en `PASS`. Firma XAdES-BES válida: el valor de la firma y las tres
    referencias, con el certificado vigente de la empresa.
  - Clave de acceso de 49 dígitos con el dígito verificador correcto, ambiente `1`, serie `001001` y
    secuencial `000000301`.
  - Dos detalles. Tamaños exactos: XML firmado 10 149 bytes, base64 13 532 y SOAP 13 812. Los tres
    quedan bajo la política v1.
- **Sesión.** Una sesión nueva de la lista de permitidos, con `rollback` corregido
  (`fix-sri-egress-rollback-process-cleanup`). La readiness dio 19/19 antes del envío.
- **Estados**, en UTC:

  | De | A | Instante |
  | --- | --- | --- |
  | — | `RESERVED` | 22:23:59.089 |
  | `RESERVED` | `SIGNED` | 22:23:59.855 |
  | `SIGNED` | `SEND_UNKNOWN` | 22:25:28.680 |
  | `SEND_UNKNOWN` | `RECEIVED` | 22:25:31.206 |
  | `RECEIVED` | `AUTHORIZED` | 22:25:38.543 |

- **Intentos**, todos contra `celcer.sri.gob.ec` en `TEST`:

  | # | Operación | Transporte | Duración | Resultado (`classifier_version`) | SHA-256 del sobre | SHA-256 de la respuesta |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | Recepción | Conexión perdida (`UND_ERR_SOCKET`), sin cabeceras | 4 151 ms | `UNKNOWN` (`reception/1`) | `2fea9b27…93b6e4aa` | — |
  | 2 | Autorización | HTTP 200 | 2 074 ms | `KEY_UNKNOWN`: cero comprobantes (`authorization/1`) | `18682317…036f4a94` | `c418e57a…9fc48ee3` |
  | 3 | ConsultaComprobante | HTTP 200 | 87 ms | `NO_EVIDENCE`: `RECHAZADA`, identificador 99 (`validity/2`) | `480d3611…97a033f3` | `2b44ce1f…957ecefb` |
  | 4 | Recepción | HTTP 200 | 236 ms | `RECEIVED`: `RECIBIDA`, sin mensajes (`reception/1`) | `2fea9b27…93b6e4aa` | `3f188de6…9b6f66b2` |
  | 5 | Autorización | HTTP 200 | 85 ms | `AUTHORIZED`: `AUTORIZADO`, ambiente `PRUEBAS` (`authorization/1`) | `18682317…036f4a94` | `2b54867a…af91ea15` |

- **Reconciliación.** Lo mismo que en la 300. Tras la conexión perdida, el comprobante quedó en
  `SEND_UNKNOWN`. Se consultó la misma clave, sin evidencia de recepción, y se reenvió el mismo XML:
  el sobre del intento 4 es idéntico al del intento 1. No hubo un secuencial nuevo, ni errores 43, 45
  o 70.
- **Artefactos.**
  - `SIGNED_XML` y `AUTHORIZED_XML` son iguales: 10 149 bytes, SHA-256
    `b7e65f98f73796119d17b40fe9faf989a7e095254f10c136281c6d21ba8c3cba`.
  - `RIDE_PDF`: 23 638 bytes, SHA-256
    `b2f2940652bea8c206d327e5558565b2c4042806979688031aae46ea96d15404`.
  - El inventario descontó una vez, las dos unidades del bien (`SALIDA_FACTURA`).
- **Salida de red.** Cinco `CONNECT` a `celcer.sri.gob.ec:443`, todos admitidos, ningún bloqueo y
  ningún intento hacia Producción.
- **Cierre.**
  - La sesión se cerró con `rollback`: `ROLLED_BACK`, sin procesos de la sesión.
  - `SRI_TRANSMISSION_ENABLED=0`.
  - El siguiente secuencial de la factura en Pruebas es `302`.

### 2026-10-11 · 04 devolución parcial `001-001-000000100`

Commit `bb9c18e`, ambiente `TEST`, esquema `1.1.0`. Documento modificado: la factura 01
`001-001-000000301`, `AUTHORIZED`.
- Causa `RETURN`: una de las dos unidades del bien, con retorno físico. No acredita el servicio.
- Tratamiento del IVA tomado del snapshot de la factura: código 4, 15 %.
- Las dos declaraciones de elegibilidad, ciertas por construcción para una factura de Pruebas: no es
  una factura comercial negociada y no sustentó una devolución de impuestos.

- **Antes de la red.**
  - XSD `NotaCredito_V1.1.0` en `PASS`. Firma XAdES-BES válida, con sus tres referencias.
  - Clave de acceso con el dígito verificador correcto, ambiente `1`, tipo `04` y secuencial
    `000000100`.
  - Base 10,00 e IVA 1,50: `valorModificacion` 11,50.
  - Tamaños: XML firmado 9 675 bytes, base64 12 900 y SOAP 13 180.
  - Antes de autorizar, el inventario no se movió y la capacidad de crédito quedó reservada (11,50).
- **Estados**, en UTC:

  | De | A | Instante |
  | --- | --- | --- |
  | — | `RESERVED` | 00:19:09.795 |
  | `RESERVED` | `SIGNED` | 00:19:10.924 |
  | `SIGNED` | `SEND_UNKNOWN` | 00:20:02.809 |
  | `SEND_UNKNOWN` | `RECEIVED` | 00:20:05.494 |
  | `RECEIVED` | `AUTHORIZED` | 00:20:11.481 |

- **Intentos**, todos contra `celcer.sri.gob.ec` en `TEST`:

  | # | Operación | Transporte | Duración | Resultado (`classifier_version`) | SHA-256 del sobre | SHA-256 de la respuesta |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | Recepción | Conexión perdida (`UND_ERR_SOCKET`), sin cabeceras | 4 156 ms | `UNKNOWN` (`reception/1`) | `231b0948…9c301d03` | — |
  | 2 | Autorización | HTTP 200 | 2 115 ms | `KEY_UNKNOWN`: cero comprobantes (`authorization/1`) | `a16d0749…c2fb791e` | `8bfe234e…216f5abd` |
  | 3 | ConsultaComprobante | HTTP 200 | 83 ms | `NO_EVIDENCE`: `RECHAZADA`, identificador 99 (`validity/2`) | `1a621aa3…cc902d38` | `0240d44c…f522edf6` |
  | 4 | Recepción | HTTP 200 | 365 ms | `RECEIVED`: `RECIBIDA`, sin mensajes (`reception/1`) | `231b0948…9c301d03` | `3f188de6…9b6f66b2` |
  | 5 | Autorización | HTTP 200 | 110 ms | `AUTHORIZED`: `AUTORIZADO`, ambiente `PRUEBAS` (`authorization/1`) | `a16d0749…c2fb791e` | `0718283d…24bdbba3` |

- **Reconciliación.** Igual que en las facturas: la misma clave sin evidencia y el reenvío del mismo
  XML, con el mismo sobre. No hubo un secuencial nuevo, ni errores 43, 45 o 70.
- **Primer túnel.** Sin contenido; ver la observación de la sección 9.
  - La conexión con el destino tardó 35 ms.
  - Se enviaron 15 261 bytes al destino y llegaron 3 093.
  - El destino cerró con un reset (`ECONNRESET`) 4 017 ms después del último byte del cliente.
  - La aplicación escribió 13 497 bytes y no leyó ninguno.
- **Artefactos.**
  - `SIGNED_XML` y `AUTHORIZED_XML` son iguales: 9 675 bytes, SHA-256
    `a311cc5dd6733d5e3502cedd34b7a898211d2f5ceff2c061a51fabf46485ad7d`.
  - `RIDE_PDF`: 23 503 bytes, SHA-256
    `01b402fb626da7a39b91a69dfd0b0ad5ddfb5446e522102370481909dfdb8f61`.
- **Efectos.**
  - El inventario pasó de 7 a 8 con una `DEVOLUCION_NC` al autorizar.
  - La capacidad de crédito de la 301 queda con 11,50 aplicados y 17,25 disponibles; su línea del bien
    conserva una unidad.
  - La 301 sigue `AUTHORIZED` y sin cambios.
- **Cierre.** `rollback` dio `ROLLED_BACK`, sin procesos de la sesión, y la transmisión volvió a
  `0`. El siguiente secuencial 04 es `101`.

### 2026-10-11 · 05 costos posteriores `001-001-000000100`

Commit `bb9c18e`, ambiente `TEST`, esquema `1.0.0`. Documento modificado: la factura 01
`001-001-000000301`, `AUTHORIZED`.
- Un concepto con la causa `POST_INVOICE_COST_EXPENSE` y base 1,00.
- El tratamiento del IVA de la factura (`2:4`, 15 %, el único de su snapshot): impuesto 0,15 y
  total 1,15.
- Exactamente una forma de pago, `01`, por 1,15.
- La declaración de elegibilidad, cierta por construcción: no es una factura comercial negociada.

- **Antes de la red.**
  - XSD `NotaDebito_V1.0.0` en `PASS`. Firma XAdES-BES válida, con sus tres referencias.
  - Clave de acceso con el dígito verificador correcto, ambiente `1`, tipo `05` y secuencial
    `000000100`.
  - Tamaños: XML firmado 9 222 bytes, base64 12 296 y SOAP 12 576.
- **Estados**, en UTC:

  | De | A | Instante |
  | --- | --- | --- |
  | — | `RESERVED` | 04:12:47.486 |
  | `RESERVED` | `SIGNED` | 04:12:48.637 |
  | `SIGNED` | `SEND_UNKNOWN` | 04:13:36.525 |
  | `SEND_UNKNOWN` | `RECEIVED` | 04:13:39.727 |
  | `RECEIVED` | `AUTHORIZED` | 04:13:46.568 |

- **Intentos**, todos contra `celcer.sri.gob.ec` en `TEST`:

  | # | Operación | Transporte | Duración | Resultado (`classifier_version`) | SHA-256 del sobre | SHA-256 de la respuesta |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | Recepción | Conexión perdida (`UND_ERR_SOCKET`), sin cabeceras | 4 150 ms | `UNKNOWN` (`reception/1`) | `c7f98af8…be63d924` | — |
  | 2 | Autorización | HTTP 200 | 2 104 ms | `KEY_UNKNOWN`: cero comprobantes (`authorization/1`) | `0b58c760…53765e30` | `b132cb3b…3368df1d` |
  | 3 | ConsultaComprobante | HTTP 200 | 68 ms | `NO_EVIDENCE`: `RECHAZADA`, identificador 99 (`validity/2`) | `7991bddf…cc2ddc89` | `a8130bf6…f94cf4dd` |
  | 4 | Recepción | HTTP 200 | 903 ms | `RECEIVED`: `RECIBIDA`, sin mensajes (`reception/1`) | `c7f98af8…be63d924` | `3f188de6…9b6f66b2` |
  | 5 | Autorización | HTTP 200 | 103 ms | `AUTHORIZED`: `AUTORIZADO`, ambiente `PRUEBAS` (`authorization/1`) | `0b58c760…53765e30` | `5c541579…dd0345d7` |

- **Reconciliación.** La misma recuperación, sin un secuencial nuevo ni errores 43, 45 o 70.
- **Primer túnel.**
  - La conexión con el destino tardó 29 ms.
  - Se enviaron 14 657 bytes al destino y llegaron 3 093.
  - El destino cerró con un reset (`ECONNRESET`) 4 017 ms después del último byte del cliente.
  - La aplicación escribió 12 893 bytes y no leyó ninguno.
- **Artefactos.**
  - `SIGNED_XML` y `AUTHORIZED_XML` son iguales: 9 222 bytes, SHA-256
    `203378fc4c57f8f3232d2d4799f0394521e2623ee173f976d01a62882694faac`.
  - `RIDE_PDF`: 23 364 bytes, SHA-256
    `e7456a49db66906d3cdbe3e0d6089dcc0a2e7b2f8ac616b0e95fe8770e7ea83f`.
- **Efectos.**
  - Sin movimiento de inventario: sigue en 8.
  - La capacidad de crédito de la 301 sigue en 17,25 disponibles.
  - La 301 y la nota de crédito 04 siguen `AUTHORIZED` y sin cambios.
- **Cierre.** `rollback` dio `ROLLED_BACK`, sin procesos de la sesión, y la transmisión volvió a
  `0`. El siguiente secuencial 05 es `101`.

### 2026-10-11 · 06 guía de remisión `001-001-000000100`

Commit `7612887`, ambiente `TEST`, esquema `1.1.0`.
- Transporte propio (`SELF`): la empresa es el transportista.
- Partida desde el establecimiento 001, con fechas de transporte del día.
- Un destinatario, `TEST_IDENTIFIED_BUYER`, con motivo «Venta» y sustento en la factura 01
  `001-001-000000301` `AUTHORIZED`.
- Una unidad del bien, sin el servicio.

La dirección de destino y la placa quedan fuera del repositorio, autorizadas por el dueño.

- **Antes de la red.**
  - XSD `GuiaRemision_V1.1.0` en `PASS`. Firma XAdES-BES válida, con sus tres referencias.
  - Clave de acceso con el dígito verificador correcto, ambiente `1`, tipo `06` y secuencial
    `000000100`.
  - Los campos de transporte, destinatario y sustento coinciden con los datos locales, incluido el
    número de autorización de la 301.
  - Tamaños: XML firmado 9 563 bytes, base64 12 752 y SOAP 13 032.
- **Estados**, en UTC:

  | De | A | Instante |
  | --- | --- | --- |
  | — | `RESERVED` | 05:13:03.474 |
  | `RESERVED` | `SIGNED` | 05:13:04.602 |
  | `SIGNED` | `RECEIVED` | 05:13:59.124 |
  | `RECEIVED` | `AUTHORIZED` | 05:14:05.038 |

- **Intentos**, todos contra `celcer.sri.gob.ec` en `TEST`:

  | # | Operación | Transporte | Duración | Resultado (`classifier_version`) | SHA-256 del sobre | SHA-256 de la respuesta |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | Recepción | HTTP 200 | 465 ms | `RECEIVED`: `RECIBIDA`, sin mensajes (`reception/1`) | `ff04fbf7…29792ef9` | `3f188de6…9b6f66b2` |
  | 2 | Autorización | HTTP 200 | 98 ms | `AUTHORIZED`: `AUTORIZADO`, ambiente `PRUEBAS` (`authorization/1`) | `d121c982…274420d6` | `d2a931ee…c4883a93` |

- **Sin reconciliación.**
  - El primer túnel conectó en 24 ms y envió 15 113 bytes.
  - Recibió 4 824 bytes: el vuelo TLS y la respuesta.
  - El destino respondió 341 ms después del último byte del cliente y cerró con `FIN`.
  - No hubo errores 43, 45 o 70.
- **Artefactos.**
  - `SIGNED_XML` y `AUTHORIZED_XML` son iguales: 9 563 bytes, SHA-256
    `c7b3b4b0133557829dedd86f91bf08f7f723bc7d164d69304cbf305a8c69752d`.
  - `RIDE_PDF`: 23 988 bytes, SHA-256
    `c53c533a25c877ff340d4c7691fdebb9b5a6372dd5d45030343295ff3b2b2813`.
- **Efectos.**
  - Sin movimiento de inventario: sigue en 8.
  - La 301, la 04 y la 05 siguen `AUTHORIZED` y sin cambios.
- **Cierre.** `rollback` dio `ROLLED_BACK`, sin procesos de la sesión, y la transmisión volvió a
  `0`. El siguiente secuencial 06 es `101`.

### 2026-10-11 · 03 liquidación de compra `001-001-000000100`

Commit `d26317c`, ambiente `TEST`, esquema `1.1.0`.
- Política `PURCHASE_SETTLEMENT_ELIGIBILITY_V1`, regla `ART_13_C_RUSTICITY_NO_ACTIVE_RUC`, con sus
  cuatro declaraciones `USER_DECLARED`. El sistema no las verifica.
- Proveedor `TEST_PURCHASE_SETTLEMENT_SUPPLIER`: activo, con el rol de proveedor, identificado con
  cédula y con consentimiento escrito.
- Su dirección es un dato sintético de prueba, autorizado por el dueño solo para Pruebas, y no
  afirma el domicilio real. Va solo en el borrador y en el XML: no se escribió en Terceros. Queda
  fuera del repositorio.
- Una línea de servicio: 1 × 150,00 con el IVA `2:4` del catálogo vigente (15 %), impuesto 22,50 y
  total 172,50.
- Un pago `01` por 172,50 con plazo 0.

- **Antes de la red.**
  - XSD `LiquidacionCompra_V1.1.0` en `PASS`. Firma XAdES-BES válida, con sus tres referencias.
  - Clave de acceso con el dígito verificador correcto, ambiente `1`, tipo `03` y secuencial
    `000000100`.
  - Los campos del proveedor, de la línea, de los totales y del pago coinciden con los datos
    locales.
  - Tamaños: XML firmado 9 789 bytes, base64 13 052 y SOAP 13 332.
- **Estados**, en UTC:

  | De | A | Instante |
  | --- | --- | --- |
  | — | `RESERVED` | 15:56:59.405 |
  | `RESERVED` | `SIGNED` | 15:57:00.521 |
  | `SIGNED` | `SEND_UNKNOWN` | 15:58:28.839 |
  | `SEND_UNKNOWN` | `RECEIVED` | 15:58:31.427 |
  | `RECEIVED` | `AUTHORIZED` | 15:58:37.002 |

- **Intentos**, todos contra `celcer.sri.gob.ec` en `TEST`:

  | # | Operación | Transporte | Duración | Resultado (`classifier_version`) | SHA-256 del sobre | SHA-256 de la respuesta |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 | Recepción | Conexión perdida (`UND_ERR_SOCKET`), sin cabeceras | 4 161 ms | `UNKNOWN` (`reception/1`) | `1a335d21…489728f8` | — |
  | 2 | Autorización | HTTP 200 | 2 083 ms | `KEY_UNKNOWN`: cero comprobantes (`authorization/1`) | `bd33f645…20c17f9d` | `c5807ee3…fa26fd6f` |
  | 3 | ConsultaComprobante | HTTP 200 | 84 ms | `NO_EVIDENCE`: `RECHAZADA`, identificador 99 (`validity/2`) | `ad98721f…fd2c6b95` | `cf8ad789…590b14d1` |
  | 4 | Recepción | HTTP 200 | 294 ms | `RECEIVED`: `RECIBIDA`, sin mensajes (`reception/1`) | `1a335d21…489728f8` | `3f188de6…9b6f66b2` |
  | 5 | Autorización | HTTP 200 | 79 ms | `AUTHORIZED`: `AUTORIZADO`, ambiente `PRUEBAS` (`authorization/1`) | `bd33f645…20c17f9d` | `7b623474…6166da22` |

- **Reconciliación.** La misma recuperación: el mismo sobre en el reenvío, sin un secuencial nuevo
  ni errores 43, 45 o 70.
- **Primer túnel.**
  - La conexión con el destino tardó 30 ms.
  - Se enviaron 15 413 bytes al destino y llegaron 3 093.
  - El destino cerró con un reset (`ECONNRESET`) 4 019 ms después del último byte del cliente.
  - La aplicación escribió 13 649 bytes y no leyó ninguno.
- **Artefactos.**
  - `SIGNED_XML` y `AUTHORIZED_XML` son iguales: 9 789 bytes, SHA-256
    `1163a94576047bcc5c837b116853066a50b9c732045d58cc386efe51ee15e82e`.
  - `RIDE_PDF`: 23 454 bytes, SHA-256
    `6a91e52daab37a88ddad6495d58614cca7ac8dcd78cc1de1962389baa7c2107c`.
- **Efectos.**
  - Sin movimiento de inventario: sigue en 8.
  - La 301, la 04, la 05 y la 06 siguen `AUTHORIZED` y sin cambios.
  - No se creó ninguna retención 07, ni borrador ni documento.
- **Cierre.** `rollback` dio `ROLLED_BACK`, sin procesos de la sesión, y la transmisión volvió a
  `0`. El siguiente secuencial 03 es `101`.

## 14. Cambios del repositorio antes de la primera transmisión real

- **Política de tamaño (Q-47).** Resuelta por política de producto: la política conservadora de la
  sección 2.1 rige en Pruebas y en Producción (`adopt-conservative-sri-transmission-size-policy-v1`).
- **Lista de permitidos de salida.** Preparada en `scripts/sri-egress/` (`sri-egress-allowlist.md`):
  espacio de nombres de red y proxy `CONNECT` que solo admite `celcer.sri.gob.ec:443`, fuera del
  runtime de la aplicación. Se aplica solo en la sesión controlada.
- **Comprobación final de la sesión.** `sri:test-session-readiness`, sin red
  (`sri-test-environment-checklist.md`, sección G).
- **Tamaños sin medir.** Medir el XML firmado de una factura de 100 líneas, una nota de crédito de 100
  líneas y una nota de débito de 100 conceptos con los benchmarks existentes, para completar la
  sección 2.

## 15. Fuera de este runbook: go-live

Se resuelven después de la certificación y antes de habilitar Producción
(`definition-of-done.md`, Go-Live v1.0, y `manual-mvp-test-2026-10-09.md`):

- **Seguridad:**
  - cabeceras de seguridad y CSP del frontend (H-02);
  - revisión del `Origin`, CORS y CSRF (H-03);
  - límite del cuerpo de Better Auth;
  - límites de frecuencia;
  - escaneo de dependencias y de secretos;
  - exposición de métricas y salud;
  - rotación de la clave maestra.
- **Operación:**
  - `DATA_EXPORT_DIRECTORY` obligatorio en producción;
  - restauración real de un respaldo;
  - el proxy de al menos 120 s para la portabilidad;
  - imágenes de contenedor;
  - control de la deriva del reloj.
- **Publicación:** LICENSE, `SECURITY.md`, `CONTRIBUTING.md`, CHANGELOG y el README de despliegue y
  respaldo.
- **Revisiones normativas:** Anexo 26 y Q-37, Q-52 y Q-53.
- **Habilitación de Producción:** endpoints de Producción y ambiente de la empresa.

## Qué no se hace

- **Prohibido en la certificación:**
  - atajos fiscales;
  - manipular la base de datos;
  - saltar validaciones o la firma;
  - rutas que finjan un `AUTHORIZED`;
  - relajar la seguridad.
- **Permitido:** controles operativos que solo hacen más restrictiva la sesión de Pruebas, como el
  aislamiento de Producción de las secciones 3 y 14. La política de tamaño de la sección 2.1 es la
  misma de siempre, no un modo especial de la certificación.
- El interruptor de la transmisión no salta invariantes fiscales: con él encendido rigen la integridad
  del artefacto, la política de tamaño y la máquina de estados.
- No se reintenta «de todas formas» un comprobante en revisión manual: solo sale con la
  reconciliación y evidencia concluyente.
- No se suben al repositorio el P12, su contraseña, el RUC real, la clave maestra ni respuestas sin
  anonimizar.
- No se usa Producción ni se cambia el valor por defecto de `SRI_TRANSMISSION_ENABLED`.
