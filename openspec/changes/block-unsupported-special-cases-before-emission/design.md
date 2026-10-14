# Design

## Context

La motivación está en `proposal.md`, y los requisitos en `specs/document-emission/spec.md` y
`specs/fiscal-catalogs/spec.md`. Este es el estado observado el 2026-10-13 en `main` (`a85fade`):

- **Factura.**
  - `backend/src/modules/invoices/domain/evaluation.ts` evalúa en su paso 9 los casos especiales
    del emisor con `issuerSpecialCases(profile)`: 21 (resolución de agente de retención), 22
    (categoría RIMPE), 24 (`largeTaxpayer`) y 26 (RUC proveedor distinto del propio).
  - Un anexo activo es soportado si su entrada de la matriz es `CORE` o `CONDITIONAL_ISSUER_RULE`
    y además está en `SUPPORTED_SPECIAL_CASES = {21, 22, 24}`. Si no, la evaluación añade
    `SPECIAL_CASE_UNSUPPORTED`, y la emisión lo rechaza con 409 antes de `reserveDocumentIn`.
  - Hoy el 24 pasa y el 26 se rechaza. El snapshot registra las cuatro reglas.
- **Los otros cinco tipos** (nota de crédito, nota de débito, comprobante de retención, guía de
  remisión y liquidación de compra).
  - Cada uno carga la configuración vigente en `application/context.ts`
    (`reads.currentConfig(companyId)`) y empuja ahí los problemas de configuración
    (`TAXPAYER_NOT_CONFIGURED`, el ambiente).
  - La emisión evalúa ese contexto dos veces antes de reservar: la comprobación previa fuera de la
    transacción y otra vez dentro, con el borrador y la configuración bloqueados. Solo después
    reserva capacidad, inventario y el número con `reserveDocumentIn`.
  - Su `IssuerConfig.profile` (en `domain/build-snapshot.ts`) no declara `largeTaxpayer` ni
    `providerRuc`. Los lectores pasan el perfil completo de la configuración, así que el dato ya
    llega en ejecución y solo falta en el tipo.
  - Ninguno mira los casos especiales.
- **XML.** El `infoTributaria` común escribe `agenteRetencion` (21) y `contribuyenteRimpe` (22) en los
  seis tipos. Nada escribe `infoAdicional` para el 24 ni para el 26.
- **Matriz publicada.**
  - El dataset `special-case-matrix` versión 1 clasifica el 24 como `CONDITIONAL_ISSUER_RULE` («el
    motor fiscal la aplica cuando corresponde», ADR 0014).
  - La consulta usa la última versión del dataset (`latestVersion`), como el `schema-registry`, que
    ya tiene una versión 2.
- **Fuentes.**
  - Ficha v2.34, Anexo 24, página 132: «comprobantes de venta, notas de crédito y notas de débito».
  - Reglamento de Comprobantes, art. 1 (edición 2023-12-29, `sri-catalogs/fuentes/reglamento-
    comprobantes-liquidacion-de-compra.txt`): son comprobantes de venta las facturas y las
    liquidaciones de compra, entre otros.
  - Ficha v2.34, Anexo 26, página 135: «en los comprobantes emitidos».

## Goals / Non-Goals

**Goals:**
- Que ninguna emisión de un caso especial no soportado se degrade en silencio, en ninguno de los
  seis tipos.
- Una sola regla, un solo código y un solo lugar donde se decide qué anexos soporta el motor.
- La matriz publicada dice la verdad sobre el Anexo 24.

**Non-Goals:**
- Escribir la leyenda del Anexo 24 o el campo del Anexo 26.
- Bloquear los anexos `OUT_OF_MVP` que dependen de la actividad del contribuyente (combustibles,
  materiales de construcción): el producto no infiere obligaciones (ADR 0014).
- Avisar en la configuración tributaria o en la preparación para emitir.

## Decisions

### D1. Una regla compartida de casos especiales del emisor en `fiscal`

`backend/src/modules/fiscal/domain/special-cases.ts` (`fiscal` es la dependencia común de los seis
tipos; las pruebas de dirección de dependencias lo admiten) reúne lo que hoy vive en la evaluación
de la factura:
- `issuerSpecialCases(profile)`: qué anexos activa la configuración declarada (21, 22, 24 y 26).
- **Aplicabilidad por tipo:**
  - 21 y 22: los seis tipos;
  - 24: `01`, `03`, `04` y `05`;
  - 26: los seis tipos.
- `SUPPORTED_SPECIAL_CASES = {21, 22}`: lo que el motor escribe de verdad.
- `unsupportedSpecialCase(profile, documentType)`: el primer anexo activo, aplicable a ese tipo y no
  soportado, o `null`. Con su mensaje.

