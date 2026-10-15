# Spec Delta

## ADDED Requirements

### Requirement: Barra superior estable
La barra superior SHALL ocupar una sola línea a todas las anchuras soportadas, en la barra lateral
expandida o colapsada, sin que ningún texto o control se parta en varias líneas, se salga de la
barra ni se monte sobre otro. SHALL reunir solo el contexto global: el botón de navegación, el
contexto de la empresa, el acceso a la paleta de comandos, el ambiente fiscal y el menú de cuenta.
No SHALL mostrar la jerarquía de la pantalla abierta, como migas o títulos.

#### Scenario: Pantalla interna en una tableta
- **WHEN** un administrador abre Empresa, dentro de Configuración, en una ventana de 768 px de ancho
- **THEN** la barra superior muestra en una sola línea, sin solaparse, el contexto de la empresa, el acceso a la paleta, el ambiente y la cuenta
- **AND** la barra no muestra las migas de la pantalla

#### Scenario: Editor en un portátil
- **WHEN** un operador abre la pantalla de nueva factura en una ventana de 1024 o 1280 px, con la barra lateral expandida o colapsada
- **THEN** ningún elemento de la barra superior ocupa más de una línea

#### Scenario: Teléfono
- **WHEN** un usuario abre cualquier pantalla autenticada en un teléfono
- **THEN** la barra superior muestra en una sola línea el botón de navegación, el contexto de la empresa, el acceso a la paleta, el ambiente y la cuenta

### Requirement: Jerarquía de acciones de la pantalla
Cada pantalla SHALL presentar como mucho una acción principal destacada a la vez. Una acción que en
ese momento no puede ejecutarse SHALL percibirse como no disponible, sin el aspecto de la acción
principal, y su motivo SHALL estar escrito junto a ella. Cuando el encabezado de la pantalla ya
ofrece la acción principal, el estado vacío SHALL ofrecer la misma acción solo como secundaria. Las
opciones elegidas en vistas, filtros y controles segmentados SHALL distinguirse sin usar la
presentación de la acción principal, y nunca solo por el color.

#### Scenario: Acción no disponible
- **WHEN** un operador ve la acción de cambiar a Producción mientras la empresa aún no puede emitir
- **THEN** la acción se percibe como no disponible, no con el aspecto de la acción principal, y el motivo está escrito junto a ella

#### Scenario: Lista vacía con acción en el encabezado
- **WHEN** un operador abre la lista de notas de crédito de una empresa que aún no tiene ninguna
- **THEN** «Nueva nota de crédito» es la acción principal del encabezado, y el estado vacío la ofrece como acción secundaria

#### Scenario: Filtro elegido
- **WHEN** un operador elige el filtro «Activos» en la lista de productos
- **THEN** el filtro se ve elegido por su forma y su texto, sin competir con la acción principal «Nuevo producto»

## MODIFIED Requirements

### Requirement: Shell autenticado disponible
Toda pantalla autenticada SHALL mostrarse dentro del shell: navegación, barra superior con el
contexto de la empresa y el indicador del ambiente, avisos persistentes de condiciones que lo
requieran, como el vencimiento de la firma, y el área de contenido de la pantalla. Mientras se
verifica la sesión, el shell SHALL mostrar su estructura y anunciar la verificación, nunca una
pantalla en blanco. Sin sesión, SHALL llevar al inicio de sesión conservando el destino pedido.

#### Scenario: Pantalla autenticada
- **WHEN** un operador con sesión abre la pantalla de facturas
- **THEN** ve la navegación, la barra superior y el contenido de facturas dentro del shell

#### Scenario: Verificación de la sesión
- **WHEN** un usuario abre una pantalla autenticada y su sesión todavía se está verificando
- **THEN** ve la estructura del shell y un estado anunciado de verificación de la sesión, no una pantalla en blanco

#### Scenario: Sin sesión
- **WHEN** una persona sin sesión abre la pantalla de comprobantes
- **THEN** llega al inicio de sesión, y al iniciar sesión vuelve a la pantalla de comprobantes

#### Scenario: Aviso de la firma dentro del shell
- **WHEN** la firma electrónica de la empresa está por vencer en una empresa en Pruebas
- **THEN** el shell muestra el aviso de vencimiento de la firma y, en la barra superior, el indicador «Pruebas», sin ocultar ninguno de los dos

### Requirement: Ambiente fiscal visible en el shell
El shell SHALL mostrar el ambiente fiscal vigente en todas las pantallas autenticadas y en todos sus
estados (barra expandida o colapsada, panel móvil), con un indicador compacto en la barra superior
que siga visible al desplazar el contenido, nunca solo color o icono. En Pruebas, el indicador SHALL
ser el aviso persistente del ambiente: SHALL decir «Pruebas» con un icono de advertencia, no SHALL
poder cerrarse, su nombre accesible SHALL decir que los comprobantes no tienen validez tributaria, y
SHALL explicarlo al enfocarlo, señalarlo o tocarlo. El shell no SHALL mostrar además un aviso de
ancho completo por el ambiente. Producción SHALL presentarse como contexto y no como resultado de
una validación: su indicador no SHALL comunicar que todo está correcto. Si el ambiente no puede
confirmarse, el indicador SHALL decir que no está confirmado y no SHALL presentarse como Producción.

