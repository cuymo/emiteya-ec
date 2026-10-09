# ADR 0024: Contenedor ZIP64 propio sobre `node:zlib` para el paquete de portabilidad

## Status

Accepted el 2026-10-08, tras el spike de la tarea 1.1 de `add-data-portability` (design D9). La
implementación llega con el mismo cambio (tarea 1.2).

## Context

- **Requisitos.**
  - El paquete `PORTABILITY_FORMAT_V1` (Q-28, design D2) es un ZIP con todos los datos y artefactos de la empresa.
  - Con el volumen de Q-26 tiene unas 600 000 entradas y unos 2.6 GB comprimidos, y puede pasar de 4 GiB al crecer. Necesita ZIP64 tanto para el número de entradas (más de 65 535) como para los tamaños y los desplazamientos (más de 4 GiB).
  - Se genera en el proceso de la API, en un job, con memoria acotada (design D9 y D20).
  - Las entradas son binarias: XML, PDF, PNG, JPEG, XLSX, JSON y texto.
  - La decisión del dueño del producto: elegir la opción que reduzca el riesgo de formato, con una biblioteca de producción preautorizada si es la mejor.
- **El contenedor del ADR 0023 no sirve tal cual:**
  - no tiene ZIP64, solo admite fragmentos de texto y siempre comprime;
  - guarda el directorio central en memoria.
- **El spike** (`../../quality/benchmarks/zip64-2026-10-08.md`) se ejecutó fuera del repositorio con tres escenarios: 4002 entradas mixtas, 600 000 entradas, y una entrada de 4.5 GiB seguida de entradas con desplazamientos por encima de 4 GiB. Usó cuatro lectores independientes: `zipfile` de Python con `testzip`, `unzip -t` de Info-ZIP, `7z t` y `bsdtar`.
- **Alternativas evaluadas:**

  | Opción | 600 000 entradas | Más de 4 GiB | Resultado |
  | --- | --- | --- | --- |
  | A: contenedor ZIP64 propio sobre `node:zlib` | 26.5 s; 179 MiB de RSS con el heap limitado a 48 MiB | Los cuatro lectores, sin errores | Elegida |
  | B1: yazl 3.3.1 | 1420 MiB y 488 s con solo 200 001 entradas | No evaluado: ya fallaba en memoria y tiempo | Descartada |
  | B2: zip-stream 7.0.5 | 5213 MiB | Info-ZIP: "overlapped components (possible zip bomb)" | Descartada |
  | B3: @zip.js/zip.js 2.23.0 | 4200 MiB y 239 s | Info-ZIP falla (código 12); 2938 MiB con la entrada grande | Descartada |
  | B4: fflate 0.8.3 | Sin ZIP64: el cierre dice 4466 entradas de 70 002 | — | Descartada |

- **Por qué se descartan las bibliotecas:**
  - Las tres que escriben ZIP64 guardan en memoria el registro de cada entrada hasta el final, entre 7 y 8.7 KiB por entrada en B2 y B3. La memoria crece con el número de comprobantes y pasa de 4 GiB con el volumen de Q-26.
  - B2 y B3 producen archivos de más de 4 GiB que Info-ZIP rechaza, uno de los lectores más comunes.
  - B1 tiene, además, un tiempo superlineal.
  - Las licencias (MIT y BSD-3-Clause) y el mantenimiento (B2 y B3 con releases de 2026) no las descartaban: las descartan la memoria y la compatibilidad del formato.

## Decision

- **Contenedor ZIP64 propio, en `data-portability/infrastructure`**, solo con lo que necesita el paquete. No lee archivos ZIP, no escribe directorios, cifrado, comentarios, varios discos ni enlaces simbólicos.
- **Tamaño y CRC antes de la cabecera, sin descriptor de datos.** Cada entrada conoce su tamaño, su tamaño comprimido y su CRC-32 antes de escribir su cabecera local, así que nunca usa el descriptor de datos (bit 3), una fuente habitual de incompatibilidades con ZIP64.
  - **Búferes** (artefactos, respuestas, logos, snapshots, manifiesto): se comprimen en memoria con `deflateRaw` asíncrono, fuera del hilo principal. Si el resultado no es menor, se guardan con STORE.
  - **Archivos** (los libros XLSX y `SHA256SUMS`):
    - con STORE, una primera pasada calcula el CRC y una segunda los copia por trozos;
    - con DEFLATE, se comprimen primero a un temporal mientras se calcula el CRC y se copia el temporal.
  - **Métodos:** STORE para PDF, XLSX, PNG y JPEG, que ya vienen comprimidos; DEFLATE nivel 6 para XML, JSON y texto.
