# Tasks

## 1. Política de dominio y motivo de parada

- [x] 1.1 Crear `fiscal/domain/transmission-size-policy.ts` con `TRANSMISSION_SIZE_POLICY`
  (`PRODUCT_CONSERVATIVE_POLICY_V1`, 40 000 bytes), `TransmissionSizes` y
  `withinTransmissionSizePolicy` (design D1). Eliminar `fiscal/domain/certification-safety-cap.ts`.
  Verificar con `test/fiscal/transmission-size-policy.test.ts`:
  - 39 999 pasa;
  - 40 000 y 40 001 se bloquean;
  - el bloqueo ocurre por el XML, por el base64 o por el SOAP, cada uno solo;
  - el identificador y el límite no cambian.
- [x] 1.2 Reemplazar en `TRANSMISSION_STOP_CODES` y en `transmission-messages.ts` los cuatro motivos
  retirados por `TRANSMISSION_SIZE_POLICY_EXCEEDED`, con su mensaje de negocio (design D5). Verificar
  con `test/invoices/transmission-messages.test.ts`:
  - el texto exacto;
  - que no menciona un límite del SRI;
  - que un código desconocido recibe el mensaje genérico.

## 2. Transmisión con la política v1

- [x] 2.1 Crear `fiscal/infrastructure/transmission-size-diagnostics.ts`, con `observe` y `lastCheck`,
  y el contador `sri_transmission_size_policy_blocks_total`, sin identidad (design D4). Eliminar los
  dos `certification-session.ts` y sus métricas.
- [x] 2.2 Cambiar `transmit-handler` (design D2): integridad, `prepareReception` una vez, la política
  en los dos ambientes y la parada `TRANSMISSION_SIZE_POLICY_EXCEEDED` con el detalle sin contenido.
  `submit` recibe el cuerpo preparado. Quitar `sizePolicy`, `today` y las ramas `MISSING`,
  `TOO_LARGE` y `CERTIFICATION_*`. Quitar de `executeSriStep` el bloqueo de Producción y
  `CERTIFICATION_BLOCKED` (design D3).
  Verificar con pruebas unitarias del handler, con dobles en memoria y un gateway espía:
  - 39 999 envía; 40 000 y 40 001 detienen sin ninguna llamada;
  - el XML, el base64 o el SOAP en el límite detienen;
  - Pruebas y Producción con las mismas medidas deciden lo mismo y usan su ambiente;
  - el `Buffer` enviado es el medido;
  - un bloqueo no deja intento ni transición;
  - el registro no contiene el XML, el base64 ni el SOAP.
- [x] 2.3 Quitar de `transmission-gate` la precondición de tamaño y reemplazar `sizeGate` por
  `sizePolicy` (`source`, `limitBytes` y `lastCheck`). La readiness de `main.ts` lo publica como
  `sriSizePolicy` (design D4).
  Verificar con `test/fiscal/transmission-gate.test.ts`:
  - deshabilitada: lista y pausada;
  - habilitada con endpoints y workers: lista sin ninguna política cargada;
  - falta un endpoint o un worker: no lista;
  - la fuente es siempre `PRODUCT_CONSERVATIVE_POLICY_V1` y nunca `SRI_OFFICIAL_POLICY`.
- [x] 2.4 Quitar `SRI_CERTIFICATION_SAFETY_CAP_ENABLED` de `config/env.ts` y su cableado de
  `main.ts`: sesión, registro de arranque y dependencias del paso (design D3). El registro de arranque
  informa la fuente de la política.
  Verificar con `test/env.test.ts`:
  - no hay ninguna variable para el límite;
  - la bandera retirada no tiene efecto;
  - `SRI_TRANSMISSION_ENABLED` sigue naciendo apagada.
- [x] 2.5 Quitar `sizePolicy` y `today` de los arneses que construyen el handler:
  - `credit-note-transmission-harness.ts`;
  - `reconcile-handler.test.ts`, `authorize-handler.test.ts` e `inventory-outflow.test.ts`;
  - `inventory-configuration-api.test.ts`.

  Adaptar a `sriSizePolicy` las aserciones de la readiness de `e2e-xsd-bundle.test.ts` y
  `e2e-sri-transmission.test.ts`. Verificar con el typecheck.
- [x] 2.6 Adaptar `test/integration/transmit-handler.test.ts` (PostgreSQL):
  - camino feliz bajo el límite en Pruebas y en Producción;
  - un comprobante que llega al límite se detiene con `TRANSMISSION_SIZE_POLICY_EXCEEDED`, sin fila
    en `sri_attempt` ni transición;
  - la evidencia del envío permitido registra `soapRequestBytes`.

  Quitar las pruebas de la sesión de certificación y de la política ausente.

## 3. Retiro del catálogo `sri-transmission-policy`

- [x] 3.1 Escribir la migración (design D6):
  - elimina la tabla `sri_transmission_policy` y sus dos funciones propias;
  - borra las filas de ese tipo del registro de datasets, con el trigger de inmutabilidad
    deshabilitado solo para esa sentencia;
  - vuelve a crear `fiscal_catalog_dataset_catalog_type_check` con los catorce tipos restantes.

  Quitar el modelo de `schema.prisma`. Reemplazar en `test/integration/migrations.test.ts` la prueba
  de la tabla por una del retiro:
  - la tabla y sus funciones ya no existen;
  - un dataset de ese tipo se rechaza;
  - una fila de ese tipo previa a la migración desaparece.

  La prueba de deriva de Prisma pasa.
