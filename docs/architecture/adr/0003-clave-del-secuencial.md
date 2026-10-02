# ADR 0003: Clave del secuencial

## Status

Accepted. Origen: ERS §22.2, ADR-003; CTX §5, §27.3, §28. Enmienda de Q-02 incorporada el
2026-10-02 en la revisión de readiness de `add-fiscal-numbering` y aprobada por el dueño del
producto.

## Context

El ERS define el secuencial como empresa + establecimiento + punto de emisión + tipo de
comprobante. CTX §5 añade el ambiente a la restricción de unicidad, pero su contador y su
reserva (§5, §28) no lo incluyen (C-02). Para cuestiones técnicas del SRI, CTX prevalece sobre
el ERS (`docs/product/overview.md`).

La decisión de Q-02 se apoya en tres razones de distinta naturaleza:

1. **Fuente técnica prevalente.** CTX §5 incluye el ambiente en la identidad y la unicidad del secuencial, junto con empresa, establecimiento, punto, tipo y número.
2. **Fuente técnica.** El SRI distingue Pruebas y Producción (CTX §6), y el ambiente forma parte de los datos que identifican el comprobante en su clave de acceso (CTX §8.1).
3. **Razón de diseño y operación.** Mantener secuencias independientes evita que la actividad en Pruebas altere la numeración operativa de Producción.

La tercera es una decisión del proyecto. No se atribuye al SRI ni a ninguna norma la exigencia
de contadores separados por ambiente: ninguna fuente oficial consultada lo dice explícitamente.

Alternativas para el contador (Q-02):

| Alternativa | A favor | En contra |
| --- | --- | --- |
| Un contador por ambiente | Las pruebas nunca consumen números de Producción. Coincide con la unicidad de CTX §5. | El administrador configura el siguiente secuencial por ambiente. |
| Un contador compartido | Un solo contador por punto y tipo. | Cada comprobante de Pruebas deja un hueco en la numeración de Producción, al salir a producción y cada vez que se vuelve a Pruebas; el ambiente en la unicidad sobraría. |

## Decision

- Un contador independiente por empresa, ambiente, establecimiento, punto de emisión y tipo de comprobante. Dentro de cada ambiente se cumple el contador por establecimiento, punto y tipo de ERS RF-120.
- Pruebas y Producción mantienen secuencias independientes. Al cambiar de ambiente y volver al anterior, la secuencia de ese ambiente continúa donde quedó: el cambio de ambiente no la comparte ni la reinicia.
- La reserva es atómica: transacción con bloqueo de la fila del contador.
- La base de datos impone la unicidad del secuencial con el ambiente incluido.
- Un número reservado nunca vuelve al contador ni se reutiliza; retroceder el contador exige una operación administrativa explícita y auditada.

## Consequences

- Sin duplicados bajo concurrencia, verificado con 100+ reservas paralelas (ERS AC-04).
- Los huecos de numeración se toleran: la integridad depende de la unicidad y la trazabilidad (CTX §28.1).
- El ajuste administrativo del siguiente secuencial se hace por ambiente, punto y tipo.
- La reserva recibe el ambiente vigente, el mismo que el comprobante fija en su snapshot (`fiscal-emission.md`).
