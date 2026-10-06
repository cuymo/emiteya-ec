# Catálogos fiscales oficiales del SRI

Manifiesto de los datasets normativos que distribuye el producto (ADR 0020, cambio
`add-fiscal-catalogs`). Los archivos viven en `backend/src/modules/catalogs/datasets/`: uno por
catálogo y versión, con el estado completo del catálogo en esa versión. Una versión nueva añade un
archivo y una fila aquí; nunca edita un archivo anterior. El cargador los aplica al arrancar y se
niega a arrancar si un dataset altera lo ya publicado.

## Fuente

- **Ficha técnica de comprobantes electrónicos, esquema offline, versión 2.34** (actualizada el 27/07/2026, CTX SRI-02).
  - URL: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/f8d9bb36-5632-4f96-b463-b9265b55338c/FICHA%20TE%CC%81CNICA%20COMPROBANTES%20ELECTRO%CC%81NICOS%20ESQUEMA%20OFFLINE%20Versio%CC%81n%202.34.pdf
  - SHA-256 del PDF: `7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9`.
  - El PDF no se versiona; se citan su URL, su hash, la tabla y la página de cada entrada.
- **Manifiesto de los XSD oficiales** (`docs/product/sri-xsd/README.md`), para el registro de esquemas.
- **Catálogo del Anexo Transaccional Simplificado (ATS)** (actualizado el 06/08/2026), para los conceptos de la renta, los tipos de documento sustento y los códigos de sustento (`add-withholding-receipts`, Q-50).
  - Página: https://www.sri.gob.ec/formularios-e-instructivos1 ("Anexos y guías").
  - URL: https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/e6a826af-b22c-40bb-8752-d711f293b8f9/Catalogo_ATS.xls
  - SHA-256 del `.xls`: `bd3f7834f2cd31187af39cd2f4c685a646d7e49316e92ee493da5f2dd9776e3e`.
  - El `.xls` no se versiona ni es una dependencia de ejecución. `fuentes/catalogo-ats-2026-08-06.txt` es su extracto normalizado, con el script que lo produce: hoja, filas, valores RAW, transformaciones, clasificación del MVP y cantidades de entrada y de salida de las tablas 3.10, 4, 5, 11 y 13.

## Datasets

| Dataset | Versión | Fuente | Entradas | Checksum del contenido canónico |
| --- | --- | --- | --- | --- |
| `identification-type` | 1 | Tabla 6 (página 13); formatos de la tabla 5 y del XSD | 5 | `f30a14bebb9647989770eb9d5b8af57f310a20626f1e055d08dfd71a649134a2` |
| `tax` | 1 | Tabla 16 (página 29) | 3 | `add4f307ce4ab09308850da21ec844848bd1913f31ed8f7c2bfb04983b1a7ed5` |
| `iva-rate` | 1 | Tabla 17 y su nota 3 (página 30) | 9 | `de9376a74a3110f3f9e3f51b901669506736af76b6327d353d7537d1e11e7844` |
| `ice-rate` | 1 | Tabla 18 (páginas 30 a 32) | 75 | `91b5773ca52c7f520b8ca146c48202531df0b6246722bd920904731f1e2ac8c4` |
| `irbpnr-rate` | 1 | Tabla 16 (página 29) y especificación del XML de factura (página 50) | 1 | `88697b1d1352e27bdfc3274e2bfd3e6d92d70e217b43d512a64bf68d7be52f14` |
| `payment-method` | 1 | Tabla 24 (página 79) | 8 | `8e82e8816ea745ad0c4170cc69e5d611d0824b388e0f4254e9a5ead64610173c` |
| `consumer-final-policy` | 1 | Numeral 9.10 (página 29), tabla 6 (página 13) y ejemplos del XML | 1 | `09a4d951d918e8c6dfd8462f803b1b82fe70445cf5030e954fd7629df078c8d6` |
| `schema-registry` | 1 | `docs/product/sri-xsd/README.md` | 6 | `55b7962770a7b6e614580e06681eb978909872874a6f0ca3ccb1acca598ab9c2` |
| `schema-registry` | 2 | `docs/product/sri-xsd/README.md` y `docs/product/w3c-xsd/README.md`: los seis XSD con su ruta lógica y sus imports, y el import `xmldsig-core-schema.xsd` | 7 | `0dcfcaabcf155098b5d650f25399cd3b3d5a1a8a8e9189762f42f89cc174841b` |
| `special-case-matrix` | 1 | Índice de anexos de la ficha (páginas 2 y 3); categorías del ADR 0014 | 26 | `508b57aee92202e4e7071126c240de481c3effdf9ce588bf209ebd8e5eca5da2` |
| `withholding-tax` | 1 | Tabla 19 (página 32) | 3 | `4907c4e53ad42077c6e6d47f71b9d6a112e0bd19970af3b98c02f21b67ea742c` |
| `withholding-iva-code` | 1 | Tabla 20, retención del IVA (página 33) | 8 | `fd427a28eaaff257467002d89070b9e936c4da28a0aaf54f60b8c982aa423686` |
| `withholding-income-concept` | 1 | Catálogo ATS, tabla 3.10, bloque "DESDE 06/AGOSTO/2026" | 127 | `beb5376613e9e9f53ad128f9ffd74bb7514b3518d37d18e1eeb193c92b01d9b5` |
| `support-document-type` | 1 | Catálogo ATS, tabla 4 | 40 | `41b306bcbc2e1d3c82db9d11addd5dce834f29eb4f644a71efe1bc311f937f25` |
| `support-code` | 1 | Catálogo ATS, tabla 5 | 16 | `f4ca575b21da6707352bd48a9ac2a1880e93fe89137656bdffa193180f85aa66` |

