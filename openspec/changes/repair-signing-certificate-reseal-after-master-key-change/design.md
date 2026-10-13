# Design

## Context

La motivación está en `proposal.md`, y los requisitos en `specs/signing-certificate/spec.md` y
`specs/audit-trail/spec.md`. Este es el estado observado el 2026-10-13 que decide el enfoque:

- **La carga** (`backend/src/modules/signing/application/signing-certificate.ts`, `upload`) hace la
  inspección completa fuera de la transacción: tamaño, archivo legible, contraseña, clave RSA de al
  menos 2048 bits que corresponde al certificado, firma de prueba con el algoritmo de la ficha, techo
  de iteraciones y plazo del pool, vigencia y RUC detectable. Un rechazo nunca llega a la
  transacción. Dentro de ella: bloqueo advisory por empresa, lectura de la firma vigente y, en este
  orden, `current.fingerprint === info.fingerprint` → `unchanged: true` (línea 168, sin mirar la
  clave), después la comprobación de `expectedCurrentId` → `CERTIFICATE_CHANGED`, el sellado con la
  clave activa y el reemplazo.
- **La custodia** (`custody/certificate-vault.ts`, ADR 0011, formato 1): una clave de datos por
  secreto, envuelta con la clave maestra activa; el AAD liga el secreto a `companyId` y
  `certificateId`; `canOpen` compara el HMAC `keyCheck` de la versión guardada sin descifrar nada.
  El llavero tiene hoy una sola clave, la activa.
- **El modelo de datos** ya permite sellar de nuevo en el sitio: el secreto no admite `UPDATE`
  (trigger), pero sí borrarse, y la inserción solo exige que la firma sea `ACTIVE`. Los metadatos de
  la firma no cambian (trigger de guarda) ni se borran. El repositorio ya expone `lock`,
  `findActive`, `deleteSecret` e `insertSecret`.
- **La validez** (`domain/certificate.ts`) deriva `KEY_UNAVAILABLE` de `canOpen`; `EXPIRED` tiene
  prioridad. El arranque registra, sin secretos, cada firma vigente que no se abre (`main.ts`,
  «hasta volver a cargarlas»), y la métrica `signing_certificate_usable` la muestra en 0.
- **La pantalla** (`frontend/src/features/signing`) pide «volver a cargarla» y envía
  `expectedCurrentId` con el id de la firma vigente que muestra; el mensaje de éxito es «ya era la
  vigente» con `unchanged`, y «Reemplazaste» o «Cargaste» en otro caso.
- **El ensayo end-to-end** (`backend/test/integration/e2e-backend.ts`) arranca `main.ts` como
  proceso y admite un segundo arranque sobre el mismo esquema (`db`), con otro entorno: sirve para
  ensayar un reinicio real con otra clave maestra.

## Goals / Non-Goals

**Goals:**
- Que volver a cargar el mismo P12 restablezca la custodia cuando, y solo cuando, la clave
  configurada no abre el secreto vigente.
- Conservar la identidad y los metadatos de la firma, las validaciones de la carga, la concurrencia,
  el aislamiento y la idempotencia existentes.
- Dejar evidencia ejecutable del ensayo C1 con material sintético.

**Non-Goals:**
- Recifrar secretos con la clave antigua y la nueva a la vez, llaveros con varias claves activas,
  rotación automática o en bloque.
- Detectar un secreto corrupto cuyo `keyCheck` es correcto: la definición de «utilizable» no cambia
  (`canOpen`), y la firma de un comprobante sigue fallando con `CustodyError` como hoy.
- Automatizar el procedimiento de sustitución de la clave maestra (C1): se documenta como
  procedimiento operativo probado, con el ensayo de D9, y lo ejecuta el operador.

## Decisions

### D1. La excepción a la idempotencia es «el secreto vigente no se abre con la clave configurada»

Bajo el bloqueo, con la firma vigente de la empresa leída en la transacción: misma huella y
`keyAvailable(current)` → sin cambios, como hoy. Misma huella y `!keyAvailable(current)` →
recuperación. `keyAvailable` ya existe en el caso de uso (custodia habilitada, secreto presente y
`canOpen`), así que cubre la versión distinta, la misma versión con otra clave y el secreto ausente.

Alternativas descartadas:
- **Volver a sellar siempre que coincida la huella:** destruye la idempotencia, escribe y audita en
  cada repetición.
- **Comparar solo la versión de la clave:** no detecta una clave distinta con la misma versión
  (`CERTIFICATE_MASTER_KEY_VERSION` es `1` por defecto).
- **Un endpoint propio de «recuperar custodia»:** suma superficie de API y de interfaz para algo que
  la pantalla ya pide hacer con la carga.

### D2. Se sella de nuevo en el sitio, con la misma firma

