# Coste de abrir un PKCS#12 según sus iteraciones (2026-10-09)

Benchmark de `support-security-data-pkcs12-iteration-profile` (design D1 y D2), ejecutado con
`corepack pnpm --filter @facturador/backend bench:pkcs12-iterations`. Datos en
`pkcs12-iterations-2026-10-09.json`. La decisión está en el ADR 0019, «Techo de iteraciones». Mide
este entorno: no es una promesa universal de hardware. El coste escala de forma lineal con las
iteraciones, así que lo que cuenta son las proporciones entre perfiles.

## Método

- **Código real.** El importador es la tarea `inspect-and-test-sign`: aplica el techo, inspecciona y
  abre otra vez el P12 para la firma de prueba. La firma de cada emisión es la tarea `sign-xml`: abre
  el P12 una vez, sin el techo, así que mide una apertura en todos los perfiles.
- **Pool criptográfico** real con su configuración por defecto de producción: `CRYPTO_WORKERS=2` y
  `CRYPTO_TASK_TIMEOUT_MS=30000`. Techo vigente: 131 072.
- **P12 sintéticos**, sin ningún certificado real. OpenSSL los exporta y comprueba su MAC, de forma
  independiente de node-forge:
  - **forma de Security Data** (`sd-N`): PKCS#12 legado, con MAC SHA-1 de N iteraciones y clave
    3DES y certificados RC2-40 de N/2. OpenSSL no permite iteraciones distintas para el MAC y los
    cifrados, así que el MAC se recalcula con la KDF de PKCS#12;
  - **legado uniforme**: MAC y cifrados con N;
  - **moderno uniforme**: PBES2 con AES-256-CBC y PBKDF2-HMAC-SHA256, y MAC SHA-256, con N.

  RSA 2048 en todos los perfiles, y además RSA 4096 en `sd-102400` y `sd-131072`.
- **Repeticiones.** 7 por perfil, después de calentar los dos workers. Con 7 muestras, el P95 por
  rango más cercano es el máximo.
- **CPU y RSS** son del proceso: el hilo principal y los workers.
- **«Dos a la vez»** son dos importaciones simultáneas, una por worker.
- **Archivo abusivo:** el contenido cifrado de los certificados repetido hasta el tamaño máximo de
  subida, con todos los contadores en el techo. Se importa con el pool de producción.
- **El P12 real no se usa en este benchmark.**

## Entorno

| Clave | Valor |
| --- | --- |
| node | v24.15.0 |
| os | Linux 7.1.6-1-cachyos |
| cpu | AMD Ryzen 5 3600 6-Core Processor (12 hilos) |
| memoria | 16 GiB |
| carga media al terminar | 1,41 / 1,74 / 1,71 |

## Resultados

