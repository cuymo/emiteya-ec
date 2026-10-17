## ADDED Requirements

### Requirement: Borradores en la lista de notas de crédito
La lista de notas de crédito SHALL mostrar, con el filtro de estado en «Todos», primero los borradores de
nota de crédito de la empresa, el último editado arriba, y después los comprobantes emitidos en su orden de
siempre, en la misma tabla, la misma paginación y el mismo total que entrega el servidor. Cada
borrador SHALL mostrar el estado «Borrador», el comprador o el número de la factura modificada, su total previo o «Incompleto» y la fecha de su última edición, y SHALL
abrir su editor desde la fila y poder eliminarse con confirmación. El filtro de estado SHALL ofrecer
«Borradores», que muestra solo los borradores; un estado de nota emitida SHALL excluirlos.
El filtro de causa SHALL aplicarse también a los borradores, por la causa que declaran. La búsqueda SHALL
encontrar también los borradores por lo que muestran. Solo quien puede preparar borradores de
nota de crédito SHALL verlos. Ninguna otra pantalla de la lista SHALL repetir los borradores en un panel aparte.

#### Scenario: Borradores arriba
- **WHEN** la empresa tiene dos borradores de nota de crédito y treinta comprobantes emitidos, y un operador abre Notas de crédito con 25 filas por página
- **THEN** la primera página muestra los dos borradores con el estado «Borrador» y después 23 comprobantes emitidos, y la lista indica 32 en total

#### Scenario: Solo borradores
- **WHEN** un operador elige el estado «Borradores»
- **THEN** ve solo los borradores de nota de crédito de su empresa, paginados, y ningún comprobante emitido

#### Scenario: Un estado emitido los excluye
- **WHEN** un operador elige un estado de comprobante emitido
- **THEN** la lista no muestra borradores

#### Scenario: Búsqueda sobre borradores
- **WHEN** un operador busca el nombre de un comprador que solo tiene un borrador
- **THEN** ve ese borrador con el estado «Borrador»

#### Scenario: Abrir y eliminar desde la fila
- **WHEN** un operador elige un borrador de la lista
- **THEN** se abre su editor, y desde las acciones de la fila puede eliminarlo después de confirmar

#### Scenario: Borradores de otra empresa
- **WHEN** otra empresa de la instalación tiene borradores de nota de crédito
- **THEN** ninguno aparece en la lista ni cuenta en su total
