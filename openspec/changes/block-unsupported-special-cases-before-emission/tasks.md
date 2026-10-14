# Tasks

## 1. Matriz publicada: el Anexo 24 fuera del MVP

- [ ] 1.1 Añadir `backend/src/modules/catalogs/datasets/special-case-matrix/2.json` (design D3): los 26
  anexos de la versión 1, con el 24 en `OUT_OF_MVP` y su número, tema y referencia sin cambios.
  Registrarlo en `datasets/index.ts`, con su fila y su checksum en
  `docs/product/sri-catalogs/README.md`. La versión 1 no se edita.

  Verificar:
  - `backend/test/catalogs/datasets.test.ts` y las pruebas de la matriz pasan;
  - la consulta de la matriz devuelve el 24 `OUT_OF_MVP` y el 26 `CONDITIONAL_GO_LIVE`;
  - el arranque aplica la versión 2 sobre una base con la versión 1.
- [ ] 1.2 Comprobar qué hace el cargador de la imagen anterior (`main` antes de este cambio) ante una
  base con la versión 2 ya aplicada, y documentarlo en `docs/architecture/deployment.md`,
  «Actualizaciones y reversión» (design, Migration Plan). Verificar con una prueba local del cargador
  o un arranque de la versión anterior sobre un esquema sintético, sin tráfico al SRI.

## 2. Regla compartida de casos especiales del emisor

- [ ] 2.1 Crear `backend/src/modules/fiscal/domain/special-cases.ts` (design D1 y D5):
  - `issuerSpecialCases(profile)`;
  - la aplicabilidad por tipo: 21 y 22 en los seis; 24 en `01`, `03`, `04` y `05`; 26 en los seis;
  - `SUPPORTED_SPECIAL_CASES = {21, 22}`;
  - `unsupportedSpecialCase(profile, documentType)`, con el mensaje de cada anexo, sin el RUC.

  Verificar con una prueba unitaria nueva cada combinación de declaración y tipo, incluidos el 24 en
  `06` y `07` (no activo), el 26 con el propio RUC (no activo), y el 21 y el 22 sin bloqueo.
- [ ] 2.2 Pasar la evaluación de la factura a la regla compartida (sin el `SUPPORTED_SPECIAL_CASES`
  local), conservando la comprobación de la categoría de la matriz y el registro de las reglas en el
  snapshot. Verificar:
  - `backend/test/invoices/evaluation.test.ts` y `backend/test/integration/invoice-emission.test.ts`,
    con una empresa gran contribuyente rechazada con 409 `SPECIAL_CASE_UNSUPPORTED` que menciona el
    anexo 24;
  - el mismo `trace` sin cambios: reservas, comprobantes, idempotencia, auditoría y bloqueo de la
    identidad tributaria;
  - sin movimientos de inventario, trabajos ni intentos al SRI;
  - el borrador sin emitir;
  - la emisión normal sin declaración igual que antes;
  - los fixtures de regresión que registran la categoría o la versión de la matriz actualizados solo
    en esos campos.

## 3. Bloqueo en los otros cinco tipos

- [ ] 3.1 Añadir `SPECIAL_CASE_UNSUPPORTED` a `CREDIT_NOTE_ERROR_CODES`, `DEBIT_NOTE_ERROR_CODES`,
  `WITHHOLDING_ERROR_CODES`, `SHIPPING_GUIDE_ERROR_CODES` y `PURCHASE_SETTLEMENT_ERROR_CODES` (design
  D4), y regenerar el OpenAPI. Verificar que `corepack pnpm openapi:check` pasa con el documento
  regenerado y que el frontend muestra el mensaje del servidor en el rechazo de la emisión de esos
  tipos.
- [ ] 3.2 Ampliar `IssuerConfig.profile` de los cinco módulos con `largeTaxpayer` y `providerRuc` (el
  dato ya llega desde `taxpayerEmissionReads`), y en su `application/context.ts` añadir el problema
  de `unsupportedSpecialCase` después de cargar la configuración, junto a `TAXPAYER_NOT_CONFIGURED`
  (design D2). Verificar con `corepack pnpm typecheck` y las pruebas de 3.3.
- [ ] 3.3 En el archivo de emisión de cada tipo (`credit-note-emission.test.ts`,
  `debit-note-emission.test.ts`, y los de la retención, la guía y la liquidación), con su patrón de
  rechazo:
  - nota de crédito, nota de débito y liquidación con la empresa gran contribuyente → 409
    `SPECIAL_CASE_UNSUPPORTED` con el anexo 24;
  - los cinco con un RUC proveedor de un tercero → 409 con el anexo 26;
  - en cada rechazo, sin cambios en las reservas de secuencial, los comprobantes, las claves, la
    idempotencia, los snapshots, la capacidad y los movimientos de inventario, los trabajos de
    transmisión y los intentos al SRI, con el borrador sin emitir;
  - un segundo intento con el mismo rechazo;
  - la retención y la guía con la empresa gran contribuyente sí se emiten;
  - con el RUC proveedor propio o vacío, la emisión no se rechaza por el 26;
  - la empresa B sin declaraciones emite mientras la empresa A las tiene.

  Verificar que cada archivo pasa contra el PostgreSQL de pruebas, sin tráfico al SRI.

## 4. Documentación

- [ ] 4.1 Actualizar:
  - el ADR 0014: enmienda con el 24 en `OUT_OF_MVP`, bloqueado antes de reservar, y lo que exigirá
    soportarlo (design D6); y el 26 bloqueado en los seis tipos;
  - `docs/architecture/fiscal-emission.md`: la fila de casos especiales, con los dos anexos y los
    tipos que alcanzan;
  - `docs/quality/go-live-normative-review-2026-10-13.md`: H-01 y H-02 cerrados con este cambio, la
    matriz con el 24 y el 26 conocidos, no soportados y bloqueados, y H-03 sin cambios como
    observación;
  - `docs/quality/definition-of-done.md`: los criterios del Anexo 26 y casos especiales, y de la
    matriz normativa;
  - una fila en `docs/quality/technical-debt.md` para el soporte futuro del Anexo 24.

  Verificar con `corepack pnpm format:check` y `corepack pnpm openspec:validate`.

## 5. Verificación

- [ ] 5.1 Pasar `corepack pnpm security:dependencies` y `corepack pnpm security:secrets`, y terminar
  con `corepack pnpm verify` en verde.
