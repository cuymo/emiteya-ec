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

**Estado al 2026-10-09: no se puede ejecutar.**

- Q-47 sigue abierta y bloquea la transmisión general (sección 2).
- Para certificar solo en Pruebas se propone un tope de seguridad conservador (sección 2.1), todavía
  sin implementar.
- Hasta entonces no se contacta al SRI, no se usa el P12 real y no se habilita la transmisión real.

## 1. Compuertas

| Compuerta | Estado | Evidencia o acción |
| --- | --- | --- |
| Q-47: límite de tamaño en bytes | **Abierta, BLOCKER para la transmisión general** | La ficha dice «320 Kb» sin definir la unidad (sección 2). Sin una política vigente, la aplicación no envía nada (falla cerrada) |
| Tope de seguridad de la certificación | Propuesto el 2026-10-09; sin implementar | Es técnicamente viable: los siete documentos miden como máximo 13 532 bytes (sección 2.1) |
| Vector oficial de la clave de acceso | Cumplida (2026-10-04) | Ficha v2.34, secciones 5.2 y 7.2.3, en `backend/test/sri-engine/access-keys.contract.test.ts`; extracto en `docs/product/sri-catalogs/fuentes/ficha-v2.34-clave-de-acceso.txt` |
| Endpoints y WSDL de Pruebas | Verificados el 2026-10-04; se vuelven a verificar al empezar la sesión | `docs/product/sri-wsdl/` con su SHA-256 (`wsdl-manifest.test.ts`) y `backend/src/modules/sri-engine/infrastructure/endpoints.ts` (sección 3) |
| P12 ecuatoriano real compatible | Entidad: Security Data, **SUPPORTED** por evidencia pública | El OID `1.3.6.1.4.1.37746.3.11` coincide con el extractor existente (ADR 0019, «Compatibilidad por proveedor»). Falta el ensayo offline con el P12 real (sección 5) |
| RUC habilitado en Pruebas | Pendiente | La lista de la sección 4 la comprueba el operador |
| Salida de red solo hacia Pruebas | Pendiente | Hace falta una lista de permitidos solo hacia `celcer.sri.gob.ec:443` (secciones 3 y 14) |
| Contrapartes de prueba | Pendiente: decisión del dueño | Sin identidades reales de terceros (sección 6) |
| Q-53 (dos ejemplares del RIDE de la liquidación) | No bloquea | Es una obligación de entrega, no de la transmisión; se revisa antes del go-live |
| Q-52 (edición vigente del Reglamento) | No bloquea | Revisión normativa separada |

## 2. Q-47: el límite de tamaño

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
  sin cifra. No dice si mide el XML firmado, su base64 en el SOAP o el sobre completo. La aplicación
  compara el XML firmado tal como se envía, antes del base64 (`transmit-handler.ts`, `TOO_LARGE`).
- **A qué comprobantes y versiones aplica:** a cualquier comprobante del envío individual del esquema
  off-line, sin distinguir tipo ni versión del XSD.
- **Qué pasa al excederlo:** el SRI devuelve el código 26 en la recepción. En la aplicación, un XML
  firmado mayor que la política no se envía: el job se detiene con `TOO_LARGE` y el comprobante queda
  `SIGNED`, sin llamar al SRI.
- **Búsquedas.** Las del 2026-10-03, el 2026-10-04 y el 2026-10-09 solo encontraron versiones de la
  ficha con el mismo texto; la 2.34 sigue siendo la vigente. Una guía oficial de preguntas frecuentes
  de facturación electrónica figura en la biblioteca del SRI, pero no se ha leído: obtenerla y
  revisarla es la primera vía de resolución.

### Medición frente a las lecturas posibles

Ninguna de estas cifras es oficial y **ninguna se adopta**. Solo muestran qué documentos del MVP
quedarían en juego según cómo se lea «320 Kb».

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
  el tope en el peor caso. El tamaño exacto se ve en el ensayo offline con el P12 real (sección 5).

## 2.1 Tope de seguridad de la certificación (propuesta, sin implementar)

**CERTIFICATION SAFETY CAP: 40 000 bytes.** Se deriva de la lectura convencional más restrictiva del
texto oficial ambiguo: «320 Kb» leídos como 320 000 bits, que son 40 000 bytes. Las demás lecturas
razonables dan cifras mayores.

