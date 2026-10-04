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

## Actualizar un catálogo

Sigue el proceso de CTX §53 y el checklist de CTX §54:

1. Descargar la fuente nueva y registrar su hash.
2. Añadir un archivo con la versión siguiente del catálogo, con el estado completo. Las entradas publicadas no cambian: solo pueden cerrar su vigencia o retirarse (`WITHDRAWN`), y las nuevas se añaden.
3. Añadir su fila a este manifiesto y sus pruebas.
4. El cargador la aplica en el siguiente arranque.
