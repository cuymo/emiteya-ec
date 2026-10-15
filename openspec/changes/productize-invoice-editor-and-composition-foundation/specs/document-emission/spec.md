# Spec Delta

## ADDED Requirements

### Requirement: Aviso de Pruebas al emitir
En el editor de cualquier comprobante que el sistema emite, en una empresa en Pruebas, el sistema
SHALL decir junto a la acción de emitir, y de nuevo en la confirmación de la emisión, que el
comprobante no tendrá validez tributaria. El aviso SHALL llevar texto e icono, nunca solo color.
Si el ambiente no puede confirmarse, SHALL decirlo en los mismos lugares y no presentarlo como
Producción. El aviso no SHALL cambiar las condiciones, la confirmación ni el resultado de la
emisión.

#### Scenario: Factura en Pruebas
- **WHEN** un operador va a emitir una factura en una empresa en Pruebas
- **THEN** junto a la acción de emitir lee que la factura no tendrá validez tributaria
- **AND** la confirmación de la emisión lo repite

#### Scenario: Otro comprobante en Pruebas
- **WHEN** un operador va a emitir una nota de crédito, una nota de débito, una retención, una guía de remisión o una liquidación de compra en una empresa en Pruebas
- **THEN** junto a la acción de emitir y en la confirmación lee que el comprobante no tendrá validez tributaria

#### Scenario: Producción
- **WHEN** un operador va a emitir un comprobante en una empresa en Producción
- **THEN** no ve el aviso de Pruebas, y la confirmación muestra Producción como contexto, sin la presentación de éxito

#### Scenario: Ambiente desconocido
- **WHEN** el ambiente de la empresa no puede confirmarse y un operador va a emitir un comprobante
- **THEN** junto a la acción de emitir y en la confirmación lee que el ambiente no está confirmado, y nunca ve «Producción»
