# ADR 0018: Motor SRI sobre `facturacion-electronica-ec`, detrás de una capa anticorrupción

## Status

Accepted el 2026-10-02. Enmendado el 2026-10-03 con los spikes S-2 y S-3 offline: la validación XSD no usa el envoltorio de la librería (ADR 0021), y la factura usa un builder propio (Q-44). El resto del ADR sigue vigente.

## Context

El motor fiscal necesita, por tipo y versión de comprobante, XML ordenado, clave de acceso,
validación XSD, firma XAdES-BES con RSA-SHA1 y transporte SOAP con el SRI (CTX §8, §19–27;
ADR 0008 y 0013). Q-34 preveía elegir una librería por pieza con los spikes S-2 y S-3. El dueño
del producto decidió usar `facturacion-electronica-ec` como base de esa integración. Es una
librería MIT del mismo autor, extraída de una versión anterior de este producto.

La revisión de la versión 1.0.1 (código, `package.json`, exports y pruebas) encontró lo
siguiente.

**Lo que ofrece:**

- builders XML de los seis comprobantes (`buildDocumentXml` y uno por tipo);
- `schemaRegistry`, con `register`;
- `generateClaveAcceso` y `computeModulo11`;
- `validateXmlAgainstXsd`, sobre `xmllint-wasm` (dependencia opcional), con `registerXsdSearchPath`;
- validadores de datos y catálogos (`catalogRegistry`, con `override`);
- `ISigner` y `EcSriSigner`, sobre `ec-sri-invoice-signer`, que usa `node-forge` y firma con RSA-SHA1;
- `ISriClient` y `SriClient`, sobre `fetch`, con timeout y `fetch` inyectable;
- errores tipados (`FacturacionElectronicaECError`, con código);
- un SDK de alto nivel: `FacturacionElectronicaEC.emitir*`, `ISequenceProvider` y `EmissionHooks`.

**Incompatible con nuestras invariantes, en el SDK de alto nivel:**

- `DEVUELTA` llama a `ISequenceProvider.rollback()`, que reutiliza el secuencial;
- el error 70 reintenta con otro secuencial y otra clave de acceso;
- un fallo de comunicación reenvía a ciegas;
- los errores de los hooks se tragan, de modo que no se puede garantizar persistir antes de enviar;
- todo lo que no sea `AUTORIZADO` termina como `RECHAZADO`;
- el cliente retiene el P12 y su contraseña en su configuración;
- la validación XSD está desactivada por defecto;
- `ISequenceProvider.next()` no recibe ni empresa ni ambiente.

**Huecos en las piezas de bajo nivel:**

- `SriClient`:
  - una recepción sin `estado` la toma como `DEVUELTA`;
  - una autorización sin bloque `autorizacion` la toma como `NO AUTORIZADO`;
  - de varias autorizaciones usa solo la primera;
  - no devuelve la respuesta original y la escribe en el log en debug;
  - sus endpoints están fijos en el código.
- `generateCodigoNumerico()` usa `Math.random` en ESM, comprobado al ejecutarlo.
- Los builders formatean `number` con `toFixed`.
- `EcSriSigner` usa el primer certificado y la primera clave del P12, y toma la hora de firma del reloj, sin opción de fijarla.
- La liquidación de compra se firma con un import privado de `ec-sri-invoice-signer`.

## Decision

- **Rol.** `facturacion-electronica-ec` es una dependencia de infraestructura del protocolo SRI, detrás de puertos propios:

  ```text
  DOMAIN / APPLICATION
          ↓
  puertos propios (XmlDocumentBuilder, AccessKeyGenerator, XsdValidator, XmlSigner, SriTransport)
          ↓
  adaptador facturacion-electronica-ec (módulo sri-engine, infraestructura)
          ↓
  SRI
  ```

