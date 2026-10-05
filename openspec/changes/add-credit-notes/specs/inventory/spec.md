# Spec Delta

## MODIFIED Requirements

### Requirement: Tipos de movimiento y su signo
Cada movimiento SHALL tener un tipo y una variación con signo: `INICIAL` mayor o igual que cero, `ENTRADA_MANUAL` positiva, `SALIDA_FACTURA` negativa, `DEVOLUCION_NC` positiva y `AJUSTE` positiva o negativa, nunca cero salvo el `INICIAL` de cero. `DEVOLUCION_NC` solo la registra una nota de crédito al autorizarse, por el retorno físico declarado.

#### Scenario: Signo de cada movimiento
- **WHEN** se registran un `INICIAL` de 10, una entrada de 5, la salida de una factura de 3 unidades y un ajuste de -1
- **THEN** sus variaciones son 10, 5, -3 y -1, y el saldo es 11

#### Scenario: Devolución por nota de crédito
- **WHEN** se autoriza una nota de crédito con un retorno físico declarado de 2 unidades de un producto
- **THEN** existe una `DEVOLUCION_NC` de +2 de ese producto que referencia la nota

#### Scenario: Sin devoluciones por nota de crédito
- **WHEN** un usuario o el sistema opera sobre el inventario sin una nota de crédito autorizada con retorno físico
- **THEN** no se registra ninguna devolución por nota de crédito

## ADDED Requirements

### Requirement: Devolución de stock al autorizar una nota de crédito
Cuando una nota de crédito entra en autorizada, el sistema SHALL registrar, en la misma operación que esa transición, una sola `DEVOLUCION_NC` por producto con la suma exacta del retorno físico declarado en sus líneas, sumada al saldo. Nunca la registra una nota en otro estado. Un saldo negativo previo no la impide.

#### Scenario: Varias líneas del mismo producto
- **WHEN** se autoriza una nota con dos líneas del producto A de retorno físico `1.5` y `2.25`
- **THEN** existe una sola `DEVOLUCION_NC` de `+3.75` para A

#### Scenario: Estados sin devolución
- **WHEN** una nota con retorno físico está reservada, firmada, recibida, verificando con el SRI o en revisión manual, o termina devuelta o no autorizada
- **THEN** no se registra ninguna devolución y el saldo no cambia

#### Scenario: Saldo negativo
- **WHEN** se autoriza una nota con un retorno físico de 3 unidades de un producto con saldo -5
- **THEN** el saldo queda en -2

#### Scenario: Control desactivado después de facturar
- **WHEN** se autoriza una nota con retorno físico de un producto que afectaba al inventario en la factura y hoy tiene el control desactivado
- **THEN** la devolución se registra y el kárdex continúa

#### Scenario: Repetición de la autorización
- **WHEN** la autorización de la nota se procesa otra vez por un reintento o una reconciliación
- **THEN** no se registra otra devolución y el saldo no cambia

#### Scenario: Autorización coherente
- **WHEN** una nota con retorno físico pasa a autorizada
- **THEN** en la misma operación su crédito queda aplicado, su retorno físico aplicado, la devolución registrada y el saldo actualizado; si algo falla, nada de eso ni la autorización quedan

#### Scenario: Devoluciones simultáneas con otros movimientos
- **WHEN** la autorización de una nota con retorno físico y una entrada manual del mismo producto llegan a la vez
- **THEN** existen ambos movimientos y el saldo es la suma exacta del kárdex

### Requirement: Recuperación de la devolución tras un fallo local
Si el SRI autorizó una nota de crédito y la operación local que la autoriza y registra su devolución falla, el sistema SHALL conservar la respuesta del SRI y volver a aplicar la autorización desde ella, sin otra llamada de transmisión, hasta dejar la nota autorizada con una sola devolución por producto.

#### Scenario: Fallo local y recuperación
- **WHEN** el SRI respondió `AUTORIZADO` para una nota, la respuesta quedó guardada y la operación local falló después de registrar la devolución y antes de confirmarse
- **THEN** la nota sigue sin autorizar localmente y no queda ninguna devolución
- **AND** al reintentarse, el sistema clasifica la respuesta guardada sin volver a llamar al SRI, la nota queda autorizada y existe una sola devolución por producto
