# ADR 0018: Motor SRI sobre `facturacion-electronica-ec`, detrás de una capa anticorrupción

## Status

Accepted el 2026-10-02.

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
  - los builders, con el `schemaRegistry` configurado desde nuestro registro (ADR 0008);
  - `generateClaveAcceso`, con un código numérico generado por nosotros con `crypto.randomInt`;
  - `validateXmlAgainstXsd`, con nuestros XSD registrados con `registerXsdSearchPath` al arrancar;
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

- **Fuente normativa.** Es el material oficial versionado por el proyecto: los XSD en `docs/product/sri-xsd` y los catálogos de `add-business-catalogs`. Una prueba compara los hashes de los XSD que trae la librería con los nuestros y falla si divergen. Hoy coinciden los seis.

- **Custodia.** La librería nunca recibe el secreto cifrado. La custodia lo descifra solo para la operación; el `Buffer` y la contraseña viven en memoria durante `sign` y se liberan después. No hay persistencia adicional ni hooks o logs con XML o secretos.

- **Versiones exactas:**
  - `facturacion-electronica-ec` 1.0.1;
  - `ec-sri-invoice-signer` 1.8.2: la última del rango admitido, que mantiene el import privado;
  - `xmllint-wasm`, con la versión que valide S-2;
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