- **Frontera de imports.** Solo `backend/src/modules/sri-engine/infrastructure/` importa `facturacion-electronica-ec` y `ec-sri-invoice-signer`. Una regla `no-restricted-imports` de ESLint y una prueba lo impiden en el resto del código. Los puertos usan tipos propios; el adaptador traduce.

- **La aplicación sigue siendo dueña** de:
  - el dominio, las empresas, los usuarios y los permisos;
  - la configuración tributaria y la numeración (`reserveSequentialIn`);
  - la persistencia, la auditoría, los estados del comprobante y la idempotencia;
  - los jobs y reintentos, y la reconciliación;
  - la custodia del certificado (ADR 0011);
  - los snapshots y el ciclo de vida de la emisión;
  - la clasificación de las respuestas del SRI (`fiscal-emission.md`).

- **Se usa solo la API de bajo nivel:**
  - los builders, con el `schemaRegistry` configurado desde nuestro registro (ADR 0008); para la factura, sustituido por el builder propio (Q-44, enmienda abajo);
  - `generateClaveAcceso`, con un código numérico generado por nosotros con `crypto.randomInt`;
  - para el XSD, `xmllint-wasm` directo detrás de `XsdValidator`, no `validateXmlAgainstXsd` (ADR 0021 y enmienda abajo);
  - `EcSriSigner`, a través de `XmlSigner`;
  - `SriClient`, solo como transporte, con un `fetch` inyectado que captura la respuesta original para persistirla. La clasificación se hace sobre esa respuesta, con nuestro parser.

- **No se usan:**
  - `FacturacionElectronicaEC` ni los métodos `emitir*`;
  - `ISequenceProvider` ni `UnsafeMemorySequenceProvider`;
  - `EmissionHooks`;
  - el `Logger` de la librería con payloads;
  - `generateCodigoNumerico`;
  - los validadores y los catálogos de la librería como fuente de verdad.

- **Sin `rollback`.** Si alguna vez hiciera falta un `ISequenceProvider`, no implementará `rollback`: una prueba de contrato lo comprueba. Además, devolverá el secuencial ya reservado por nuestra transacción, sin reservar otro.

- **Fuente normativa.** Es el material oficial versionado por el proyecto: los XSD en `docs/product/sri-xsd` y los catálogos de `add-fiscal-catalogs` (ADR 0020). Una prueba compara los hashes de los XSD que trae la librería con los nuestros y falla si divergen. Hoy coinciden los seis.

- **Custodia.** La librería nunca recibe el secreto cifrado. La custodia lo descifra solo para la operación; el `Buffer` y la contraseña viven en memoria durante `sign` y se liberan después. No hay persistencia adicional ni hooks o logs con XML o secretos.

- **Versiones exactas:**
  - `facturacion-electronica-ec` 1.0.1;
  - `ec-sri-invoice-signer` 1.8.2: la última del rango admitido, que mantiene el import privado;
  - `xmllint-wasm` 5.3.0, la que validó S-2 (ADR 0021);
  - Node `>=24.18.0`: la base del proyecto pasa a 24.21.0.

- **Política de actualización.** Ninguna se actualiza sin pasar antes las pruebas de contrato del adaptador:
  - XML esperado por tipo;
  - vectores de clave de acceso;
  - XSD aceptado y rechazado;
  - firma verificable, con el certificado embebido igual al inspeccionado;
  - parseo de respuestas grabadas del SRI;
  - el import privado de la liquidación de compra.

  Si cambian el firmador o el transporte, también hace falta autorizar de nuevo en Pruebas del SRI.

- **Mejoras propuestas aguas arriba,** que el adaptador compensa mientras tanto:
  - respuesta original en los resultados;
  - estados sin valores por defecto;
  - todas las autorizaciones;
  - endpoints configurables;
  - código numérico criptográfico en ESM;
  - un firmador que elija el certificado que corresponde a la clave;
  - importes como texto decimal.

## Consequences