La factura conserva además la comprobación de la categoría de la matriz y el registro de las reglas
en su snapshot. Las dos condiciones deben cumplirse para considerar soportado un anexo.

Alternativas descartadas:
- **Copiar el bloqueo en cada módulo:** cinco copias de la misma decisión fiscal.
- **Consultar la matriz desde los cinco módulos:** añade una lectura de catálogos a cada contexto
  para algo que el motor decide en código. La matriz publicada queda coherente por D3.

### D2. Dónde se rechaza: con los problemas de configuración, antes de reservar

En los cinco módulos, `application/context.ts` añade el problema `SPECIAL_CASE_UNSUPPORTED` justo
después de cargar la configuración, junto a `TAXPAYER_NOT_CONFIGURED` y al ambiente. Así lo ven las
dos evaluaciones de la emisión (la previa y la de dentro de la transacción) y la vista previa que
use el mismo contexto. El primer problema se rechaza con el 409 de cada tipo antes de reservar
capacidad, inventario o número, sin abrir la transacción en el caso previo.

La factura ya rechaza en su evaluación antes de `reserveDocumentIn`: solo cambia el conjunto
soportado y pasa a usar la regla compartida.

### D3. El Anexo 24 en la matriz publicada: `special-case-matrix` versión 2, fuera del MVP

Un archivo nuevo, `backend/src/modules/catalogs/datasets/special-case-matrix/2.json`, con los 26
anexos de la versión 1 y el 24 en `OUT_OF_MVP` («toda operación que lo requiera está bloqueada»). El
número, el tema y la referencia a la fuente no cambian. La versión 1 no se edita (ADR 0020). Lleva
su fila y su checksum en `docs/product/sri-catalogs/README.md`, y la consulta muestra la última
versión. Sin migración: el cargador aplica el dataset nuevo al arrancar.

Con la categoría `OUT_OF_MVP`, la factura bloquea el 24 por dos razones a la vez: la categoría y
`SUPPORTED_SPECIAL_CASES`.

Descartado: **dejar el 24 como `CONDITIONAL_ISSUER_RULE` y cambiar solo el código.** El motor lo
bloquearía, pero la matriz que ven los usuarios seguiría diciendo que el sistema lo aplica.

### D4. Un solo código, el de la factura

`SPECIAL_CASE_UNSUPPORTED` entra en `CREDIT_NOTE_ERROR_CODES`, `DEBIT_NOTE_ERROR_CODES`,
`WITHHOLDING_ERROR_CODES`, `SHIPPING_GUIDE_ERROR_CODES` y `PURCHASE_SETTLEMENT_ERROR_CODES`. Es un
cambio aditivo, y `openapi:check` regenera el documento. El mensaje identifica el anexo:
- 24: «El anexo 24 (grandes contribuyentes) aplica a este comprobante y su generación todavía no
  está soportada.»
- 26: el texto actual de la factura.

Sin datos privados: el mensaje no repite el RUC.

Los rechazos previos a la reserva no se auditan (spec `audit-trail`: «la operación se rechaza … no
se registra ningún evento»), así que este tampoco. Las métricas de conflicto de cada tipo siguen su
mapa actual.

Descartado: **códigos distintos por anexo** (`LARGE_TAXPAYER_UNSUPPORTED`, …). El código ya es
estable, y el anexo queda en el mensaje. Decisión del propietario del 2026-10-13: reutilizar
`SPECIAL_CASE_UNSUPPORTED`. Los problemas de emisión no tienen hoy un campo estructurado para el
anexo, y no se añade uno.

### D5. Mapeo de los tipos del Anexo 24

| Tipo | Código | ¿Lo cubre el Anexo 24? | Fuente |
| --- | --- | --- | --- |
| Factura | 01 | Sí | Comprobante de venta (Reglamento, art. 1, a) |
| Liquidación de compra | 03 | Sí | Comprobante de venta (Reglamento, art. 1, c) |
| Nota de crédito | 04 | Sí | Nombrada en el anexo |
| Nota de débito | 05 | Sí | Nombrada en el anexo |
| Guía de remisión | 06 | No | Documento complementario que el anexo no nombra |
| Comprobante de retención | 07 | No | Comprobante de retención (Reglamento, art. 3), no de venta |

La liquidación de compra entra por la definición del art. 1, aunque el anexo no la nombra: aprobado
por el propietario el 2026-10-13.

### D6. La declaración de gran contribuyente se queda como está