| Perfil | MAC / cifrado | Importación: resultado | Importación mediana / máx. | CPU mediana | Dos a la vez | Una apertura (`sign-xml`) mediana / máx. | RSS máx. |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sd-100000 | 100 000 / 50 000 | aceptado | 941 ms / 957 ms | 1,29 s | 951 ms | 470 ms / 487 ms | 585 MiB |
| legado-uniforme-100000 | 100 000 / 100 000 | aceptado | 1,42 s / 1,44 s | 1,46 s | 1,48 s | 716 ms / 729 ms | 595 MiB |
| moderno-uniforme-100000 | 100 000 / 100 000 | aceptado | 2,56 s / 2,61 s | 2,56 s | 2,62 s | 1,29 s / 1,31 s | 378 MiB |
| sd-102400 | 102 400 / 51 200 | aceptado | 954 ms / 987 ms | 1,29 s | 976 ms | 487 ms / 507 ms | 595 MiB |
| legado-uniforme-102400 | 102 400 / 102 400 | aceptado | 1,44 s / 1,48 s | 1,43 s | 1,51 s | 739 ms / 752 ms | 597 MiB |
| moderno-uniforme-102400 | 102 400 / 102 400 | aceptado | 2,62 s / 2,63 s | 2,62 s | 2,66 s | 1,33 s / 1,34 s | 377 MiB |
| sd-120000 | 120 000 / 60 000 | aceptado | 999 ms / 1,00 s | 1,02 s | 1,06 s | 510 ms / 522 ms | 349 MiB |
| legado-uniforme-120000 | 120 000 / 120 000 | aceptado | 1,71 s / 1,74 s | 1,73 s | 1,76 s | 857 ms / 870 ms | 348 MiB |
| moderno-uniforme-120000 | 120 000 / 120 000 | aceptado | 3,04 s / 3,08 s | 3,03 s | 3,14 s | 1,53 s / 1,55 s | 347 MiB |
| sd-131072 | 131 072 / 65 536 | aceptado | 1,08 s / 1,09 s | 1,08 s | 1,15 s | 546 ms / 587 ms | 359 MiB |
| legado-uniforme-131072 | 131 072 / 131 072 | aceptado | 1,82 s / 1,86 s | 1,83 s | 1,95 s | 920 ms / 935 ms | 357 MiB |
| moderno-uniforme-131072 | 131 072 / 131 072 | aceptado | 3,34 s / 3,36 s | 3,33 s | 3,40 s | 1,67 s / 1,69 s | 357 MiB |
| sd-150000 | 150 000 / 75 000 | rechazo `ITERATIONS` | < 1 ms | — | — | 638 ms / 681 ms | 357 MiB |
| legado-uniforme-150000 | 150 000 / 150 000 | rechazo `ITERATIONS` | < 1 ms | — | — | 1,06 s / 1,11 s | 356 MiB |
| moderno-uniforme-150000 | 150 000 / 150 000 | rechazo `ITERATIONS` | < 1 ms | — | — | 1,91 s / 1,96 s | 355 MiB |
| sd-200000 | 200 000 / 100 000 | rechazo `ITERATIONS` | < 1 ms | — | — | 847 ms / 899 ms | 313 MiB |
| legado-uniforme-200000 | 200 000 / 200 000 | rechazo `ITERATIONS` | < 1 ms | — | — | 1,46 s / 1,52 s | 312 MiB |
| moderno-uniforme-200000 | 200 000 / 200 000 | rechazo `ITERATIONS` | < 1 ms | — | — | 2,55 s / 2,58 s | 310 MiB |
| sd-102400-rsa4096 | 102 400 / 51 200 | aceptado | 955 ms / 961 ms | 972 ms | 981 ms | 546 ms / 565 ms | 346 MiB |
| sd-131072-rsa4096 | 131 072 / 65 536 | aceptado | 1,32 s / 1,34 s | 1,73 s | 1,34 s | 722 ms / 737 ms | 565 MiB |

- **Event loop.** El retraso máximo del hilo principal mientras los workers trabajaban fue de 43 ms.
  Ninguna apertura corre en el hilo de la API.
- **Archivo abusivo.** 31 contenidos cifrados en 65 335 bytes, con todos los contadores en 131 072:
  - el techo lo deja pasar;
  - se importó en 20,0 s, por debajo del timeout de 30 s;
  - el pool siguió sirviendo después.

  Con el techo anterior, 100 000, se importó en 16,8 s. Por encima del plazo, el pool lo corta con
  `CRYPTO_TIMEOUT` y reemplaza el worker. Lo comprueba una prueba con un pool de 300 ms.

## Lectura

- **El perfil de Security Data** (102 400 y 51 200) importa en menos de 1 s (954 ms de mediana) y
  firma cada emisión en unos 0,5 s.
- **El peor perfil legítimo en el techo** es el moderno uniforme con 131 072. Importa en 3,34 s,
  frente a 2,56 s con 100 000, que ya se admitía: un 30 % más, 9 veces por debajo del timeout.
- **Por encima del techo** el rechazo tarda menos de 1 ms, sin descifrar nada.
- **Proyección de otros techos**, por la apertura medida con `sign-xml`: con 150 000 y 200 000, el peor
  perfil legítimo costaría un 14 % y un 53 % más que con 131 072.