#### Scenario: Pruebas con la barra colapsada
- **WHEN** un operador de una empresa en Pruebas colapsa la barra lateral y navega a otra pantalla
- **THEN** sigue viendo en la barra superior el indicador «Pruebas» con su icono de advertencia, y no puede cerrarlo
- **AND** el nombre accesible del indicador dice que los comprobantes no tienen validez tributaria

#### Scenario: Pruebas en móvil
- **WHEN** un operador de una empresa en Pruebas abre y cierra la navegación en un teléfono
- **THEN** la barra superior sigue mostrando el texto «Pruebas»
- **AND** al tocar el indicador lee que los comprobantes no tienen validez tributaria

#### Scenario: Sin aviso de ancho completo
- **WHEN** un operador navega por una empresa en Pruebas
- **THEN** no ve una franja de ancho completo por el ambiente, y el indicador de la barra superior sigue diciendo «Pruebas»

#### Scenario: Producción sin depender del color
- **WHEN** un usuario navega por una empresa en Producción, en escritorio o en móvil
- **THEN** ve un indicador con el texto «Producción» y un icono

#### Scenario: Ambiente visible al desplazar en un teléfono
- **WHEN** un usuario de una empresa en Producción o en Pruebas desplaza el contenido de una pantalla larga en un teléfono
- **THEN** la barra superior sigue mostrando el texto del ambiente vigente

#### Scenario: Producción no es un resultado
- **WHEN** un usuario navega por una empresa en Producción
- **THEN** el indicador de Producción no usa la presentación de éxito ni de validación correcta, porque el ambiente es contexto y no se comprueba ninguna conexión con el SRI

#### Scenario: Ambiente desconocido
- **WHEN** el ambiente de la empresa no puede confirmarse
- **THEN** el indicador de la barra superior dice que el ambiente no está confirmado, con un icono de advertencia, y no muestra «Producción»

### Requirement: Carga de una pantalla
Mientras una pantalla autenticada carga, el shell SHALL seguir visible y usable: navegación,
contexto de la empresa y ambiente. El área de contenido SHALL mostrar un estado de carga anunciado a
las tecnologías de asistencia, nunca un área en blanco.

#### Scenario: Navegación lenta
- **WHEN** un usuario navega a una pantalla que tarda en cargar
- **THEN** ve el estado de carga en el área de contenido, y la navegación y el indicador del ambiente siguen visibles

### Requirement: Contexto de la empresa visible
El shell SHALL mostrar en todas las pantallas autenticadas el nombre de la empresa de la sesión: su
nombre comercial o, si no tiene, su razón social. Es solo lectura: el shell no SHALL ofrecer ningún
control para cambiar de empresa. Si el nombre no puede obtenerse, el shell SHALL indicarlo sin
mostrar un nombre supuesto. Un nombre que no cabe SHALL recortarse sin desplazar a los demás
controles de la barra superior, y el nombre completo SHALL seguir disponible para las tecnologías de
asistencia y al señalarlo.

#### Scenario: Empresa con nombre comercial
- **WHEN** un operador navega por una empresa con nombre comercial registrado
- **THEN** ve ese nombre comercial en la barra superior en cualquier pantalla, también en móvil

#### Scenario: Empresa sin nombre comercial
- **WHEN** la empresa no tiene nombre comercial registrado
- **THEN** el shell muestra su razón social

#### Scenario: Nombre largo
- **WHEN** la empresa tiene un nombre comercial más largo que el espacio de la barra superior
- **THEN** el nombre se recorta en una sola línea sin desplazar el acceso a la paleta, el ambiente ni la cuenta
- **AND** el nombre completo se anuncia a las tecnologías de asistencia y se muestra al señalarlo

#### Scenario: Sin selector de empresas
- **WHEN** un administrador activa el contexto de la empresa
- **THEN** no se abre ningún selector, lista ni acción para cambiar de empresa

#### Scenario: Contexto no disponible
- **WHEN** el contexto de la empresa no puede obtenerse
- **THEN** el shell indica que no pudo confirmar la empresa y no muestra ningún nombre de empresa

#### Scenario: Otra empresa no visible
- **WHEN** un usuario de una empresa navega por el shell
- **THEN** solo ve el nombre de su empresa, y el shell no revela el nombre ni la existencia de ninguna otra empresa de la instalación

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
- **WHEN** un operador abre un borrador de factura desde Borradores de facturas
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

### Requirement: Migas de navegación
Las pantallas internas SHALL mostrar una sola fila de migas que aporten jerarquía, derivadas de la
misma navegación, encima del título de la pantalla y nunca en la barra superior, y nunca una miga que solo repita el
título de la página. Los grupos operativos no son una miga. Configuración sí, porque agrupa
secciones. En una pantalla interna, el destino SHALL ser un enlace, y la última miga SHALL anunciarse
como página actual. Las migas SHALL ser el único mecanismo de orientación de la pantalla: no SHALL
acompañarse de un enlace de vuelta que repita una miga.

