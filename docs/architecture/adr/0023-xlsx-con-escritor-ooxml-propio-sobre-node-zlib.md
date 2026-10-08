# ADR 0023: XLSX de los reportes con un escritor OOXML propio sobre `node:zlib`

## Status

Accepted el 2026-10-08, tras el spike de la tarea 1.1 de `add-reports-export` (design D9). La
implementación llega con el mismo cambio (tarea 1.2).

## Context

- **Requisitos.**
  - ERS RF-501 a RF-505 y AC-09 piden exportar a XLSX exactamente los registros de cada reporte.
  - El spec `reports` fija:
    - el texto como texto (identificaciones con sus ceros, números y claves);
    - los importes y las cantidades como números solo si caben sin pérdida, y si no, como texto exacto;
    - las fechas como fechas;
    - que ningún texto de un usuario se vuelve fórmula.
  - Design D10 y D11: la exportación es síncrona en el proceso de la API, hacia un archivo temporal, con un máximo de filas (hipótesis de 100 000) y dos exportaciones por instancia.
- **El spike** (`../../quality/benchmarks/xlsx-writer-2026-10-08.md`) se ejecutó fuera del repositorio con datos sintéticos:
  - **Libro:** las 13 columnas de Documentos emitidos y la hoja "Filtros".
  - **Textos hostiles:** `=`, `+`, `-`, `@`, tabulador, retorno de carro, espacios al inicio, `=HYPERLINK(...)`, `_x0041_` literal y caracteres de control.
  - **Decimales:** los límites de 15 y 16 dígitos significativos, y los extremos del dominio.
  - **Fechas:** momentos alrededor de la medianoche de Ecuador.
  - **Volumen:** 100 000, 300 000 y 1 000 000 de filas.
  - **Lectores:** openpyxl 3.1.5, un lector de pruebas con `fflate.unzipSync` y `fast-xml-parser`, la lectura de exceljs, `zipfile` de Python y `unzip -t`.
  - **Esquemas:** los XSD de ECMA-376, 5.ª edición (SpreadsheetML de transición y OPC).
- **Alternativas evaluadas** (100 000 filas):

  | Opción | Tiempo / CPU | Memoria externa máx. | Event loop p99 | Resultado |
  | --- | --- | --- | --- | --- |
  | A2: escritor OOXML propio sobre un contenedor ZIP propio con `node:zlib` | 2.0 s / 2.9 s | 12 MiB | 7 ms | Elegida. Cumple todos los criterios, sin dependencias de runtime, con el deflate nativo fuera del hilo principal. |
  | A: el mismo escritor sobre el ZIP con streaming de fflate 0.8.3 | 4.0 s / 4.1 s | 52 MiB | 55 ms | Cumple los criterios, pero comprime en JavaScript dentro del hilo de la API, con el doble de CPU. Además, fflate ignora `mtime` en el constructor de `ZipDeflate` y escribe la fecha DOS con la hora local del proceso. |
  | B: exceljs 4.4.0 con `stream.xlsx.WorkbookWriter` | 6.6 s / 6.9 s | 137 MiB | 70 ms | Descartada. Detalle abajo. |

- **Por qué se descarta B:**
  - **Memoria no acotada:** retiene la hoja en búferes, unos 1.2 KiB por fila; con un millón de filas llega a 1.2 GiB de memoria externa aunque se limite el heap. Con cadenas compartidas, además, guarda la tabla de cadenas hasta el final.
  - **Fidelidad:** descarta en silencio U+0001 a U+0008, U+000B, U+000C, U+000E a U+001F y U+007F. No codifica el retorno de carro, que el lector convierte en salto de línea, ni protege un `_xHHHH_` literal, que Excel leería como otro carácter.
  - **Sin `quotePrefix`:** solo admite el formato de texto `@`.
  - **Bytes no deterministas:** las fechas del ZIP son las del momento de escribir.
  - **Mantenimiento:** sin release desde octubre de 2023, 94 paquetes transitivos, 6 obsoletos (`fstream`, `glob` 7, `inflight`, `lodash.isequal`, `rimraf` 2 y `uuid` 8) y un aviso moderado (`uuid` < 11.1.1, GHSA-w5hq-g745-h8pq).
  - El tamaño (22 MB) no decidió nada: lo descartan la memoria y la fidelidad.
- **Sin evaluar:** `write-excel-file` arma el libro en memoria, y `xlsx` (SheetJS) dejó de publicarse en npm en la 0.18.5, con avisos de seguridad.

## Decision

- **Escritor propio, solo con el subconjunto de los cinco reportes**, en `reports/infrastructure`. Desde `add-data-portability` (design D8) vive en `platform/xlsx/`, sin cambiar su comportamiento, para que la portabilidad lo use sin importar `reports`. No es un motor de hojas de cálculo: no lee libros, no evalúa nada y no escribe fórmulas, cadenas compartidas, temas, propiedades del documento, tablas, filtros, validaciones ni hojas ocultas.
  - **Partes del paquete:** `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml` y una `xl/worksheets/sheetN.xml` por hoja.
  - **Hoja:** la fila de encabezados en negrita y fija, y un ancho por columna.