- **ZIP64 según APPNOTE 4.5:**
  - una entrada de 4 GiB o más lleva el campo extra ZIP64 (0x0001) en su cabecera local, con sus dos tamaños, y la versión 4.5;
  - en el directorio central, el campo extra lleva solo los valores que no caben en 32 bits (tamaño, tamaño comprimido y desplazamiento, en ese orden), con 0xFFFFFFFF en el campo original;
  - con 65 535 entradas o más, o con un directorio central que empieza o mide 4 GiB o más, se escriben el registro y el localizador ZIP64 del fin del directorio, y el cierre clásico queda saturado.
- **Atributos:**
  - "hecho por" Unix 4.5, con los atributos externos de un archivo regular (`0o100644`). Ninguna entrada puede ser un enlace simbólico;
  - nombres en UTF-8 (bit 11). La gramática de rutas de design D2 los limita a ASCII, y el contenedor rechaza un nombre de más de 65 535 bytes;
  - fecha DOS fija, el 1980-01-01 00:00: el momento del paquete va en su manifiesto.
- **Memoria acotada:**
  - el directorio central se escribe a un temporal privado a medida que se agregan las entradas y se copia al final, así que la memoria no depende del número de entradas;
  - la salida se escribe en trozos de hasta 1 MiB con contrapresión, a un archivo abierto con `wx` y modo `0600`.
- **SHA-256 del paquete:** se calcula al vuelo sobre los bytes escritos, y el tamaño sale de la posición final.
- **Determinismo:** las mismas entradas en el mismo orden dan los mismos bytes.
- **Pruebas en la CI.**
  - El paquete se lee con `zipfile` de Python, que ya trae la imagen de la CI. Es un lector independiente del escritor, invocado con `python3 -I` desde un script de pruebas.
  - Comprueban:
    - el número de entradas por encima de 65 535 con los registros ZIP64;
    - el CRC de cada entrada (`testzip`);
    - los bytes exactos de las entradas binarias;
    - los atributos de archivo regular;
    - los bytes deterministas;
    - la memoria acotada con el heap limitado.
  - Una prueba opcional y lenta (`PORTABILITY_ZIP64_LARGE=1`, con `PORTABILITY_ZIP64_LARGE_DIR` en un disco que no sea tmpfs) escribe una entrada y un total de más de 4 GiB y los lee con los cuatro lectores. Es la única prueba que `verify` omite a propósito: escribe unos 5 GB, así que se ejecuta a mano. Pasó en 179 s durante el apply (disco giratorio) y en 63 s al cerrar el cambio (SSD). El paquete de Q-26 de `bench:data-portability` mide 3.43 GiB y tiene 592 630 entradas: prueba la parte de más de 65 535 entradas, y esta prueba, la de más de 4 GiB.

### Dependencias

| Paquete | Versión exacta | Licencia | Mantenimiento | Tamaño instalado | Uso |
| --- | --- | --- | --- | --- | --- |
| `node:zlib` | Node.js 24 LTS | MIT (Node.js) y zlib | el runtime del proyecto | — | Runtime (DEFLATE y CRC-32) |
| Python 3 `zipfile` | el de la imagen de la CI | PSF | la distribución | — | Pruebas (lector independiente) |

No se añade ninguna dependencia de npm.

## Consequences

- **Código propio a cambio de memoria acotada y compatibilidad:** unas 300 líneas con sus pruebas contra lectores independientes. El formato está fijado por APPNOTE y lo cubren cuatro lectores en el spike y Python en la CI.
- **Dos pasadas por archivo:** los libros XLSX y `SHA256SUMS` se leen dos veces del disco. Son de cientos de MB como mucho, frente a los GB de artefactos, que se escriben una sola vez desde la memoria.
- **El contenedor del ADR 0023** sigue igual, dentro del escritor XLSX (`platform/xlsx/`, design D8): sus libros nunca pasan de 4 GiB sin comprimir.
- **Lectores sin ZIP64:** los antiguos (anteriores a 2009) no abren un paquete con más de 65 535 entradas o más de 4 GiB. `LEEME.txt` no puede ayudar, porque también está dentro del ZIP: lo documenta `data-portability-format.md`, que nombra los lectores verificados.
