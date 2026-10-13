# Tasks

## 1. Recuperación de la custodia en la carga de la firma (API)

- [ ] 1.1 En `backend/src/modules/signing/application/signing-certificate.ts` (`upload`), dentro de la
  transacción y bajo el bloqueo, partir el caso de la misma huella (design D1 a D4 y D7):
  - custodia que se abre (`keyAvailable(current)`) → `unchanged: true` sin escribir nada, como hoy;
  - custodia que no se abre → `CERTIFICATE_CHANGED` si `expectedCurrentId` no es la firma vigente;
    si lo es, sellar el material subido con la clave activa y la ligadura de la misma firma,
    `deleteSecret` e `insertSecret` sobre esa firma, sin tocar sus metadatos, y responder
    `unchanged: false` con la nueva cabecera del secreto.

  La inspección sigue fuera de la transacción y antes de ella, y el P12 se borra de la memoria como
  hoy. Sin migración. Se verifica con las pruebas de 1.3.
- [ ] 1.2 Añadir `signing_certificate.custody_restored` a `AUDIT_ACTIONS`
  (`backend/src/modules/audit/domain/audit-event.ts`) y registrarlo en la misma transacción de la
  recuperación con los metadatos de la firma (`describe("certificate", …)`),
  `custody.keyVersion.from` y `custody.keyVersion.to` (design D5). Nunca el archivo, la contraseña,
  la clave privada, la clave maestra ni el material cifrado. Se verifica con las aserciones de
  auditoría de 1.3.
- [ ] 1.3 Añadir a `backend/test/integration/signing-certificate-api.test.ts` un bloque «recuperación
  de la custodia» con su propio esquema y dos apps sobre él, con claves sintéticas distintas (design
  D9):
  - misma firma con custodia utilizable → `unchanged: true`, sin evento ni cambio del secreto;
  - recuperación con la clave nueva → `unchanged: false`, mismo id, `VALID`, secreto con la versión
    activa y bytes distintos, un evento `custody_restored` con las dos versiones;
  - segunda carga del mismo P12 → `unchanged: true`, sin evento nuevo;
  - contraseña incorrecta y certificado fuera de vigencia → su rechazo, y el secreto con los mismos
    bytes y versión, todavía `KEY_UNAVAILABLE`;
  - `expectedCurrentId` desactualizado o `null` → 409 `CERTIFICATE_CHANGED` sin cambios;
  - dos recuperaciones simultáneas → un solo evento, la otra `unchanged: true`;
  - firma distinta con la custodia no disponible → reemplazo con `signing_certificate.replaced`;
  - un administrador de la empresa B con el mismo certificado → la firma de A sigue igual y no
    disponible;
  - operador → 403 sin cambios;
  - volver solo a la clave antigua después de recuperar → `KEY_UNAVAILABLE`.

  Verificar que todo el archivo pasa con
  `corepack pnpm --filter @facturador/backend exec vitest run test/integration/signing-certificate-api.test.ts`,
  incluidas sin cambios las pruebas existentes, como «cargar otra vez la firma vigente no cambia
  nada ni audita».
- [ ] 1.4 Corregir el comentario de `unchanged` en `packages/contracts/src/signing-certificate.ts`
  («sin cambios cuando la firma ya era la vigente y su custodia se abre con la clave configurada»),
  sin cambiar el esquema. Verificar que `corepack pnpm openapi:check` pasa sin diferencias.

## 2. Confirmación de la recuperación en la pantalla de la firma

- [ ] 2.1 En `frontend/src/features/signing/signing-api.ts`, devolver «Restableciste la custodia de
  la firma de {titular}: ya se puede usar para emitir.» cuando la respuesta es
  `unchanged: false` y la firma devuelta es la que se envió en `expectedCurrentId` (design D6). La
  pantalla no cambia de estructura y sus estados (carga, error, permiso, vacío) siguen como están.
  Verificar en `frontend/test/signing-screen.test.tsx` el mensaje de recuperación, y que los de
  primera carga, reemplazo y «ya era la vigente» no cambian.

## 3. Ensayo C1 de sustitución de la clave maestra

- [ ] 3.1 Crear `backend/test/integration/e2e-master-key-replacement.test.ts` con el arnés
  `startE2eBackend` (design D9). Claves sintéticas generadas en cada ejecución, versión 1 la antigua
  y versión 2 la nueva, y P12 sintéticos de los fixtures. Recorrer por HTTP:
  1. empresa y administrador sintéticos y `main.ts` con la clave antigua;
  2. carga del P12 → `VALID`, y anotar el id de la firma;
  3. parada con `SIGTERM` y segundo arranque sobre el mismo esquema con la clave nueva →
     `KEY_UNAVAILABLE`;
  4. la misma carga por la vía autorizada → `unchanged: false`, el mismo id y `VALID`;
  5. el secreto con la versión 2 y el evento `custody_restored`;
  6. otra carga del mismo P12 → `unchanged: true`;
  7. la salida del proceso y las tablas sin la contraseña, las claves maestras ni fragmentos del
     P12.

  Sin comprobantes, sin firma de comprobantes y con la transmisión al SRI apagada. Verificar que
  pasa con
  `corepack pnpm --filter @facturador/backend exec vitest run test/integration/e2e-master-key-replacement.test.ts`
  contra el PostgreSQL de pruebas.

## 4. Documentación del comportamiento

- [ ] 4.1 Actualizar lo que describe la recuperación:
  - `docs/architecture/adr/0011-custodia-del-certificado.md`, consecuencias: volver a cargar el mismo
    certificado restablece su custodia con la clave configurada. La rotación sigue sin implementarse
    y sigue siendo requisito del go-live.
  - `docs/architecture/deployment.md`, líneas de la clave maestra y del respaldo: cargar otra vez el
    mismo P12 restablece la custodia, y volver atrás un cambio de clave exige el respaldo previo
    junto con la clave antigua.
  - `docs/security/threat-model.md`, fila de la pérdida o el cambio de la clave maestra.
  - `docs/product/capabilities.md`, fila de `signing-certificate`.

  Verificar con `corepack pnpm format:check`.
- [ ] 4.2 Con el ensayo de 3.1 en verde, escribir en `docs/architecture/deployment.md` el
  procedimiento probado de sustitución de la clave maestra (C1, decisión del propietario del
  2026-10-13; design D8):
  1. respaldo verificado de la base de datos;
  2. la clave antigua en custodia segura, aparte;
  3. la clave nueva, con su versión;
  4. reinicio o redespliegue;
  5. las firmas custodiadas quedan `KEY_UNAVAILABLE`;
  6. cada administrador vuelve a cargar su P12 con su contraseña;
  7. la recuperación sella con la clave actual;
  8. comprobar `VALID`;
  9. repetir por empresa;
  10. conservar o retirar la clave antigua según la política del operador, solo al terminar;
  11. la vuelta atrás exige restaurar juntos el respaldo previo y la clave antigua, nunca volver
      solo a la clave antigua.

  Decir que el volcado solo no recupera la custodia, y que las claves, el P12 y su contraseña nunca
  van a los registros ni al volcado. Marcar en `definition-of-done.md` el criterio de la clave
  maestra como cumplido por el procedimiento probado, citando el ensayo, y dejar en el ADR 0011 la
  rotación automática como deuda. Verificar con `corepack pnpm format:check`.

## 5. Verificación

- [ ] 5.1 Pasar `corepack pnpm openspec:validate`, `corepack pnpm security:dependencies` y
  `corepack pnpm security:secrets`, y terminar con `corepack pnpm verify` en verde.
