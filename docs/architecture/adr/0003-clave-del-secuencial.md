# ADR 0003: Clave del secuencial

## Status

Accepted, con enmienda pendiente de Q-02. Origen: ERS §22.2, ADR-003; CTX §5, §27.3, §28.

## Context

El ERS define el secuencial como empresa + establecimiento + punto de emisión + tipo de
comprobante. CTX §5 añade el ambiente a la restricción de unicidad, pero su contador y su
reserva (§5, §28) no lo incluyen.

## Decision

- Un contador independiente por empresa, establecimiento, punto de emisión y tipo de comprobante.
- La reserva es atómica: transacción con bloqueo de la fila del contador.
- La base de datos impone la unicidad del secuencial con el ambiente incluido.
- Un número reservado nunca vuelve al contador ni se reutiliza; retroceder el contador exige una operación administrativa explícita y auditada.

## Consequences

- Sin duplicados bajo concurrencia, verificado con 100+ reservas paralelas (ERS AC-04).
- Los huecos de numeración se toleran: la integridad depende de la unicidad y la trazabilidad (CTX §28.1).
- Q-02 decide si el contador también se separa por ambiente; la respuesta enmienda este ADR.