- **Celdas de texto.** Son siempre `t="inlineStr"`, con el estilo `quotePrefix` y el formato `@`. Ningún camino del escritor produce `<f>`.
  - El texto se codifica como ST_Xstring (ECMA-376 Parte 1, §22.9.2.19):
    - un carácter que XML 1.0 no admite, y el retorno de carro, que el parser normalizaría, van como `_xHHHH_`;
    - un `_xHHHH_` literal se protege con `_x005F_`, como lo escribe Excel;
    - nada se descarta ni se sanea.
  - `xml:space="preserve"` va solo en los textos con espacios en los bordes, como lo escriben Excel y openpyxl. Es la única diferencia con el XSD de transición, que no lo declara en `<t>`.
- **Celdas numéricas.** Llevan el texto decimal canónico en `<v>`, sin pasar por `number`, solo si tiene como máximo 15 dígitos significativos.
  - Con 15 o menos, cualquier lector que lo pase a double vuelve al mismo decimal.
  - Con más, va como texto exacto alineado a la derecha.
  - En el dominio solo pueden pasar de 15 dígitos la cantidad (18) y la existencia (30); los importes tienen como máximo 14.
  - **Formatos:**
    - importes con `#,##0.00`;
    - cantidades y porcentajes con los decimales de su valor canónico, de `#,##0` a `#,##0.000000`.
  - `#,##0.######` y `0.##`, los formatos que preveía design D7, muestran un punto final en los enteros ("15.").
- **Fechas y momentos.**
  - **Fecha:** el serial desde el 1899-12-30, calculado desde la fecha ISO con aritmética UTC, sin zona horaria, con `dd/mm/yyyy`.
  - **Momento:** se convierte a la hora de `America/Guayaquil` con un `Intl.DateTimeFormat` de zona explícita, y su serial conserva los milisegundos, con `dd/mm/yyyy hh:mm:ss`.
  - **Comprobación:** no dependen de la zona ni de la configuración regional del proceso. El spike lo comprobó en UTC, `Pacific/Kiritimati` (UTC+14), `America/Los_Angeles` y `Asia/Kolkata`.
- **Contenedor ZIP propio, mínimo.**
  - **Formato:**
    - `node:zlib` comprime cada parte con `createDeflateRaw` (nivel 6), por streaming y fuera del hilo principal, y `zlib.crc32` calcula el CRC por trozos;
    - cada entrada lleva una cabecera local con descriptor de datos (bit 3) y el nombre en UTF-8 (bit 11);
    - al final van el directorio central y su cierre.
  - **Fecha fija** en todas las entradas: el 1980-01-01 00:00.
  - **Sin ZIP64:** el escritor falla antes de que una entrada o un desplazamiento pasen de 4 GiB, nunca deja un archivo corrupto. Una hoja tiene como máximo 1 048 576 filas, el límite de Excel, y la de un millón pesa 735 MB sin comprimir. `REPORT_EXPORT_MAX_ROWS` nunca puede pasar de 1 048 575.
- **Streaming y contrapresión.**
  - Las filas llegan de un iterable asíncrono por lotes, y el XML sale en trozos de unos 64 KiB.
  - Cada trozo respeta la contrapresión de un archivo abierto con `wx` y modo `0600`.
  - La memoria no depende del número de filas: con un millón y el heap limitado a 48 MiB, el pico fue de 151 MiB de RSS, 27 MiB de heap y 11 MiB de memoria externa.
- **Determinismo.**
  - Las mismas filas dan los mismos bytes, en cualquier corrida, zona y configuración regional.
  - El libro no lleva marcas de tiempo propias: el momento de generación es un dato de la hoja "Filtros".
- **Pruebas en la CI.**
  - El libro se lee con fflate 0.8.3, solo de desarrollo, para descomprimirlo con una implementación independiente, y con `fast-xml-parser`, que ya es dependencia.
  - El lector de las pruebas decodifica ST_Xstring.
  - Las pruebas comprueban:
    - el tipo y el valor exacto de cada celda, sin `<f>` y con `quotePrefix`;
    - el viaje de ida y vuelta de los decimales por double;
    - las fechas en otra zona horaria;
    - los bytes deterministas;
    - la memoria acotada con 100 000 filas.

### Dependencias

| Paquete | Versión exacta | Licencia | Mantenimiento | Tamaño instalado | Uso |
| --- | --- | --- | --- | --- | --- |
| `node:zlib` | Node.js 24 LTS | MIT (Node.js) y zlib | el runtime del proyecto | — | Runtime (deflate y CRC-32) |
| fflate | 0.8.3 | MIT | release de mayo de 2026; sin dependencias | 0.8 MB | Pruebas (descomprimir el libro) |

## Consequences

- **Sin dependencias de runtime nuevas.** El costo es código propio: unas 480 líneas, de las que el contenedor ZIP ocupa unas 120, con sus pruebas contra un lector independiente.
- **El hilo principal** solo arma el XML, en trozos y con esperas entre lotes. La compresión corre en el pool de libuv, que comparte con el sistema de archivos y la criptografía, en tareas de pocos milisegundos. `bench:reports` mide la exportación real con la base, sus transacciones y su concurrencia.
- **Otros lectores:** un libro abierto con openpyxl o exceljs muestra el escape `_xHHHH_` de los textos con caracteres de control o con un `_xHHHH_` literal, porque esos lectores no lo decodifican. Las razones sociales ya no admiten saltos de línea (`fiscalText`).
- **Excel y LibreOffice:** el spike no los tenía. La revisión de la pantalla (tarea 5.3) abre un XLSX exportado y comprueba sus tipos de celda.
- **El cambio 16** puede reutilizar el escritor si no lo complica. Un respaldo completo puede necesitar ZIP64, que este contenedor no tiene; eso lo decide ese cambio.
