# Spike del escritor XLSX (2026-10-08)

Spike de la tarea 1.1 de `add-reports-export` (design D9), ejecutado fuera del repositorio con
datos sintéticos. Datos en `xlsx-writer-2026-10-08.json`. La decisión está en el ADR 0023. Mide
este entorno: no es una promesa universal de hardware.

## Opciones

| Opción | Escritor |
| --- | --- |
| A | Escritor OOXML propio sobre el ZIP con streaming de fflate 0.8.3 (deflate en JavaScript) |
| A2 | El mismo escritor OOXML sobre un contenedor ZIP propio con `node:zlib` (`createDeflateRaw` y `crc32`) |
| B | exceljs 4.4.0, `stream.xlsx.WorkbookWriter` con estilos y sin cadenas compartidas |

## Método

- **Libro:** las 13 columnas de Documentos emitidos y la hoja "Filtros", con filas sintéticas deterministas producidas en lotes de 1000. El tiempo incluye generar los datos, unos 1.3 s por cada 100 000 filas.
- **Textos hostiles:** `=`, `+`, `-`, `@`, tabulador, retorno de carro, espacios al inicio, `=HYPERLINK(...)`, `_x0041_` literal, U+0001, U+000B, U+001F, U+007F, CRLF, emoji, `&`, `<` y comillas.
- **Decimales:** `0.10`, `100.29`, 2 y 6 decimales, el límite de 15 dígitos significativos, 16 o más, y los extremos del dominio (cantidad de 18 dígitos, existencia de 30).
- **Fechas:** con 2024-02-29, y momentos alrededor de la medianoche de Ecuador con milisegundos.
- **Medidas:** cada corrida en un proceso aparte:
  - el tiempo de reloj y la CPU;
  - el RSS máximo (el proceso con los módulos cargados parte de unos 120 MiB);
  - el heap y la memoria externa (`external` + `arrayBuffers`), muestreados cada 20 ms;
  - el retraso del event loop (`monitorEventLoopDelay`, resolución de 5 ms).
- **Lectores:**
  - openpyxl 3.1.5, con la decodificación de ST_Xstring que hace Excel;
  - un lector de pruebas con `fflate.unzipSync` y `fast-xml-parser`;
  - la lectura de exceljs;
  - `zipfile` de Python y `unzip -t`.
- **Esquemas:** `xmllint` contra los XSD de ECMA-376, 5.ª edición: el SpreadsheetML de transición (Parte 4) y OPC (Parte 2).

## Entorno

| Clave | Valor |
| --- | --- |
| node | v24.15.0 |
| os | Linux 7.1.6-1-cachyos |
| cpu | AMD Ryzen 5 3600 6-Core Processor (12 hilos) |
| memoria | 16 GiB |

## Tiempo y memoria

| Opción | Filas | Tiempo | CPU | RSS máx. | Heap máx. | Externa máx. | Event loop p99 / máx. | Archivo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 100 000 | 4.0 s | 4.1 s | 215 MiB | 63 MiB | 52 MiB | 55 / 70 ms | 6.2 MiB |
| A2 | 100 000 | 2.0 s | 2.9 s | 160 MiB | 41 MiB | 12 MiB | 7 / 15 ms | 5.7 MiB |
| B | 100 000 | 6.6 s | 6.9 s | 232 MiB | 48 MiB | 137 MiB | 70 / 120 ms | 8.8 MiB |
| A | 300 000 | 11.7 s | 11.7 s | 227 MiB | 71 MiB | 53 MiB | 52 / 64 ms | 18.6 MiB |
| A2 | 300 000 | 6.0 s | 8.2 s | 201 MiB | 68 MiB | 14 MiB | 7 / 9 ms | 17.3 MiB |
| B | 300 000 | 19.6 s | 20.5 s | 472 MiB | 94 MiB | 380 MiB | 90 / 116 ms | 26.3 MiB |

**Memoria acotada:** con `--max-old-space-size=48`, para que el heap no crezca por pereza del
recolector.

| Opción | Filas | Tiempo | RSS máx. | Heap máx. | Externa máx. | Archivo |
| --- | --- | --- | --- | --- | --- | --- |
| A | 1 000 000 | 49.1 s | 271 MiB | 38 MiB | 37 MiB | 62.0 MiB |
| A2 | 1 000 000 | 37.0 s | 151 MiB | 27 MiB | 11 MiB | 57.7 MiB |
| B | 300 000 | 21.7 s | 417 MiB | 63 MiB | 366 MiB | 26.3 MiB |
| B | 1 000 000 | 89.3 s | 894 MiB | 74 MiB | 1 204 MiB | 87.5 MiB |

- **A y A2:** el heap y la memoria externa no dependen del número de filas.
  - En A, el RSS sube hasta unos 280 MiB a las 330 000 filas y queda plano hasta el millón.
  - En A2, la memoria externa se queda en unos 12 MiB.
  - La hoja de un millón de filas pesa 735 MB sin comprimir.
- **B** retiene la hoja en búferes externos: unos 1.2 KiB por fila. Esa memoria crece con las filas aunque se limite el heap.
- **CPU:** con el heap de 48 MiB, la CPU de A2 sube por la presión del recolector. La medida representativa es la de la primera tabla.

## Fidelidad

2000 filas: 13 200 celdas de texto, 8800 números, 4000 fechas y 1200 decimales escritos como texto.

| Criterio | A | A2 | B |
| --- | --- | --- | --- |
| Diferencias con el valor esperado, leyendo como Excel | 0 | 0 | 64 |
| Fórmulas en el libro | 0 | 0 | 0 |
| Celdas de texto con `quotePrefix` | 13 200 | 13 200 | 0 (solo el formato `@`) |
| Mismos bytes en dos corridas y en UTC, `Pacific/Kiritimati` y `America/Los_Angeles` | Sí | Sí | No |
| Números leídos como double que vuelven al decimal exacto | 8800 | 8800 | 8800 |
| XSD de transición y OPC | Válido, salvo `xml:space` en 110 `<t>` | Igual que A | Extensiones de Markup Compatibility |

- **Las 64 diferencias de B** son cuatro textos hostiles en 16 filas cada uno:
  - el retorno de carro se lee como salto de línea;
  - `_x0041_` se decodifica como "A";
  - U+0001, U+000B, U+001F y U+007F se descartan;
  - CRLF se lee como LF.
- **`xml:space="preserve"`** solo va en los textos con espacios en los bordes, como lo escriben Excel y openpyxl. El XSD de transición no lo declara en `<t>`.
- **openpyxl y exceljs** no decodifican los escapes `_xHHHH_` de ST_Xstring (ECMA-376 Parte 1, §22.9.2.19), que el estándar define para el lector y que Excel escribe. Por eso la comparación los decodifica.
- **Sin Excel ni LibreOffice:** esta máquina no tiene ninguno de los dos, así que el spike no abrió los libros con ellos.
