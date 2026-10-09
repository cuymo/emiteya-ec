# Tasks

## 1. Medición antes de decidir

- [x] 1.1 Escribir `backend/scripts/bench-pkcs12-iterations.ts` (`bench:pkcs12-iterations`), un gate
  dedicado fuera de `verify` (design D1). Usa el importador real (`inspect-and-test-sign`) y la firma
  real (`sign-xml`) en el pool criptográfico, con `CRYPTO_WORKERS=2` y `CRYPTO_TASK_TIMEOUT_MS=30000`.
  Los P12 son sintéticos:
  - forma de Security Data, legado uniforme y moderno uniforme;
  - con 100 000, 102 400, 120 000, 131 072, 150 000 y 200 000 iteraciones;
  - RSA 2048, y RSA 4096 en dos perfiles.

  Informa mediana y máximo, CPU, RSS, dos importaciones simultáneas, el retraso del event loop y un
  archivo abusivo con contenidos repetidos. Verificar que OpenSSL abre cada P12 y comprueba su MAC.
- [x] 1.2 Ejecutarlo con el techo anterior para decidir (design D2). Volver a ejecutarlo con el techo
  nuevo y guardar el resultado en
  `docs/quality/benchmarks/pkcs12-iterations-2026-10-09.{json,md}`.

## 2. Techo nuevo y pruebas

- [x] 2.1 Subir `MAX_PKCS12_ITERATIONS` a 131 072 en el lector de PKCS#12, con la semántica en su
  comentario: máximo de los contadores, sin sumar, borde admitido (design D2 y D3).
- [x] 2.2 Ampliar `test/support/p12-fixtures.ts` con P12 sintéticos generados por OpenSSL, con el
  MAC recalculado con node-forge (design D5):
  - `sd-profile.p12`, con MAC 102 400 y contenidos cifrados 51 200;
  - `iter-limit.p12`, con el MAC en el techo;
  - `iter-over-mac.p12` e `iter-over-container.p12`, con el techo + 1;
  - `iter-absurd.p12`, con un contador de 2 147 483 647;
  - `many-containers.p12`, con contadores dentro del techo y contenidos repetidos hasta 64 KiB.

  Añadir también `iterationCountsOf` para leer los contadores sin importar node-forge fuera del
  generador.
- [x] 2.3 Pruebas del lector (`test/signing/pkcs12-reader.test.ts`):
  - el techo es 131 072;
  - la forma de Security Data tiene los contadores [102 400, 51 200, 51 200], pasa el techo y se abre;
  - con la contraseña incorrecta es `CERTIFICATE_PASSWORD_INVALID`;
  - el borde se admite;
  - el techo + 1, en el MAC o en un cifrado, y el P12 moderno de 150 000 se rechazan como
    `ITERATIONS`, también con la contraseña incorrecta;
  - el contador absurdo se rechaza en menos de 1 s;
  - ningún mensaje contiene la contraseña.
- [x] 2.4 Pruebas del inspector en el pool (`test/signing/certificate-inspector.test.ts`):
  - la forma de Security Data y el borde pasan la inspección y la firma de prueba;
  - por encima del techo o con el contador absurdo es `ITERATIONS`;
  - con la contraseña incorrecta, su código;
  - con un pool de 300 ms, `many-containers.p12` termina en `CryptoTimeoutError` y el event loop
    sigue atendiendo.
- [x] 2.5 Pruebas de integración de la API (`test/integration/signing-certificate-safety.test.ts`,
  PostgreSQL):
  - la carga de `sd-profile.p12` deja vigente esa firma;
  - con un pool de 300 ms, `many-containers.p12` responde 503 `CRYPTO_TIMEOUT` sin la contraseña, y
    la firma vigente no cambia;
  - la contraseña incorrecta con la forma de Security Data entra en la comprobación de que ningún
    secreto aparece en respuestas, logs ni tablas.

## 3. Documentación

