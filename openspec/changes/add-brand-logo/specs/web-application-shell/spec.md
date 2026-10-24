## MODIFIED Requirements

### Requirement: Nombre visible del producto
La interfaz SHALL identificar el producto como EmiteYa: en el shell, en el inicio de sesión y en el
título de cada pantalla. El logo oficial de EmiteYa SHALL acompañar al nombre en la cabecera de la
barra lateral y en el inicio de sesión, con «EmiteYa» como texto alternativo, y SHALL ser el icono
de la web en el navegador. «Facturador SRI» no SHALL aparecer como nombre del producto en la
interfaz.

#### Scenario: Título de una pantalla
- **WHEN** un usuario abre la pantalla de productos
- **THEN** el título del documento del navegador es «Productos · EmiteYa»

#### Scenario: Marca en el shell y en el inicio de sesión
- **WHEN** una persona abre el inicio de sesión, inicia sesión y llega a Inicio
- **THEN** ve el logo y el nombre EmiteYa en el inicio de sesión y en el shell, y en ningún momento ve «Facturador SRI» como nombre del producto

#### Scenario: Icono del navegador
- **WHEN** una persona abre cualquier pantalla de EmiteYa
- **THEN** la pestaña del navegador muestra el logo de EmiteYa como icono

#### Scenario: Barra lateral contraída
- **WHEN** un usuario contrae la barra lateral en escritorio
- **THEN** la cabecera de la barra conserva el logo, con EmiteYa como su nombre accesible, y sigue llevando a Inicio

### Requirement: Creación rápida
El shell SHALL ofrecer en todas las pantallas autenticadas una creación rápida, en la paleta de
comandos, con las acciones de creación que el rol permite: factura, nota de crédito, nota de débito,
retención, guía de remisión y liquidación de compra. La barra lateral no SHALL llevar un botón de
creación. Elegir «Nueva factura» SHALL llevar a la pantalla de nueva factura; elegir cualquiera de
las demás SHALL llevar a la lista de ese comprobante con su creación abierta. Nunca SHALL crear un
borrador, reservar un número ni emitir por sí misma.

#### Scenario: Nueva factura desde la creación rápida
- **WHEN** un operador abre la paleta de comandos y elige «Nueva factura»
- **THEN** llega a la pantalla de nueva factura, igual que desde la lista de facturas
- **AND** la navegación marca Facturas, en Ventas, como destino actual

#### Scenario: Nueva guía de remisión desde la creación rápida
- **WHEN** un operador abre la paleta de comandos y elige «Nueva guía de remisión»
- **THEN** llega a la lista de guías de remisión con la confirmación para preparar el borrador abierta, y ningún borrador se crea hasta que la confirma

#### Scenario: Abrir sin elegir
- **WHEN** un usuario abre la paleta de comandos y la cierra sin elegir una acción
- **THEN** no se crea ningún borrador ni comprobante y la pantalla actual no cambia

#### Scenario: Acción no permitida
- **WHEN** el rol del usuario no permite crear borradores de un tipo de comprobante
- **THEN** esa acción no aparece en la paleta de comandos

#### Scenario: Teclado
- **WHEN** un usuario abre la paleta de comandos con Ctrl+K o ⌘+K
- **THEN** puede recorrer las acciones de creación con las flechas, elegir una con Enter y cerrar la paleta con Escape, y el foco vuelve a donde estaba

#### Scenario: Sin botón en la barra lateral
- **WHEN** un usuario abre cualquier pantalla autenticada
- **THEN** la cabecera de la barra lateral muestra el logo y el nombre EmiteYa, sin un botón «Nuevo»