- [x] 3.2 Quitar el tipo del módulo `catalogs`: dominio, dataset, cargador, puertos, consultas,
  repositorio Prisma, `fiscal-catalogs` y la ruta HTTP. Verificar con el typecheck y con las pruebas
  de catálogos que siguen pasando.
- [x] 3.3 Quitar la ruta y los esquemas de la vista (`packages/contracts`: `routes.ts` y
  `fiscal-catalogs.ts`) y regenerar `docs/generated/openapi.json`. Verificar con `openapi:check`,
  `packages/contracts/test/openapi.test.ts` y `test/identity/openapi-routes.test.ts`.
- [x] 3.4 Quitar del frontend la consulta y la sección de la política en la pantalla de catálogos.
  Verificar con `frontend/test/fiscal-catalogs-screen.test.tsx`: la pantalla ya no muestra ni pide la
  política.
- [x] 3.5 Quitar `test/support/synthetic-size-policy.ts` y `sri-transmission-policy.test.ts`, y su
  uso en las pruebas de integración y en `test/manual/mvp-sandbox.ts`. Verificar que esas pruebas
  transmiten sin cargar ninguna política.

## 4. Documentación

- [x] 4.1 Actualizar Q-47 en `docs/product/open-questions.md`: **Resuelta**
  (`RESOLVED_BY_PRODUCT_POLICY_V1`), con su razón, sin ser compuerta, y revisable solo con evidencia
  oficial nueva mediante un change nuevo (design D7). Actualizar también:
  - la fila de `sri-transmission` y la del change 7 en `docs/product/capabilities.md` y
    `open-questions.md`;
  - `docs/product/sri-catalogs/README.md`.
- [x] 4.2 Actualizar `docs/quality/sri-certification.md`:
  - las compuertas, con Q-47 resuelta;
  - la sección 2, con «320 Kb» como contexto;
  - la sección 2.1, ahora la política v1 en los dos ambientes;
  - el aislamiento de Producción como medida operativa;
  - que los límites de recursos no garantizan la transmisión.
- [x] 4.3 Actualizar:
  - `docs/architecture/fiscal-emission.md`;
  - `docs/architecture/database.md`, con la tabla, el índice, las restricciones y los triggers
    retirados, y catorce datasets;
  - `docs/architecture/integrations.md` y `docs/architecture/deployment.md`, sin la bandera y con
    `sriSizePolicy`;
  - `docs/quality/observability.md` y `docs/quality/testing.md`;
  - la nota de `sri-catalogs/fuentes/ficha-v2.34-limite-de-tamano.txt`.

  Cambiar `measure:certification-payloads` a la constante del dominio.

## 5. Verificación

- [x] 5.1 Verificación focalizada:
  - pruebas de la política, de la transmisión, de la readiness, del entorno, de los catálogos, del
    frontend y la integración afectada;
  - lint, typecheck y `openapi:check`;
  - `openspec validate adopt-conservative-sri-transmission-size-policy-v1 --strict`.
- [x] 5.2 Verificación global del proyecto (`corepack pnpm verify`), con la política acordada para
  las pruebas sensibles a la carga del host.

  Estado 2026-10-10:
  - **GLOBAL VERIFICATION EXECUTED.** `corepack pnpm verify` se ejecutó una vez y salió con **código
    1**.
    - Pasaron format, versiones, `prisma generate`, lint y typecheck.
    - La suite principal tuvo 1 fallo en 371 archivos (3108 pruebas pasadas, 1 fallida, 1 omitida):
      `e2e-document-archive.test.ts`, «al rearrancar…», con un inicio de sesión `401` justo después
      del rearranque.
    - `verify` se detuvo ahí, así que no ejecutó AC-04 ni los pasos siguientes.
  - **CHANGE REGRESSION CHECK: PASS.**
    - En ese archivo el change solo quitó la carga de la política sintética; no toca la autenticación
      ni el arranque.
    - Aislada pasó 3/3, y ya había pasado en la corrida focalizada de los siete e2e.
    - El mismo tipo de fallo (`401` al iniciar sesión bajo carga) ocurrió en `main` (`0eef607`) el
      2026-10-09.
  - **Evidencia compuesta**, cada paso ejecutado una vez, sin cambiar pruebas, plazos ni `maxWait`:
    - suite principal: 371/371 archivos, 3109 pruebas pasadas y 1 omitida;
    - AC-04: 3/3;
    - `openapi:check`, `check:dev-start`, `build`, `check:xsd-artifact` y `check:ride-assets` en
      verde.
  - **KNOWN HOST-LOAD FLAKE: DOCUMENTED** en `docs/quality/technical-debt.md`.
  - `/opsx:verify`: 0 críticos, 0 avisos y 0 parciales. El dueño del producto aceptó la evidencia
    compuesta el 2026-10-10.
  - **No se afirma que `corepack pnpm verify` pasara:** terminó con código 1.
