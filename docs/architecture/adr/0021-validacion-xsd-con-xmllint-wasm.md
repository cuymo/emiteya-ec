# ADR 0021: Validación XSD con `xmllint-wasm` detrás de un puerto propio

## Status

Accepted el 2026-10-03, tras el spike S-2.

## Context

El paso 4 del pipeline valida cada XML contra el XSD registrado de su tipo y versión, y falla
cerrada si el esquema falta o su hash no coincide (CTX §19, `fiscal-emission.md`). El ADR 0018
preveía usar `validateXmlAgainstXsd` de `facturacion-electronica-ec`, que delega en
`xmllint-wasm`, una dependencia opcional de la librería.

El spike S-2 se ejecutó con `xmllint-wasm` 5.3.0, libxml2 en WebAssembly, sobre Node 24.21.0:

- **Envoltorio de la librería.** `validateXmlAgainstXsd` no sirve como frontera:
  - busca los XSD en rutas globales del proceso (`registerXsdSearchPath`) y los guarda en una caché también global;
  - si falta un archivo en nuestras rutas, toma en silencio el XSD empaquetado en la librería, que declara derivar de la ficha v2.28;
  - no comprueba hashes.
- **Import de la firma.** Los seis XSD del SRI importan `xmldsig-core-schema.xsd` por ruta relativa, y ese archivo no estaba versionado: con el envoltorio, se habría tomado la copia de la librería.
- **Resultados:**
  - los seis XML válidos pasan contra sus XSD registrados;
  - fallan las variantes inválidas por estructura (elemento obligatorio ausente, elemento desconocido), por escala (decimales y dígitos totales de más) y por formato (fecha, RUC con letras, exponente);
  - un XML mal formado es inválido, no un fallo;
  - sin el import, el esquema no compila y la validación falla cerrada: xmllint no tiene red ni sistema de archivos fuera de lo que se le pasa;
  - también pasó en un contenedor `node:24.21.0-slim` sin Java y sin red.
- **Tiempos** (Ryzen 5 3600, factura de una línea): 65 ms de mediana y 85 ms de p95 en secuencia, frente al criterio de 200 ms. Con 10 validaciones simultáneas, 182 ms de p95, porque cada una arranca su propio worker.

## Decision

- **Dependencia.** El puerto `XsdValidator` del módulo `sri-engine` se implementa con `xmllint-wasm`, en versión exacta 5.3.0 (licencia MIT). Llama a `validateXML` directamente y no usa `validateXmlAgainstXsd` ni `registerXsdSearchPath` de la librería.
- **Frontera.** Solo `modules/sri-engine/infrastructure/` importa `xmllint-wasm`; la regla de ESLint del motor SRI lo incluye.
- **Fuente de los esquemas.**
  - Los XSD del SRI salen del registro de esquemas de `fiscal-catalogs` (`docs/product/sri-xsd/`), con su hash.
  - El import `xmldsig-core-schema.xsd` sale del W3C, versionado en `docs/product/w3c-xsd/` con su hash, nunca de una librería.
  - El adaptador lee cada archivo una vez por instancia, comprueba su SHA-256 y falla cerrada si no coincide. Un nombre de archivo con ruta no se acepta, y un fallo de lectura no se recuerda.
- **Resultado y errores.**
  - Un XML inválido o mal formado devuelve sus violaciones: línea y mensaje de libxml2, sin rutas.
  - Un esquema ausente, alterado o que no compila es un `XsdValidatorError` tipado (`SCHEMA_UNAVAILABLE`, `SCHEMA_HASH_MISMATCH` o `VALIDATOR_FAILED`), sin la salida de xmllint.
- **Contrato.** `backend/test/sri-engine/xsd-validator.contract.test.ts` es la prueba que debe pasar antes de aceptar cualquier actualización de `xmllint-wasm`.

## Consequences

- No hay dependencias nativas, Java ni red en tiempo de ejecución.
- Cada validación arranca un worker y una instancia de WebAssembly, sin estado compartido. La emisión debe acotar cuántas validaciones corren a la vez, como hace con la firma (`CryptoWorkerPool`).
- Los XSD deben empaquetarse con la aplicación. Hoy viven en `docs/product/`; el cambio de emisión decide su ubicación en la imagen y cómo se configura el directorio.
- El registro de esquemas no registra todavía el import de la firma: su hash vive en el adaptador y en el manifiesto de `docs/product/w3c-xsd/`. El cambio de emisión decide si el registro lo incorpora con una versión nueva del dataset.