`largeTaxpayer` sigue en la configuración tributaria y en los snapshots: es lo que activa el bloqueo.
No se añade el número de resolución. Soportar el Anexo 24 en el futuro será su propio cambio
OpenSpec, con:
- número de resolución y su validación;
- su congelación en el snapshot;
- el `campoAdicional` en el XML de los cuatro tipos, con pruebas de XSD;
- el bloque del RIDE;
- pruebas contra la fuente fijada.

Queda como fila de deuda y en el ADR 0014.

### D7. Pruebas

- **Regla compartida** (unitaria): cada combinación de declaración y tipo. 24 activo en
  `01`, `03`, `04` y `05`, y no en `06` ni `07`. 26 activo en los seis. 26 con el propio RUC, no
  activo. 21 y 22 nunca bloquean.
- **Cada tipo** (integración, en su archivo de emisión y con su patrón de rechazo):
  - 409 `SPECIAL_CASE_UNSUPPORTED` con la empresa gran contribuyente (en los cuatro tipos del 24) y
    con un RUC proveedor de un tercero (en los seis);
  - y en cada rechazo, sin cambios en las reservas de secuencial, los comprobantes, las claves, la
    idempotencia, los snapshots, los movimientos de inventario (factura y nota de crédito con
    productos controlados), los trabajos de transmisión y los intentos al SRI, con el borrador sin
    emitir;
  - la retención y la guía con la empresa gran contribuyente se emiten;
  - la emisión normal sin declaración sigue igual (pruebas existentes);
  - un segundo intento devuelve el mismo rechazo.
- **Matriz:** la prueba del manifiesto de datasets con la versión 2, y la consulta que muestra el 24
  `OUT_OF_MVP`.
- **Coherencia de la matriz y el motor** (requisito del propietario): una prueba genérica comprueba
  que todo anexo que la matriz publicada presenta como aplicado por el sistema (`CORE` y
  `CONDITIONAL_ISSUER_RULE`) lo soporta de verdad el motor, y que el 24 no figura como soportado.
  Evita que se repita este tipo de desajuste.
- **Regresión:** los fixtures que registran la categoría o la versión de la matriz (por ejemplo
  `invoice-regression/snapshot.json`) se actualizan solo en esos campos, nunca el XML.
- Ninguna prueba contacta al SRI: las transmisiones de las pruebas usan los dobles existentes.

### Operación sensible (`docs/architecture/backend.md`)

1. **Quién:** quien ya puede emitir cada tipo; sin cambios.
2. **Tenant del llamador:** el del contexto autenticado.
3. **Tenant del recurso:** la configuración vigente de esa empresa.
4. **Propiedad:** la regla solo lee la configuración que el contexto ya cargó para la empresa del
   usuario.
5. **Cambiar un id en la solicitud:** no hay ids nuevos.
6. **Dos veces:** el mismo rechazo, sin efecto.
7. **A la vez:** cada intento evalúa con la configuración bloqueada dentro de la transacción. Una
   declaración que cambia entre la evaluación previa y la reserva se vuelve a evaluar.
8. **Idempotencia:** la de cada tipo, sin cambios. Un rechazo no deja registro.
9. **Restricciones:** sin cambios en la base de datos.
10. **Auditoría:** no, como todo rechazo previo a la reserva.
11. **Pruebas de autorización:** las existentes de cada tipo; la regla no abre ninguna vía nueva.
12. **Fugas entre cuentas:** ninguna; el mensaje no incluye datos de la empresa ni de otras.

## Risks / Trade-offs

- [Una empresa gran contribuyente que hoy emite facturas deja de poder emitir los cuatro tipos] →
  es el comportamiento correcto: hoy emite comprobantes incompletos. El mensaje lo explica. La
  revisión normativa y el ADR 0014 lo documentan, y soportarla queda como deuda (D6).
- [La liquidación de compra entra por una definición y no por el texto del anexo] → aprobado (D5).
  Excluirla sería emitir sin la leyenda si el art. 1 rige.
- [Cambian campos de fixtures de regresión] → solo la categoría y la versión de la matriz; los XML no
  cambian.
- [El código único no distingue el anexo de forma estructurada] → aceptado (D4): el mensaje lo
  identifica.

## Migration Plan

Sin migración de esquema. El dataset `special-case-matrix` versión 2 se aplica al arrancar con la
imagen nueva. Volver a la imagen anterior con la versión 2 ya cargada en la base no está
comprobado: la tarea de la matriz verifica qué hace el cargador de esa imagen ante una versión que
no conoce, y lo documenta en `deployment.md` («Actualizaciones y reversión»).

