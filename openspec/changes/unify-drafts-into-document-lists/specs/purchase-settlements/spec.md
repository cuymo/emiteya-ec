## ADDED Requirements

### Requirement: Borradores en la lista de liquidaciones de compra
La lista de liquidaciones de compra SHALL mostrar, con el filtro de estado en «Todos», primero los borradores de
liquidación de compra de la empresa, el último editado arriba, y después los comprobantes emitidos en su orden de
siempre, en la misma tabla, la misma paginación y el mismo total que entrega el servidor. Cada
borrador SHALL mostrar el estado «Borrador», el proveedor, su total previo o «Incompleto» y la fecha de su última edición, y SHALL
abrir su editor desde la fila y poder eliminarse con confirmación. El filtro de estado SHALL ofrecer
«Borradores», que muestra solo los borradores; un estado de liquidación emitida SHALL excluirlos. La búsqueda SHALL
encontrar también los borradores por lo que muestran. Solo quien puede preparar borradores de
liquidación de compra SHALL verlos. Ninguna otra pantalla de la lista SHALL repetir los borradores en un panel aparte.

#### Scenario: Borradores arriba
- **WHEN** la empresa tiene dos borradores de liquidación de compra y treinta comprobantes emitidos, y un operador abre Liquidaciones de compra con 25 filas por página
- **THEN** la primera página muestra los dos borradores con el estado «Borrador» y después 23 comprobantes emitidos, y la lista indica 32 en total

#### Scenario: Solo borradores
- **WHEN** un operador elige el estado «Borradores»
- **THEN** ve solo los borradores de liquidación de compra de su empresa, paginados, y ningún comprobante emitido

#### Scenario: Un estado emitido los excluye
- **WHEN** un operador elige un estado de comprobante emitido
- **THEN** la lista no muestra borradores

#### Scenario: Búsqueda sobre borradores
- **WHEN** un operador busca el nombre de un proveedor que solo tiene un borrador
- **THEN** ve ese borrador con el estado «Borrador»

#### Scenario: Abrir y eliminar desde la fila
- **WHEN** un operador elige un borrador de la lista
- **THEN** se abre su editor, y desde las acciones de la fila puede eliminarlo después de confirmar

#### Scenario: Borradores de otra empresa
- **WHEN** otra empresa de la instalación tiene borradores de liquidación de compra
- **THEN** ninguno aparece en la lista ni cuenta en su total
