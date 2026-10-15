# Spec Delta

## MODIFIED Requirements

### Requirement: Aviso persistente del ambiente
El sistema SHALL mostrar a todo usuario autenticado, en todas las pantallas, el ambiente vigente de
forma inequívoca en un indicador compacto de la barra superior. Mientras sea `Pruebas`, ese indicador
SHALL ser un aviso persistente que no puede cerrarse: dice «Pruebas» con un icono de advertencia, su
nombre accesible indica que los comprobantes no tienen validez tributaria, y lo explica al
enfocarlo, señalarlo o tocarlo. En `Producción`, SHALL mostrar un indicador visible de ese ambiente.
El aviso del ambiente no SHALL ocupar una franja de ancho completo.

#### Scenario: Operador en Pruebas
- **WHEN** un operador navega por cualquier pantalla de una empresa en `Pruebas`
- **THEN** ve en la barra superior el indicador «Pruebas» con su icono de advertencia y no puede cerrarlo
- **AND** al enfocarlo, señalarlo o tocarlo lee que los comprobantes no tienen validez tributaria

#### Scenario: Empresa en Producción
- **WHEN** un usuario navega por una empresa en `Producción`
- **THEN** no ve el indicador de Pruebas y ve el indicador de `Producción`

#### Scenario: Cambio de ambiente durante una sesión
- **WHEN** un administrador cambia el ambiente mientras otro usuario tiene una sesión abierta
- **THEN** ese usuario ve el ambiente nuevo a más tardar al recargar la pantalla, sin volver a iniciar sesión