La recuperación sella el material subido con la clave activa y la misma ligadura
`{ companyId, certificateId: current.id }`, borra el secreto anterior e inserta el nuevo. La fila de
la firma no cambia: id, metadatos, fecha y autor de la carga original siguen siendo los de siempre,
y el evento de auditoría registra quién restableció la custodia y cuándo. Sin migración.

Descartado: **crear otra firma como reemplazo de sí misma.** Inventaría historia (una firma
`REPLACED` por el mismo certificado), cambiaría el id que ve la pantalla y contradiría «Misma firma
otra vez».

### D3. Orden y atomicidad

La inspección queda fuera de la transacción y antes de ella, como hoy: ninguna carga rechazada
(contraseña, archivo, vigencia, tamaño, plazo) llega a modificar nada. Dentro de la transacción y
bajo el bloqueo:

1. firma vigente con la misma huella y custodia que se abre → `unchanged: true`;
2. firma vigente con la misma huella y custodia que no se abre:
   1. `input.expectedCurrentId !== current.id` → `CERTIFICATE_CHANGED` (409);
   2. sellar con la clave activa (en memoria; el P12 se borra de la memoria después, como hoy);
   3. `deleteSecret(current.id)` e `insertSecret(sealed, binding)`;
   4. evento `signing_certificate.custody_restored`;
   5. `unchanged: false` con la firma y su nueva cabecera de secreto;
3. firma distinta o sin firma → el camino de carga y reemplazo de hoy, sin cambios.

El borrado, la inserción y el evento comparten la transacción: un fallo no deja la firma sin
secreto ni un evento sin efecto.

### D4. Concurrencia y vista del administrador

La recuperación es una modificación, así que exige `expectedCurrentId` igual a la firma vigente,
como el reemplazo. El caso sin cambios conserva su comportamiento actual (no compara
`expectedCurrentId`; lo cubre la prueba existente «cargar otra vez la firma vigente no cambia nada
ni audita»). Dos recuperaciones simultáneas se serializan en el bloqueo por empresa: la primera
sella y la segunda encuentra la custodia ya utilizable y responde sin cambios. Una recuperación
nunca pisa una firma más nueva: solo ocurre si la firma vigente leída bajo el bloqueo tiene la misma
huella que la subida; si otra carga la cambió, la subida sigue el camino del reemplazo y su
`expectedCurrentId` desactualizado es un conflicto.

### D5. Un evento de auditoría propio y pequeño

`signing_certificate.custody_restored`, añadido a `AUDIT_ACTIONS`, con
`describe("certificate", current, companyRuc)` (los metadatos de la firma, como los demás eventos de
la firma) más `custody.keyVersion.from` (la versión del secreto anterior, o `null` si no había) y
`custody.keyVersion.to` (la versión activa). Las versiones son identificadores de configuración, no
secretos. Nunca el archivo, la contraseña, la clave privada, la clave maestra ni el material cifrado.

Descartado: **reutilizar `signing_certificate.replaced`**, que afirma dos firmas distintas y
duplicaría la misma en `previous.*` y `certificate.*`; y **`signing_certificate.loaded`**, que
significa la primera carga.

### D6. Sin campos nuevos en la API; la pantalla distingue la recuperación

`PUT /api/v1/signing-certificate` responde lo de siempre. Una recuperación es `unchanged: false` con
la misma firma que el cliente indicó en `expectedCurrentId`, y eso basta para distinguirla de un
reemplazo. El mensaje de `signing-api.ts` pasa a «Restableciste la custodia de la firma de
{titular}: ya se puede usar para emitir.» en ese caso. Se corrige el comentario de `unchanged` en
`packages/contracts/src/signing-certificate.ts`; el esquema no cambia, y `openapi:check` lo confirma.

La pantalla no cambia de estructura ni de jerarquía (P0 a P3 igual): solo el texto de la
confirmación. El aviso «hay que volver a cargarla» pasa a ser cierto.

### D7. La contraseña guardada es la de esta carga

El secreto nuevo guarda la contraseña que la inspección acaba de comprobar con este P12. Un P12
reexportado con otra contraseña y el mismo certificado y clave queda custodiado con la contraseña
nueva. La paridad de validaciones viene de D3: la huella se compara después de la inspección
completa, así que la huella sola nunca basta. El RUC distinto del de la empresa sigue siendo solo
una advertencia (Q-17), igual que en cualquier carga.

### D8. Modelo de vuelta atrás

El secreto restablecido queda sellado solo con la clave configurada: el llavero no guarda la clave
anterior ni intenta abrir con varias. Volver atrás una sustitución de clave es operativo y completo:
restaurar el respaldo de la base de datos previo al cambio junto con la clave antigua. Volver solo a
la clave antigua deja no disponibles las firmas ya recuperadas (escenario «Volver solo a la clave
anterior»), y por eso el procedimiento C1 empezará con un respaldo verificado y la clave antigua en
custodia aparte.