#### Scenario: Pantalla interna
- **WHEN** un usuario abre el detalle de la factura 001-001-000000123
- **THEN** ve encima del título la ruta Facturas › 001-001-000000123, con Facturas como enlace a la lista y el número anunciado como página actual
- **AND** mientras el número todavía no se conoce, la última miga es «Detalle de factura»

#### Scenario: Borrador
- **WHEN** un usuario abre un borrador de nota de crédito
- **THEN** ve la ruta Notas de crédito › Borrador de nota de crédito, con Notas de crédito como enlace

#### Scenario: Nueva factura
- **WHEN** un usuario abre la pantalla de nueva factura
- **THEN** ve la ruta Facturas › Nueva factura, con Facturas como enlace

#### Scenario: Borrador de factura
- **WHEN** un usuario abre un borrador de factura guardado
- **THEN** ve la ruta Facturas › Borrador de factura, con Facturas como enlace

#### Scenario: Una sola orientación
- **WHEN** un usuario abre el editor de un borrador o el detalle de un comprobante
- **THEN** la pantalla ofrece la vuelta al destino solo a través de las migas, sin un enlace de vuelta aparte

#### Scenario: Sin migas duplicadas
- **WHEN** un operador abre el editor de una factura o una pantalla interna heredada
- **THEN** ve una sola fila de migas, encima del título, y ningún otro elemento de la pantalla repite esa orientación

#### Scenario: Migas a cualquier anchura
- **WHEN** un usuario abre una pantalla interna en escritorio, en una tableta o en un teléfono
- **THEN** ve las migas en el mismo lugar, encima del título, y la barra superior no las muestra

#### Scenario: Destino de primer nivel sin miga redundante
- **WHEN** un usuario abre la lista de facturas o la de productos
- **THEN** la pantalla no muestra migas, porque solo repetirían el título de la página

#### Scenario: Sección de configuración
- **WHEN** un administrador abre Empresa o Secuenciales
- **THEN** ve la ruta Configuración › Empresa o Configuración › Secuenciales, con la sección anunciada como página actual

#### Scenario: Inicio
- **WHEN** un usuario abre Inicio
- **THEN** la pantalla no muestra migas

#### Scenario: Mismos nombres
- **WHEN** un usuario abre una pantalla interna de inventario
- **THEN** el destino de las migas, el destino actual de la navegación y el destino que ofrece la paleta de comandos se llaman igual, Inventario

### Requirement: Creación rápida
El shell SHALL ofrecer en todas las pantallas autenticadas una creación rápida con las pantallas de
creación existentes que el rol permite: factura, nota de crédito, nota de débito, retención, guía de
remisión y liquidación de compra. Elegir una acción SHALL llevar a esa pantalla. Nunca SHALL crear un
borrador, reservar un número ni emitir por sí misma.

#### Scenario: Nueva factura desde la creación rápida
- **WHEN** un operador elige «Nueva factura» en la creación rápida
- **THEN** llega a la pantalla de nueva factura, igual que desde la lista de facturas
- **AND** la navegación marca Facturas, en Ventas, como destino actual

#### Scenario: Abrir sin elegir
- **WHEN** un usuario abre la creación rápida y la cierra sin elegir una acción
- **THEN** no se crea ningún borrador ni comprobante y la pantalla actual no cambia

#### Scenario: Acción no permitida
- **WHEN** el rol del usuario no permite crear borradores de un tipo de comprobante
- **THEN** esa acción no aparece en la creación rápida ni en la paleta de comandos

#### Scenario: Teclado
- **WHEN** un usuario abre la creación rápida con el teclado
- **THEN** puede recorrer las acciones con las flechas, elegir una con Enter y cerrar el menú con Escape, y el foco vuelve al control que lo abrió

### Requirement: Tema accesible
El shell SHALL permitir elegir el tema Claro, Oscuro o Sistema con un grupo de opciones accesible
llamado «Tema», que se recorre con las flechas, dentro del menú de cuenta a todas las anchuras. La
elección SHALL recordarse y, sin elección, SHALL seguirse la preferencia del sistema. La barra
superior no SHALL mostrar un control de tema, y a ningún ancho SHALL haber dos controles de tema.

#### Scenario: Cambiar el tema
- **WHEN** un usuario abre el menú de cuenta, elige Oscuro en el grupo «Tema» y recarga la pantalla
- **THEN** la interfaz sigue en tema oscuro

#### Scenario: Teclado
- **WHEN** un usuario enfoca el grupo «Tema» del menú de cuenta y pulsa la flecha derecha
- **THEN** se selecciona la opción siguiente y la interfaz cambia de tema

#### Scenario: Pantalla estrecha
- **WHEN** un usuario abre el menú de cuenta en un teléfono, o en escritorio
- **THEN** encuentra las opciones de tema Claro, Oscuro y Sistema, con la vigente marcada

#### Scenario: Un solo control por ancho
- **WHEN** un usuario usa la aplicación en escritorio y luego en un teléfono
- **THEN** en ninguno de los dos hay un control de tema en la barra superior, y el del menú de cuenta cambia el mismo tema