**Qué no es.** No resuelve Q-47 y no es:
- el límite oficial del SRI;
- el límite de Producción;
- un límite general de documento;
- una defensa de recursos;
- una regla del XSD.

Q-47 sigue abierta para el go-live.

**Regla.** Solo en una sesión explícita de certificación, solo en Pruebas, un documento se transmite
únicamente si se cumplen a la vez estas tres condiciones, con comparación estricta (`<`, no `<=`)
para no discutir el borde mientras Q-47 siga sin aclarar:

- `signedXmlUtf8Bytes < 40000`;
- `base64PayloadBytes < 40000`;
- `completeSoapRequestBytes < 40000`.

Si cualquiera llega a 40 000 o lo supera, el documento no se transmite y la sesión se detiene. No se
reduce el documento automáticamente.

**Implementación mínima propuesta.** Necesita su propio cambio OpenSpec y la autorización del dueño:

- **Activación.** Una variable explícita de la sesión, por ejemplo `SRI_CERTIFICATION_SESSION=1`,
  apagada por defecto. Sin ella, el comportamiento no cambia: sin una política oficial no hay
  transmisión.
- **Comprobaciones con la variable encendida,** en el handler de la recepción y antes del envío:
  - el documento es del ambiente de Pruebas. Si no lo es, el job se detiene con un error
    determinista y no se llama al SRI;
  - las tres representaciones están por debajo del tope, que es una constante del código y no una
    configuración. Si no, el job se detiene con un error determinista que registra los tres tamaños.
- **Política oficial.** Si alguna vez existe una política oficial vigente, también se aplica. Rige la
  más estricta.
- **Readiness y métricas.** Con la variable, la readiness de la transmisión habilitada acepta la falta
  de una política oficial. `/health/ready` y las métricas indican que rige el tope de la
  certificación. Los logs nombran el tope como *certification safety cap*, nunca como límite del SRI.
- **Pruebas:**
  - un documento por debajo del tope se envía;
  - exactamente 40 000 bytes se detiene;
  - XML por debajo pero base64 o SOAP por encima se detiene;
  - un documento de Producción con la sesión encendida se detiene sin llamada;
  - sin la variable y sin política: `SIZE_POLICY_MISSING`, igual que hoy.
- **Documentación:** `deployment.md`, este runbook y la nota en Q-47.

Con la variable, «Qué no se hace» se precisa: el tope es una comprobación más estricta que solo existe
en Pruebas, no una ruta que salte invariantes.

- **Documentos de certificación** (pocas líneas, como los de la sección 7): rondan los 8 a 10 KB.
  Quedan por debajo de todas las lecturas.
- **Lecturas en kilobits:** con los límites por defecto, la retención de peor caso (46 614 bytes), la
  guía (78 827) y la liquidación (156 132) las superan. La aplicación no las enviaría: `TOO_LARGE`, sin
  llamada.
- **Lecturas en kilobytes:** con los máximos absolutos configurados, la liquidación las supera.

Esto no cambia el runtime: la cifra oficial decide si hay que ajustar los límites por defecto de la
aplicación.

### Cómo se resuelve

1. **Evidencia oficial.** La guía oficial de preguntas frecuentes, una consulta formal al SRI u otra
   fuente primaria que fije la unidad y los bytes medidos. Con ella, un cambio OpenSpec pequeño publica
   `sri-transmission-policy` (versión 1) con el texto, la sección, la unidad literal y la
   interpretación.
2. **Decisión explícita del dueño del producto**, si la evidencia oficial no llega. Una política
   conservadora del producto, registrada como decisión propia y no como cifra oficial, en su propio
   cambio OpenSpec. No se toma por defecto ni de forma implícita.

Hasta entonces, Q-47 es un BLOCKER: no hay transmisión real. Sin política vigente,
`SRI_TRANSMISSION_ENABLED=1` deja `/health/ready` en `503` y el job se detiene con
`SIZE_POLICY_MISSING`.

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

**Producción no se usa.** Para que ningún error de configuración llegue a `cel.sri.gob.ec`, la sesión
aplica tres capas:

1. **La empresa solo está en Pruebas.** La sesión se hace en una instalación nueva con la empresa en el
   ambiente de Pruebas, y nunca se cambia el ambiente durante la sesión. Los endpoints salen del
   ambiente de cada comprobante.
2. **Los endpoints de Producción no van a ninguna parte.**
   `SRI_ENDPOINT_PRODUCTION_RECEPTION`, `_AUTHORIZATION` y `_VALIDITY` se sobrescriben con una URL
   `https` que no lleva a ningún sitio. Por ejemplo, un puerto cerrado de `127.0.0.1`: es válida para
   la configuración y falla en el transporte.
3. **La salida de red solo permite Pruebas.** Una lista de permitidos admite únicamente
   `celcer.sri.gob.ec:443`:
   - o un proxy `CONNECT` local con `NODE_USE_ENV_PROXY=1` y `HTTPS_PROXY`, que rechaza cualquier otro
     destino (herramienta pendiente, sección 14);
   - o una regla equivalente del firewall del equipo.

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
- **Contraseña no ASCII.** Funciona con los formatos legados. Con PBES2, el P12 se rechaza al cargarlo,
  con un mensaje que pide exportarlo de nuevo con una contraseña ASCII (limitación de S-6).
- **RUC del certificado: compatibilidad por proveedor.** El RUC se extrae solo con extractores
  documentados (`ruc-extractors.ts`).
  - **Security Data está SUPPORTED** por su documentación pública (ADR 0019, «Compatibilidad por
    proveedor»): OID `1.3.6.1.4.1.37746.3.11` en los certificados de firma de persona natural con
    RUC, miembro de empresa y representante legal.
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
  - **Comprador o proveedor identificado:** el SRI puede validar el formato de la identificación, y la
    fuente archivada no publica identificadores de prueba oficiales. El dueño decide entre:
    - identidades bajo su control, con su consentimiento, como su propio RUC o cédula;
    - una persona que consienta por escrito;
    - un pasaporte marcado «PRUEBA», si el SRI lo acepta en Pruebas.
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

## 10. Condiciones de parada

La sesión se detiene de inmediato, con la transmisión vuelta a fallar cerrado (sección 3.1), si
ocurre cualquiera de estas condiciones. No se sigue «para ver qué pasa».

- **Compuertas:**
  - Q-47 sin resolver: no hay política de tamaño vigente;
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
| Pendiente | | 01 (consumidor final) | | | | |
| Pendiente | | 01 (comprador identificado) | | | | |
| Pendiente | | 04 | | | | |
| Pendiente | | 05 | | | | |
| Pendiente | | 06 | | | | |
| Pendiente | | 07 | | | | |
| Pendiente | | 03 | | | | |

Con los seis tipos en `AUTHORIZED`, S-3 online y AC-03 pasan a cumplidos aquí y en
`docs/product/open-questions.md`.

## 14. Cambios del repositorio antes de la primera transmisión real

- **Política de tamaño (Q-47).** Publicar `sri-transmission-policy` versión 1 en su cambio OpenSpec,
  solo con evidencia oficial. Es necesaria para la transmisión general y el go-live; para la
  certificación la sustituye el tope de la sección 2.1.
- **Tope de seguridad de la certificación.** Implementar la propuesta de la sección 2.1 en su cambio
  OpenSpec, con la autorización del dueño. Es la vía para certificar en Pruebas mientras Q-47 siga
  abierta.
- **Lista de permitidos de salida.** Un proxy `CONNECT` local de herramientas, fuera del runtime de la
  aplicación, que solo admita `celcer.sri.gob.ec:443`, o la regla equivalente del firewall,
  documentada.
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

- No hay rutas, banderas ni modos especiales para la certificación.
- El interruptor de la transmisión no salta invariantes fiscales: con él encendido rigen la integridad
  del artefacto, el límite de tamaño y la máquina de estados.
- No se reintenta «de todas formas» un comprobante en revisión manual: solo sale con la
  reconciliación y evidencia concluyente.
- No se suben al repositorio el P12, su contraseña, el RUC real, la clave maestra ni respuestas sin
  anonimizar.
- No se usa Producción ni se cambia el valor por defecto de `SRI_TRANSMISSION_ENABLED`.
