# Spec Delta

## ADDED Requirements

### Requirement: Aviso de existencias en el borrador
La vista previa de un borrador SHALL avisar, sin bloquear su emisión, cuando la cantidad pedida de un producto con inventario activo (la suma de todas sus líneas) supera su saldo vigente, y cuando un producto marcado como controlado no tiene el inventario inicializado. El aviso es orientativo: otra operación puede cambiar el saldo antes de la autorización.

#### Scenario: Cantidad mayor que el saldo
- **WHEN** un borrador pide 3 y 4 unidades de un producto con saldo 5
- **THEN** la vista previa avisa que la cantidad pedida, 7, supera el saldo, 5, y el borrador se puede emitir

#### Scenario: Producto sin inventario inicializado
- **WHEN** un borrador incluye un producto marcado como controlado sin inventario inicializado
- **THEN** la vista previa avisa que el producto no tiene inventario inicializado, sin tratar su saldo como cero, y el borrador se puede emitir

#### Scenario: Saldo suficiente
- **WHEN** un borrador pide 2 unidades de un producto con saldo 5
- **THEN** la vista previa no avisa nada sobre ese producto

#### Scenario: Aviso que no bloquea
- **WHEN** un usuario emite un borrador con avisos de existencias y sin otros problemas
- **THEN** la factura se emite
