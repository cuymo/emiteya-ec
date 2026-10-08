# Spec Delta

## MODIFIED Requirements

### Requirement: Documentos sustento de la retención
Un comprobante SHALL tener uno o más documentos sustento, cada uno una referencia estructurada a un comprobante de los tipos factura (01) o nota de venta (02), emitidos por el proveedor, o liquidación de compra (03), que emite el adquirente en los casos que la normativa permite, como política del MVP. Son declaraciones del usuario: el sistema no verifica su existencia en el SRI ni crea facturas recibidas, compras ni cuentas por pagar.

#### Scenario: Varios documentos sustento
- **WHEN** un usuario prepara una retención con dos facturas del mismo proveedor
- **THEN** el comprobante lleva los dos documentos sustento, cada uno con sus propias retenciones

#### Scenario: Sin documentos sustento
- **WHEN** un usuario intenta emitir una retención sin documentos sustento
- **THEN** el sistema la rechaza sin reservar número

#### Scenario: Tipo de documento fuera del alcance
- **WHEN** un borrador declara como documento sustento un comprobante de venta emitido en el exterior
- **THEN** el sistema lo rechaza indicando los tipos admitidos

#### Scenario: Documento presentado como declarado
- **WHEN** un usuario consulta una retención emitida
- **THEN** cada documento sustento figura como declarado por el usuario, sin ninguna indicación de que el sistema lo haya verificado