### D9. Pruebas y ensayo C1

- **Integración de la API** (`signing-certificate-api.test.ts`, bloque nuevo con su propio esquema):
  misma firma con custodia utilizable sin cambios ni evento; recuperación con la clave nueva
  (`unchanged: false`, mismo id, `VALID`, secreto con la versión activa, evento con las versiones);
  segunda carga sin cambios; contraseña incorrecta y certificado fuera de vigencia sin tocar el
  secreto (bytes y versión iguales); `expectedCurrentId` desactualizado o `null` → 409 sin cambios;
  dos recuperaciones simultáneas → un solo evento; firma distinta con custodia no disponible →
  reemplazo; empresa B con el mismo certificado no toca la firma de A; operador → 403; volver solo a
  la clave antigua → `KEY_UNAVAILABLE`.
- **Ensayo end-to-end C1** (`e2e-master-key-replacement.test.ts`): `main.ts` con la clave sintética
  antigua (versión 1) → carga del P12 sintético → `VALID` → parada con `SIGTERM` → segundo arranque
  sobre el mismo esquema con la clave sintética nueva (versión 2) → `KEY_UNAVAILABLE` → la misma
  carga por HTTP → `unchanged: false`, misma firma, `VALID`, secreto con la versión 2, evento → otra
  carga → `unchanged: true`. La salida del proceso y las tablas no contienen la contraseña, las
  claves ni fragmentos del P12 (el patrón de `e2e-signing-certificate.test.ts`). Sin comprobantes,
  sin firma de comprobantes y con la transmisión al SRI apagada.

### Operación sensible (`docs/architecture/backend.md`)

1. **Quién:** solo un administrador (`certificate.manage`).
2. **Tenant del llamador:** el del contexto autenticado (`ctx.companyId`).
3. **Tenant del recurso:** la firma vigente de esa misma empresa, leída por `findActive(companyId)`.
4. **Propiedad:** la firma se busca por la empresa del contexto y el secreto se liga a
   `{ companyId, certificateId }` en el AAD; la solicitud no admite un id de empresa.
5. **Cambiar un id en la solicitud:** `expectedCurrentId` solo se compara con la firma vigente de la
   empresa del contexto; no selecciona otra firma ni otra empresa.
6. **Dos veces:** la segunda encuentra la custodia utilizable y responde sin cambios.
7. **A la vez:** el bloqueo advisory por empresa las serializa (D4).
8. **Idempotencia:** natural, por el estado: recuperar convierte la custodia en utilizable, y la
   custodia utilizable no se vuelve a sellar.
9. **Restricciones de base de datos:** sin `UPDATE` del secreto; inserción solo para la firma
   `ACTIVE`; una sola firma `ACTIVE` por empresa; metadatos inmutables y sin borrado.
10. **Auditoría:** sí, `signing_certificate.custody_restored` (D5).
11. **Pruebas de autorización:** operador 403 y empresa B sin efecto sobre A (D9).
12. **Fugas entre cuentas:** ninguna; la respuesta y el evento solo llevan metadatos de la firma de
    la propia empresa.

### Validación, migraciones, observabilidad y rendimiento

- **Validación:** sin cambios; la de la carga normal.
- **Migraciones:** ninguna.
- **Observabilidad:** sin registros nuevos; el registro del arranque y la métrica de firma
  utilizable reflejan la recuperación sin más cambios.
- **Rendimiento:** un sellado AES y dos escrituras solo cuando hay recuperación.

## Risks / Trade-offs

- [Un administrador recupera la firma con una clave mal configurada que después se corrige] → la
  firma vuelve a quedar no disponible y se recupera otra vez con el mismo P12; el procedimiento C1
  pedirá comprobar la clave antes de invitar a los administradores.
- [Vuelta atrás parcial: solo la clave antigua tras recuperar algunas empresas] → D8: la vuelta atrás
  es el respaldo previo más la clave antigua.
- [Consumidores de la auditoría que esperan solo `loaded` y `replaced`] → la acción nueva entra en la
  lista cerrada y en la spec `audit-trail`; no hay pantallas que enumeren las acciones de la firma.
- [La versión anterior de la imagen no conoce la recuperación] → el formato del secreto no cambia: un
  secreto restablecido se abre con la misma clave en cualquier versión; volver a la imagen anterior
  solo devuelve el comportamiento sin cambios.

## Migration Plan

Sin migración de datos ni de esquema. Se despliega con la imagen nueva. Volver a la imagen anterior
es seguro: las firmas ya recuperadas siguen abriéndose con la clave configurada.
