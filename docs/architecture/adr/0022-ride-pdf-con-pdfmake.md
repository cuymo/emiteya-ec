# ADR 0022: RIDE en PDF con pdfmake y Code128 de bwip-js, desde el comprobante autorizado

## Status

Accepted el 2026-10-04, tras el spike S-4 (Q-34, la parte del PDF). La implementación llega con
`add-document-archive`.

## Context

- **Requisitos.**
  - ERS RF-405 pide generar y descargar el RIDE en PDF, y RF-102, usar el logo de la empresa en él.
  - CTX §30 pide generarlo desde el documento autorizado, sin reconstruirlo con los datos actuales de la empresa o de los productos.
  - La ficha v2.34 fija la distribución de la factura en el anexo 2 (página 60): emisor, autorización, comprador, detalle, información adicional, formas de pago y subtotales. Los datos adicionales son libres (§9.19), el código de barras con la clave es opcional (§9.20) y conviene que lo lean las lectoras (§9.21). El anexo 22 exige la leyenda RIMPE.
- **Spike S-4** (rama `spike/s4-ride-pdf`, `backend/test/spikes/s4-ride/`, 15 pruebas y un benchmark):
  - un prototipo genera el RIDE desde facturas reales del builder, validadas contra el XSD y firmadas;
  - comprueba el Code128 con dos decodificadores independientes, el Unicode, la paginación, la seguridad y el determinismo;
  - mide el rendimiento en el runtime de la API y en un contenedor `node:24.21.0-slim` (`../../quality/benchmarks/ride-2026-10-04.md`).
- **Alternativas evaluadas:**

  | Opción | Resultado |
  | --- | --- |
  | pdfmake 0.3.11 sobre pdfkit 0.19.1 | Elegida. Tablas con encabezado repetido y filas que no se parten, bloques indivisibles, encabezado y pie por página, fuentes desde memoria y políticas que niegan URL y archivos locales. Todo en el servidor y determinista. |
  | pdfkit directo | El mismo motor, pero las tablas y la paginación serían código propio. pdfmake ya resuelve ambas. |
  | pdf-lib 1.17.1 | Sin mantenimiento desde 2022. |
  | Navegador headless (Chromium) | No hace falta: una librería normal resolvió maquetación, fuentes, tablas, paginación y código de barras. Habría añadido cientos de MB, procesos que gestionar y una superficie de red y archivos que aislar. |

## Decision

- **Fuente canónica.** El RIDE sale del XML autorizado (`AUTHORIZED_XML`) y de estos metadatos inmutables, nunca de terceros, productos, configuración ni catálogos vigentes:
  - número, fecha y ambiente de la autorización: las columnas de autorización del comprobante, que un trigger impide cambiar;
  - denominaciones de las formas de pago: el snapshot del comprobante (`payments[].officialLabel` con el `versionId` del catálogo), porque el XML solo trae el código;
  - logo: la versión de configuración del snapshot (`taxpayerConfig.versionId`) y su `configuration_asset`, ambos de solo agregado, en PNG o JPEG con SHA-256;
  - tablas normativas fijas de la ficha: ambiente (tabla 4) y tipo de emisión (tabla 2).

  Los textos y los importes salen tal como están en el XML, sin pasar por `number`. Los metadatos deben describir el mismo comprobante: un número de autorización distinto de la clave, o un ambiente distinto, se rechaza.
- **Contenido.** Las secciones del anexo 2, mostrando solo los subtotales llenados:
  - RUC, número, número y fecha de autorización, ambiente, emisión, clave y Code128;
  - emisor: razón social, nombre comercial, direcciones de la matriz y del establecimiento, contribuyente especial, obligado a llevar contabilidad, agente de retención y leyenda RIMPE;
  - comprador o consumidor final;
  - líneas, con los códigos auxiliares y los detalles adicionales solo si existen;
  - información adicional y formas de pago con plazo;
  - subtotales por tarifa, 0 %, no objeto y exento; descuento, ICE, IVA, IRBPNR, propina y valor total.

  Las columnas de subsidio (anexo 7) y la tarifa especial de turismo quedan fuera mientras la factura no los admita.
- **Code128.**
  - bwip-js 4.11.4 codifica la clave.
  - Las barras se dibujan como rectángulos vectoriales desde su secuencia de barras y espacios, sin imagen ni SVG.
  - Zona de silencio de 10 módulos y módulo de 0.329 mm (más que el mínimo de 0.25 mm de GS1-128).
  - Alto de 16.8 mm (al menos el 15 % del ancho y 6.35 mm), con la clave completa debajo como texto.
- **Fuentes.**
  - Noto Sans 2.015, Regular y Bold (SIL OFL 1.1), versionadas con su licencia y su SHA-256, embebidas con subconjunto.
  - Antes de dibujar se comprueba con fontkit que cada carácter tenga glifo. Si falta uno, el RIDE falla con `RIDE_GLYPH_MISSING` y los códigos de los caracteres, nunca con una sustitución silenciosa.
  - No depende de las fuentes del sistema: el contenedor no tiene ninguna.
