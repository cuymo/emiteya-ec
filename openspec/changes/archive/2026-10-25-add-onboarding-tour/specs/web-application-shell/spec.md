## ADDED Requirements

### Requirement: Recorrido de bienvenida
La primera vez que un usuario llega a Inicio en un navegador, el shell SHALL abrir un recorrido guiado por el tablero de Inicio, la Configuración de la empresa y la emisión de la primera factura. El recorrido SHALL cambiar de pantalla solo, mostrar solo los pasos que el rol puede usar y cuyo elemento está a la vista, y nunca cambiar datos. Al terminarlo o cerrarlo, el navegador SHALL recordarlo para ese usuario. El menú de la cuenta SHALL permitir repetirlo.

#### Scenario: Primer ingreso de un administrador
- **WHEN** un administrador entra por primera vez en ese navegador y llega a Inicio
- **THEN** el recorrido se abre con la bienvenida, señala los indicadores y el estado de facturación electrónica, lleva a Configuración y recorre sus pestañas, y termina en el editor de facturas señalando el comprador, los productos y «Emitir factura»
- **AND** no se guarda ningún borrador ni se emite ningún comprobante

#### Scenario: Operador
- **WHEN** un operador entra por primera vez y llega a Inicio
- **THEN** el recorrido muestra Inicio y la primera factura, sin el tramo de Configuración

#### Scenario: Ya visto
- **WHEN** un usuario que terminó o cerró el recorrido vuelve a Inicio en el mismo navegador
- **THEN** el recorrido no se abre solo

#### Scenario: Repetir el recorrido
- **WHEN** un usuario elige «Ver recorrido» en el menú de la cuenta
- **THEN** el recorrido empieza otra vez desde la bienvenida

#### Scenario: Paso sin elemento a la vista
- **WHEN** la empresa ya puede emitir, o el usuario usa un teléfono con la barra lateral cerrada
- **THEN** el recorrido omite los requisitos pendientes o el acceso de la barra, sin quedarse detenido

#### Scenario: Enlace directo
- **WHEN** un usuario que todavía no vio el recorrido abre directamente una factura
- **THEN** el recorrido no se abre hasta que llega a Inicio
