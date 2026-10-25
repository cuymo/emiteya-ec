## MODIFIED Requirements

### Requirement: Configuración en pestañas
Las secciones de Configuración SHALL presentarse en una sola página con pestañas, en este orden:
Usuarios, Empresa, Establecimientos, Firma electrónica, Correos, Catálogos fiscales, Ambiente y
Portabilidad de datos, solo las que el rol ve. La dirección de la antigua pestaña Secuenciales SHALL llevar a
Establecimientos. Cada pestaña SHALL ser un enlace a la dirección de su
sección, que conserva su enlace directo, su permiso y su título, y la sección abierta SHALL
anunciarse como página actual. La dirección `/configuracion` SHALL llevar a la primera pestaña que
el rol ve. Con espacio, las pestañas SHALL ir en una columna vertical a la izquierda del panel, como
una barra lateral, con la actual sobre un fondo azul suave (decisión del propietario, 2026-10-23).
En una pantalla estrecha, las pestañas SHALL ir en una fila encima del panel y desplazarse a lo ancho
sin desplazar la página, con la actual a la vista.

#### Scenario: Administrador
- **WHEN** un administrador abre Usuarios
- **THEN** ve las ocho pestañas en ese orden, con Usuarios marcada como página actual

#### Scenario: Pestañas verticales en escritorio
- **WHEN** un administrador abre Empresa en una pantalla de escritorio
- **THEN** las pestañas van en una columna a la izquierda, como una barra lateral, y Empresa se ve a su derecha

#### Scenario: Operador
- **WHEN** un operador abre Configuración
- **THEN** llega a Catálogos fiscales, la única pestaña que ve

#### Scenario: Enlace directo
- **WHEN** un administrador abre la dirección de Firma electrónica
- **THEN** ve la pestaña Firma electrónica abierta, con las demás pestañas para cambiar de sección

#### Scenario: Correos
- **WHEN** un administrador abre la dirección de Correos
- **THEN** ve la pestaña Correos abierta, después de Firma electrónica
