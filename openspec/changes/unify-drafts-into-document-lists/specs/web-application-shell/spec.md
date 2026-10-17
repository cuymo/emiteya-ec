## MODIFIED Requirements

### Requirement: Navegación según permisos
La navegación SHALL agrupar los destinos en Inicio, Ventas, Compras, Logística, Documentos,
Maestros, Análisis y Configuración, en ese orden y con dos niveles como máximo. SHALL mostrar solo
los destinos que el rol del usuario puede usar, con la misma regla de permisos que aplica la
aplicación. La API sigue autorizando cada operación. Un grupo sin destinos visibles no SHALL
mostrarse. Los borradores no SHALL tener un destino propio: cada lista de comprobantes los muestra
y los filtra.

#### Scenario: Administrador
- **WHEN** un administrador abre la navegación
- **THEN** ve:
  - Inicio;
  - Ventas: Facturas, Notas de crédito, Notas de débito;
  - Compras: Liquidaciones de compra, Retenciones;
  - Logística: Guías de remisión, Inventario;
  - Documentos: Archivo de comprobantes;
  - Maestros: Terceros, Productos;
  - Análisis: Reportes;
  - Configuración: Usuarios, Empresa, Establecimientos, Firma electrónica, Catálogos fiscales, Ambiente, Portabilidad de datos. Los secuenciales se consultan y ajustan en Establecimientos, en cada punto de emisión.

#### Scenario: Operador
- **WHEN** un operador abre la navegación
- **THEN** ve los mismos grupos que el administrador hasta Análisis, y en Configuración solo Catálogos fiscales

#### Scenario: Borradores de facturas y archivo de comprobantes
- **WHEN** un usuario busca dónde continuar una factura sin emitir y dónde consultar comprobantes de cualquier tipo
- **THEN** encuentra la factura sin emitir en Facturas, con el estado «Borrador», y Archivo de comprobantes en Documentos, que reúne los comprobantes de todos los tipos
- **AND** la antigua dirección de los borradores de factura lleva a Facturas con el filtro «Borradores»

#### Scenario: Navegación no es autorización
- **WHEN** un operador solicita a la API una operación de un destino que su navegación no muestra
- **THEN** la API la sigue rechazando como antes

### Requirement: Destino actual
La navegación SHALL marcar como actual exactamente un destino: el de la pantalla abierta, también
cuando es una pantalla interna de ese destino, como un detalle o un editor. La pantalla de nueva
factura y el editor de un borrador de factura SHALL pertenecer a Facturas. La marca SHALL ser
perceptible sin depender solo del color y SHALL anunciarse a las tecnologías de asistencia, con la
barra expandida, colapsada o en el panel móvil.

#### Scenario: Pantalla de un destino
- **WHEN** un usuario abre la lista de retenciones
- **THEN** Retenciones figura como destino actual y ningún otro destino lo hace

#### Scenario: Pantalla interna
- **WHEN** un usuario abre el detalle de una factura o el editor de un borrador de nota de crédito
- **THEN** figuran como actuales Facturas o Notas de crédito, respectivamente

#### Scenario: Editor de factura
- **WHEN** un operador abre la pantalla de nueva factura, guarda el borrador por primera vez y sigue editándolo
- **THEN** Facturas figura como destino actual en todo momento, también después del primer guardado

#### Scenario: Borrador abierto desde su lista
- **WHEN** un operador abre un borrador de factura desde la lista de Facturas
- **THEN** Facturas figura como destino actual del editor

#### Scenario: Barra colapsada
- **WHEN** la barra lateral está colapsada a iconos
- **THEN** el destino actual sigue marcado y anunciado como actual

#### Scenario: Destino actual a la vista al cargar
- **WHEN** un administrador abre directamente la pantalla de Portabilidad de datos en una ventana baja, cuyo destino queda fuera del área visible de la barra
- **THEN** la barra se desplaza lo justo para mostrar entero el destino actual, sin desplazar la página

#### Scenario: Destino actual ya visible
- **WHEN** un usuario navega a un destino que ya se ve entero en la barra
- **THEN** la barra no cambia su desplazamiento