- Menos código propio para builders, clave de acceso, XSD, XAdES-BES y SOAP. Q-34 queda parcialmente resuelta: S-2 y S-3 validan la librería en lugar de elegir una, y el PDF (S-4) sigue abierto.
- Dependencia de un mantenedor único y de `ec-sri-invoice-signer`. Las versiones exactas, las pruebas de contrato y los puertos propios permiten reemplazar una pieza sin tocar el dominio.
- El adaptador compensa:
  - genera el código numérico;
  - formatea importes ya redondeados por nuestro motor decimal;
  - captura y clasifica la respuesta original;
  - comprueba que el certificado embebido es el inspeccionado.
- La liquidación de compra depende de un import privado: necesita su prueba de contrato antes de soportarse (`add-purchase-settlements`).

## Enmienda del 2026-10-03: spikes S-2 y S-3 offline

- **Validación XSD (S-2).** `validateXmlAgainstXsd` no se usa:
  - busca los XSD en rutas globales del proceso;
  - si falta uno, cae en silencio a los XSD empaquetados en la librería;
  - no comprueba hashes.

  El puerto `XsdValidator` usa `xmllint-wasm` directamente, con los XSD del registro y el import de la firma del W3C, verificados por hash (ADR 0021).
- **Clave de acceso (S-3).** `generateClaveAcceso` funciona detrás del puerto `AccessKeys`:
  - el código numérico es nuestro, con `crypto.randomInt`;
  - el dígito verificador coincide con la implementación de referencia de CTX §8.3.
- **Firma (S-3).** El XML firmado con `XmlSigner` vuelve a validar contra el XSD y su firma verifica con el certificado embebido.
- **Builder de la factura (S-3).** `buildFacturaXml` produce XML válido y determinista para los casos de frontera del MVP, pero tiene dos incompatibilidades que cambian comportamiento:
  - **Importes como `number`.** Recibe los importes como `number` y los escribe con `toFixed`. Un valor válido de 17 o 18 dígitos de `cantidad` o `precioUnitario` no sobrevive el viaje: `123456789012.123456` se escribe como `123456789012.123459`. El adaptador de evaluación falla cerrada (`AMOUNT_NOT_REPRESENTABLE`), lo que rechazaría documentos válidos según el XSD y la política decimal (Q-43). Por eso, "el adaptador formatea importes ya redondeados" no basta para todo el dominio.
  - **Campos del emisor.** `infoTributaria` no puede llevar `agenteRetencion` ni `contribuyenteRimpe`, que el XSD define. Las reglas del emisor de los anexos 21 y 22 (ADR 0014) no se pueden expresar.

  Q-44 lo resolvió con un builder propio (enmienda siguiente).

## Enmienda del 2026-10-03: builder propio de la factura (Q-44)

`add-invoice-emission` implementa su propio `InvoiceXmlBuilder` detrás del puerto definido. Para la
factura, cada capacidad queda así:

- **Propio:**
  - el snapshot fiscal inmutable;
  - la aritmética fiscal y la materialización decimal HALF_UP (Q-14);
  - el builder XML, específico de la factura y función pura del snapshot;
  - la validación XSD (ADR 0021).
- **Se reutiliza tras pasar su prueba de contrato:**
  - `generateClaveAcceso`, mientras siga compatible detrás de `AccessKeys`;
  - `EcSriSigner`, detrás de `XmlSigner`;
  - `SriClient` como transporte en `add-sri-transmission`, con las compensaciones de este ADR.
- **No se usa:**
  - `FacturacionElectronicaEC` ni los métodos `emitir*`;
  - `buildFacturaXml` de la versión 1.0.1;
  - `generateCodigoNumerico`;
  - `validateXmlAgainstXsd` ni `registerXsdSearchPath`;
  - `ISequenceProvider` ni ningún `rollback` del secuencial.

No se hace fork de la librería como dependencia del producto. Una versión que acepte importes como
texto decimal y escriba los campos del emisor sería una oportunidad de reevaluar el builder con las
pruebas de contrato y los XML de referencia de S-3, no una dependencia para continuar.

