# ADR 0014: Casos especiales bloqueados por una matriz de soporte

## Status

Accepted. Origen: CTX §38.1, §57. Enmendado el 2026-10-02 al resolver Q-38: la matriz inicial
usa categorías con semántica explícita en lugar de los estados genéricos de CTX §38.1. Enmendado
el 2026-10-13 (`block-unsupported-special-cases-before-emission`, decisión del propietario): el 24 pasa a `OUT_OF_MVP`, conocido, no
soportado y bloqueado, en la matriz versión 2.

## Context

La ficha técnica incluye 26 anexos para casos especiales. Emitir uno de ellos como
comprobante ordinario produce un XML válido pero tributariamente incorrecto (CTX R7).

## Decision

- Cada anexo tiene un soporte declarado como dato versionado, con una de estas categorías:
  - `CORE`: forma parte del alcance global del MVP. No significa que ya esté implementado: el roadmap lo soporta cuando llega la capacidad que lo usa.
  - `CONDITIONAL_ISSUER_RULE`: depende de una condición del emisor que el administrador declara en la configuración tributaria. La aplicación nunca la infiere; el motor fiscal la aplica cuando corresponde.
  - `CONDITIONAL_GO_LIVE`: depende de una condición de la instalación que se verifica antes de su go-live.
  - `NOT_APPLICABLE`: el producto no soporta el tipo de dispositivo o proceso al que se refiere el anexo.
  - `OUT_OF_MVP`: fuera del MVP; toda operación que lo requiera está bloqueada.
- Matriz inicial (ficha v2.34, CTX §38):

  | Categoría | Anexos |
  | --- | --- |
  | `CORE` | 1 (XML 1.0.0), 2 (RIDE), 3 (XML 1.1.0), 10 (retención ATS 2.0.0), 14 (ejemplo XAdES-BES), 17 (liquidación de compra 1.0/1.1) |
  | `CONDITIONAL_ISSUER_RULE` | 21 (agentes de retención), 22 (RIMPE) |
  | `CONDITIONAL_GO_LIVE` | 26 (RUC del proveedor del sistema o servicio): Q-37 decide si una instalación lo necesita y cuál usa; su inserción en el XML no se implementa todavía, y un RUC proveedor de un tercero bloquea la emisión de los seis tipos antes de reservar |
  | `NOT_APPLICABLE` | 15 (compatibilidad de dispositivos) |
  | `OUT_OF_MVP` | 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 18, 19, 20, 23, 24 y 25. El 24 (grandes contribuyentes) se activa con la declaración de la configuración tributaria y bloquea, antes de reservar, la factura, la liquidación de compra, la nota de crédito y la nota de débito |

- Un anexo pasa a otra categoría solo con un cambio OpenSpec explícito; que un caso aparezca en la documentación tributaria no amplía el MVP.
- La operación declara de forma explícita los atributos que la hacen especial; el sistema no los infiere.
- **Una operación que requiere un caso especial no soportado se rechaza de forma explícita antes de emitir**, con un mensaje funcional. Nunca se degrada en silencio a un comprobante ordinario.
- El producto nunca declara cobertura total de los casos tributarios de Ecuador.

## Consequences

- No se emiten XML tributariamente incorrectos por casos especiales.
- Algunos contribuyentes no podrán usar el MVP para todas sus operaciones.
- Las condiciones del emisor de 21, 22 y 24 se declaran en la configuración tributaria (`add-taxpayer-setup`). El motor fiscal escribe el 21 y el 22 en los seis tipos, y el 24 bloquea la emisión de los tipos que alcanza (`backend/src/modules/fiscal/domain/special-cases.ts`).
- Soportar el 24 será un cambio OpenSpec propio, con el número de resolución y su validación, su congelación en el snapshot, el `campoAdicional` «Gran Contribuyente» con el número de resolución en el XML de los cuatro tipos, el RIDE y pruebas contra la fuente fijada.
- Una prueba de coherencia comprueba que la matriz publicada y el conjunto soportado por el motor coinciden.
- El soporte de cada anexo nuevo es un cambio OpenSpec.