- **Seguridad.**
  - pdfmake no interpreta HTML: el texto del comprobante se dibuja literal.
  - Se niegan todas las URL (`setUrlAccessPolicy`) y todo archivo local (`setLocalAccessPolicy`). Las fuentes y el logo llegan como bytes.
  - El PDF no lleva enlaces, acciones, JavaScript ni archivos embebidos.
  - El XML se lee con DTD y entidades rechazadas, un límite de 2 MiB y una profundidad máxima de 24. El lector vive en `sri-engine/infrastructure`, el único lugar del parser XML.
- **Determinismo.**
  - Los metadatos del PDF son fijos: la fecha de creación es la de la autorización.
  - pdfkit deriva el identificador del archivo y el prefijo del subconjunto de fuentes de datos fijos.
  - El mismo comprobante produce los mismos bytes, también en otro proceso y en el contenedor. Lo comprueban las pruebas, que fijan además las versiones de pdfmake, pdfkit y las fuentes.
  - Igual, la garantía es el artefacto persistido: el hash es el de los bytes guardados, no la promesa de regenerarlos idénticos con otras versiones.
- **Persistencia.**
  - El RIDE se genera una vez, después de la autorización, y se guarda como artefacto inmutable (`RIDE_PDF`) con sus bytes exactos, su SHA-256, su tamaño y la versión del renderer.
  - Toda descarga e impresión usa ese artefacto, con su hash, sin regenerarlo.
  - El spike no encontró una razón técnica en contra: cuesta unos 100–200 ms y 25–60 KB por factura, y la regeneración daría bytes iguales solo mientras no cambien las versiones.
- **Concurrencia.** La maquetación es síncrona y bloquea el event loop entre 100 y 220 ms por documento, así que nunca se genera en el hilo que atiende HTTP. El cambio 8 la hace en un job o en un pool de workers con concurrencia acotada, con el mismo patrón que la validación XSD y la firma.
- **Tipos.** No se usa `@types/pdfmake` 0.3.3: declara `/// <reference lib="dom" />` y mete los globales del navegador en todo el programa del backend. Por ejemplo, rompe el tipo del cuerpo de `fetch` del transporte SOAP. Se declaran localmente las pocas firmas que se usan.
- **Pruebas en la CI.**
  - Un decodificador independiente en Node: pdfjs-dist 6.3.289 rasteriza la página a 300 ppp, con @napi-rs/canvas 1.0.10, y zxing-wasm 3.1.4 lee el Code128.
  - En local, el spike usó además poppler y zbar, que leen la clave a 150, 200 y 300 ppp.

### Dependencias

| Paquete | Versión exacta | Licencia | Mantenimiento | Tamaño instalado | Uso |
| --- | --- | --- | --- | --- | --- |
| pdfmake | 0.3.11 | MIT | release de junio de 2026 | 15 MB (incluye builds de navegador) | Runtime |
| pdfkit (vía pdfmake) | 0.19.1 | MIT | release de septiembre de 2026 en la 0.20 | 8.2 MB | Runtime |
| fontkit | 2.0.4 | MIT | dependencia de pdfkit; release de 2024 | 5.8 MB | Runtime (glifos) |
| bwip-js | 4.11.4 | MIT | release de agosto de 2026; sin dependencias | 13 MB | Runtime (Code128) |
| pdfjs-dist | 6.3.289 | Apache-2.0 | release mensual | 36 MB | Pruebas |
| @napi-rs/canvas | 1.0.10 | MIT | release de octubre de 2026; binario precompilado | 34 MB (linux-x64-gnu) | Pruebas |
| zxing-wasm | 3.1.4 | MIT (zxing-cpp, Apache-2.0) | release de septiembre de 2026 | 3.8 MB | Pruebas |

pdfjs-dist 6.4.299 se descartó porque su publicación era más reciente que el `minimumReleaseAge`
de pnpm: no se añade una excepción a esa política para un spike.

## Consequences

- El RIDE no usa `facturacion-electronica-ec` y no depende de un navegador.
- El repositorio guarda 1.2 MB de fuentes OFL, y la imagen de la API, unos 42 MB de dependencias de runtime.
- `add-document-archive` decide, sin que bloquee proponerlo:
  - si la autorización llega sin `comprobante` (no hay `AUTHORIZED_XML`), el RIDE sale del `SIGNED_XML`, que es exactamente lo que el SRI autorizó por la clave;
  - en qué momento se genera tras la autorización (job propio o el mismo job que autoriza) y la cola del pool;
  - si los importes se muestran con la coma decimal del país, siempre como texto y sin redondear;
  - el backfill de las facturas ya autorizadas.