- [x] 3.1 Actualizar el ADR 0019 con el techo nuevo, su semántica, la evidencia del benchmark y el
  riesgo residual de los contenidos repetidos (design D4). Actualizar también:
  - `docs/security/threat-model.md`;
  - el coste por iteraciones en `docs/architecture/fiscal-emission.md`.
- [x] 3.2 En `docs/quality/sri-certification.md` (sección 5), anotar:
  - el techo y el perfil de Security Data;
  - el resultado de los dos ensayos offline del P12 real, solo con datos no sensibles;
  - la acción local pendiente MOVE REAL P12 OUTSIDE REPOSITORY TREE;
  - la línea del incidente de DNS.

## 4. Verificación

- [x] 4.1 Verificación focalizada:
  - pruebas del lector, del inspector y de la API de la firma;
  - typecheck del backend;
  - lint y Prettier de los archivos tocados;
  - `openspec validate support-security-data-pkcs12-iteration-profile --strict`.
- [x] 4.2 Ejecutar y evaluar el ensayo offline con el P12 real (design D6). Sin red, con el importador
  real y la contraseña de la configuración, sin imprimirla. El ensayo se detiene en la primera
  compuerta que falla, en este orden:
  - que se abre y el emisor es Security Data;
  - el OID del RUC y que el RUC coincide con el de la empresa;
  - la vigencia, y el algoritmo y el tamaño de la clave;
  - la firma y su verificación;
  - el XSD;
  - los siete documentos bajo el tope de la certificación.

  Resultado 2026-10-09: **`BLOCKED_BY_CERTIFICATE_PROFILE` / `CERTIFICATE_RUC_NOT_FOUND`**.
  - El objetivo de este change se cumple: contadores [102 400, 51 200, 51 200], el contenedor abre y el
    importador en el pool pasa con la firma de prueba y su verificación.
  - PKCS12 CONTAINER COMPATIBLE: YES.
  - CRYPTOGRAPHICALLY USABLE: YES.
  - SRI IDENTITY REQUIREMENT SATISFIED: NO.
  - REAL P12 CERTIFICATION READY: NO.

  La ausencia del RUC es un problema distinto, fuera del alcance de este change: lo resuelve una
  reemisión externa del certificado (`docs/quality/sri-certification.md`, sección 5).
- [x] 4.3 Verificación global del proyecto (`corepack pnpm verify`) antes de archivar.

  Estado 2026-10-09:
  - **GLOBAL VERIFICATION EXECUTED.** `corepack pnpm verify` se ejecutó una vez y salió con **código
    1**.
    - Pasaron format, versiones, `prisma generate`, lint y typecheck.
    - La suite principal tuvo 1 fallo en 371 archivos (3122 pruebas pasadas, 1 fallida, 1 omitida):
      `job-runner.test.ts`, «interruptor por prefijo de tipo». Su ventana fija de 400 ms quedó vacía.
    - `verify` se detuvo ahí, así que no ejecutó AC-04 ni los pasos siguientes.
  - **CHANGE REGRESSION CHECK: PASS.**
    - Ni la prueba ni `platform/jobs` difieren de `main`.
    - Aislada pasó 3/3.
    - Con 14 procesos ocupando la CPU pasó 3/3 en la rama y 3/3 en `main` (`0eef607`).
    - Falló igual el 2026-10-07 en `db6d899`, ancestro de `main`.
  - **Evidencia compuesta**, cada paso ejecutado una vez, sin cambiar pruebas, plazos ni `maxWait`:
    - suite principal: 371/371 archivos, 3123 pruebas pasadas y 1 omitida;
    - AC-04: 3/3;
    - `openapi:check`, `check:dev-start`, `build`, `check:xsd-artifact` y `check:ride-assets` en
      verde.
  - Las pruebas propias del change (lector, inspector, pool, seguridad y API de la firma) pasaron
    59/59.
  - **HOST-LOAD FLAKE: DOCUMENTED** en `docs/quality/technical-debt.md`.
