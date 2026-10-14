## MODIFIED Requirements

### Requirement: Casos especiales no soportados
El sistema SHALL rechazar antes de reservar una emisión que requiere un caso especial que la matriz vigente no soporta, ya sea por un atributo de la operación o por una condición declarada del emisor. Nunca la degrada a un comprobante ordinario. El rechazo usa un único código de caso especial no soportado que identifica el anexo, y no consume secuencial, clave de acceso, snapshot, movimiento de inventario ni trabajo de transmisión.

#### Scenario: Anexo 26 aplicable y no soportado
- **WHEN** la empresa declara un RUC proveedor distinto del suyo, porque usa un sistema de un tercero (anexo 26), y un usuario emite una factura, una liquidación de compra, una nota de crédito, una nota de débito, una guía de remisión o un comprobante de retención
- **THEN** el sistema rechaza la emisión antes de reservar e identifica el anexo 26 como caso especial no soportado

#### Scenario: Anexo 26 que no corresponde
- **WHEN** la empresa no declara un RUC proveedor, o declara su propio RUC
- **THEN** el anexo 26 no aplica y la emisión no se rechaza por él

#### Scenario: Anexo 24 aplicable y no soportado
- **WHEN** la empresa se declara gran contribuyente (anexo 24) y un usuario emite una factura, una liquidación de compra, una nota de crédito o una nota de débito
- **THEN** el sistema rechaza la emisión antes de reservar e identifica el anexo 24 como caso especial no soportado

#### Scenario: Anexo 24 en los comprobantes que no alcanza
- **WHEN** la empresa se declara gran contribuyente y un usuario emite una guía de remisión o un comprobante de retención
- **THEN** el anexo 24 no aplica a esos comprobantes y la emisión no se rechaza por él

#### Scenario: Anexo 24 que no corresponde
- **WHEN** la empresa no se declara gran contribuyente
- **THEN** el anexo 24 no aplica y la emisión no se rechaza por él

#### Scenario: Rechazo sin efectos fiscales
- **WHEN** una emisión se rechaza por un caso especial no soportado, y el usuario la repite
- **THEN** cada intento responde el mismo rechazo
- **AND** ningún secuencial se consume, no existe comprobante reservado, clave de acceso, snapshot, movimiento de inventario, trabajo de transmisión ni intento de envío al SRI, y el borrador sigue sin emitir

#### Scenario: Condición de otra empresa
- **WHEN** la empresa A se declara gran contribuyente o declara un RUC proveedor de un tercero, y un usuario de la empresa B, que no los declara, emite un comprobante
- **THEN** la emisión de la empresa B no se rechaza por los anexos 24 ni 26