`backend/test/catalogs/datasets.test.ts` comprueba que esta tabla coincide con los archivos.

**Pendiente: `sri-transmission-policy`** (`add-sri-transmission`, design D17). El límite de tamaño
del comprobante firmado para su envío individual al SRI se publica como dataset propio, con la cita
literal, la sección, la unidad literal y la interpretación exacta en bytes con su justificación.
No se publica mientras la cifra exacta no se verifique en la ficha oficial (Q-47): la ficha v2.34
dice "320 Kb", que admite varias lecturas en bytes, y no se elige ninguna ni se toma de una
librería. Q-47 es una compuerta previa a la transmisión real: sin una versión vigente, ningún
comprobante se transmite, y la cifra se publicará en un cambio OpenSpec pequeño. Las pruebas usan una política sintética del
arnés (`backend/test/support/synthetic-size-policy.ts`), marcada como tal.

## Reglas de transcripción

- **Denominaciones literales.** Se reducen a un espacio los espacios del maquetado, se unen con un espacio las líneas de una misma celda y se quitan las llamadas de nota (`IVA diferenciado3`, `VENTA A CONSUMIDOR FINAL*`). Ortografía y mayúsculas, como en la fuente (`SIN UTILIZACION`, `Barcos de Rec`).
- **Fecha de inicio.** `SOURCE_STATED` si la tabla la declara (solo la tabla 24). Si no la declara, `PROJECT_BASELINE` con la fecha de publicación de la ficha transcrita (2026-07-27): es la base del proyecto, no una fecha legal de vigencia, y no se inventa historia anterior.
- **Solo lo sustentado.** ICE e IRBPNR son `OFFICIAL_REFERENCE`, con código y denominación y sin tarifas. La tabla 18 publica tarifas de 2023 y remite a la normativa vigente, y la ficha no tiene tabla de IRBPNR. Ningún valor se toma de `facturacion-electronica-ec`.
- **Identidad de las filas de ICE.** `entryKey` es la identidad interna estable, y `code` el código fiscal que irá al XML.
  - 3041 y 3541 aparecen tres veces cada uno con denominaciones distintas: cada fila es una entrada con sufijo de variante (`3041-GRAN-ESCALA`…).
  - 3671 aparece dos veces idéntico (páginas 31 y 32): es la misma fila repetida y tiene una sola entrada.
  - Resultado: 75 entradas para las 76 filas de la fuente.
- **Revisión.** `fuentes/ficha-v2.34-tabla-18.txt` es el extracto literal de la tabla 18 con el que se revisó cada fila; `backend/test/catalogs/ice-dataset-review.test.ts` contrasta el dataset con él.

### Catálogos de retención y de sustento

`add-withholding-receipts` (design D6 a D11). Cada entrada conserva la fila oficial completa y su clasificación de alcance; solo las soportadas se pueden elegir. `backend/test/catalogs/withholding-datasets-review.test.ts` contrasta cada dataset con su extracto y reproduce cada clasificación desde los valores RAW.

- **Tablas 19 y 20 de la ficha** (`fuentes/ficha-v2.34-tablas-19-20.txt`), con la fecha base del proyecto (2026-07-27):
  - `withholding-tax`: renta (1) e IVA (2) soportados; ISD (6) pendiente de evidencia (`withholding-isd`).
  - `withholding-iva-code`: la tabla no tiene columna de denominación, así que se compone con el título literal de su bloque y el porcentaje literal (`RETENCIÓN DEL IVA 10%`, `Retención en cero 0.00%`, `No procede retención 0.00%`). La nota del código 7 va en su referencia. El 8 se conserva fuera de alcance (design D8). El ISD de la tabla 20 no se transcribe.
- **Catálogo ATS** (`fuentes/catalogo-ats-2026-08-06.txt`):
  - `withholding-income-concept`: las 127 filas del bloque vigente con el código literal (`323 M` conserva su espacio; su `entryKey` es `323-M`), el módulo, el porcentaje o el texto literal de la fuente y la vigencia que el bloque declara (`SOURCE_STATED`, 2026-08-06). La cantidad soportada sale de las reglas de design D7, nunca de un número fijado. Los bloques anteriores siguen en la fuente y no se transcriben: ninguna emisión del sistema puede resolverse con ellos.
  - `support-document-type`: las 40 filas de la tabla 4 con sus sustentos admitidos, y los tipos como códigos de dos caracteres (`1.0` → `01`). La columna de vigencia dice "vacío": 364 y 375 toman la de sus notas (`SOURCE_STATED`) y las demás la fecha de actualización del catálogo (`PROJECT_BASELINE`, 2026-08-06).
  - `support-code`: las 16 filas de la tabla 5 con sus fechas (`SOURCE_STATED`); el 00 cerró el 28/02/2015.
  - Las tablas 11 y 13 no generan datasets: la 11 es evidencia de design D8 y la 13 sostiene la equivalencia con `payment-method` (design D6), comprobada por la misma prueba.

## Actualizar un catálogo

Sigue el proceso de CTX §53 y el checklist de CTX §54:

1. Descargar la fuente nueva y registrar su hash.
2. Añadir un archivo con la versión siguiente del catálogo, con el estado completo. Las entradas publicadas no cambian: solo pueden cerrar su vigencia o retirarse (`WITHDRAWN`), y las nuevas se añaden.
3. Añadir su fila a este manifiesto y sus pruebas.
4. El cargador la aplica en el siguiente arranque.
