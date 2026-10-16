# web-application-shell Specification

## Purpose
Define el shell autenticado de la interfaz web de EmiteYa: cómo se orienta el usuario, qué contexto
de empresa y de ambiente fiscal ve siempre, cómo llega a cada destino que su rol permite y qué ve
mientras una pantalla carga, falla, no existe o no le está permitida.

## Requirements

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

### Requirement: Nombre visible del producto
La interfaz SHALL identificar el producto como EmiteYa: en el shell, en el inicio de sesión y en el
título de cada pantalla. «Facturador SRI» no SHALL aparecer como nombre del producto en la interfaz.

#### Scenario: Título de una pantalla
- **WHEN** un usuario abre la pantalla de productos
- **THEN** el título del documento del navegador es «Productos · EmiteYa»

#### Scenario: Marca en el shell y en el inicio de sesión
- **WHEN** una persona abre el inicio de sesión, inicia sesión y llega a Inicio
- **THEN** ve el nombre EmiteYa en el inicio de sesión y en el shell, y en ningún momento ve «Facturador SRI» como nombre del producto

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
- **THEN** el nombre se recorta en una sola línea sin desplazar el título, el acceso a la paleta, el ambiente ni la cuenta
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

### Requirement: Navegación según permisos
La navegación SHALL agrupar los destinos en Inicio, Ventas, Compras, Logística, Documentos,
Maestros, Análisis y Configuración, en ese orden y con dos niveles como máximo. SHALL mostrar solo
los destinos que el rol del usuario puede usar, con la misma regla de permisos que aplica la
aplicación. La API sigue autorizando cada operación. Un grupo sin destinos visibles no SHALL
mostrarse.

#### Scenario: Administrador
- **WHEN** un administrador abre la navegación
- **THEN** ve:
  - Inicio;
  - Ventas: Facturas, Borradores de facturas, Notas de crédito, Notas de débito;
  - Compras: Liquidaciones de compra, Retenciones;
  - Logística: Guías de remisión, Inventario;
  - Documentos: Archivo de comprobantes;
  - Maestros: Terceros, Productos;
  - Análisis: Reportes;
  - Configuración: Empresa, Ambiente, Establecimientos, Secuenciales, Firma electrónica, Catálogos fiscales, Usuarios, Portabilidad de datos.

#### Scenario: Operador
- **WHEN** un operador abre la navegación
- **THEN** ve los mismos grupos que el administrador hasta Análisis, y en Configuración solo Catálogos fiscales

#### Scenario: Borradores de facturas y archivo de comprobantes
- **WHEN** un usuario busca dónde continuar una factura sin emitir y dónde consultar comprobantes de cualquier tipo
- **THEN** encuentra Borradores de facturas en Ventas, que solo contiene borradores de factura, y Archivo de comprobantes en Documentos, que reúne los comprobantes de todos los tipos
- **AND** las direcciones de esas pantallas no cambian

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

### Requirement: Navegación adaptable
En escritorio y tableta, la barra lateral SHALL poder colapsarse a iconos y volver a expandirse, y
el navegador SHALL recordar la elección al recargar. Colapsada, cada destino SHALL conservar su
nombre accesible y mostrarlo como ayuda al enfocarlo o señalarlo. Expandida o colapsada, cada
destino SHALL responder al puntero en toda su zona visible, y la navegación SHALL desplazarse dentro
de la barra cuando la altura no alcanza, con rueda, panel táctil o teclado y sin desplazamiento
horizontal, de modo que cada destino permitido se alcance con el puntero. Configuración SHALL
empezar plegada fuera de sus pantallas y abierta en ellas. El usuario SHALL poder abrirla o
plegarla durante la sesión sin perder ningún destino ni permiso. En móvil, la misma navegación
SHALL abrirse en un panel lateral desde un botón de navegación reconocible como menú, con nombre
accesible.

#### Scenario: Colapsar y recargar
- **WHEN** un usuario colapsa la barra lateral y recarga la pantalla
- **THEN** la barra sigue colapsada

#### Scenario: Destino colapsado accesible
- **WHEN** la barra está colapsada y un usuario enfoca con el teclado el icono de Facturas
- **THEN** el destino se anuncia como «Facturas» y se muestra su nombre como ayuda

#### Scenario: Cada icono colapsado responde al clic
- **WHEN** la barra está colapsada y un usuario hace clic en el centro del icono de cualquier destino que su rol ve, incluido el último de cada grupo
- **THEN** llega a ese destino

#### Scenario: Ventana baja
- **WHEN** la altura de la ventana no alcanza para todos los destinos, con la barra expandida o colapsada
- **THEN** el usuario desplaza la navegación dentro de la barra con la rueda o el panel táctil y llega con el puntero a cualquier destino permitido, sin desplazamiento horizontal

#### Scenario: Configuración plegada fuera de sus pantallas
- **WHEN** un administrador abre Facturas
- **THEN** Configuración aparece plegada, anunciada como plegada, y sus destinos se muestran al abrirla

#### Scenario: Configuración abierta en sus pantallas
- **WHEN** un administrador abre directamente Usuarios, o navega a Empresa con Configuración plegada
- **THEN** Configuración aparece abierta, con el destino actual marcado

#### Scenario: Plegar Configuración a mano
- **WHEN** un administrador pliega Configuración en una de sus pantallas, o la abre en otra pantalla
- **THEN** Configuración queda como la dejó mientras navega en esa sesión de la interfaz

#### Scenario: Panel móvil
- **WHEN** un usuario en un teléfono abre el panel con el botón «Abrir navegación», elige un destino o pulsa Escape, toca fuera del panel o pulsa el botón de cerrar
- **THEN** el panel se cierra y el foco vuelve al botón de navegación

#### Scenario: Mismos destinos en el panel móvil
- **WHEN** un operador abre el panel de navegación en móvil
- **THEN** ve los mismos destinos que en la barra lateral de escritorio, ni uno más

### Requirement: Migas de navegación
Toda pantalla autenticada SHALL mostrar en la barra superior, a la izquierda, su título y, debajo,
una sola fila de migas derivadas de la misma navegación: un enlace a Inicio, el grupo de la
navegación como texto, el destino y la pantalla actual. En una pantalla interna, el destino SHALL
ser un enlace y la última miga SHALL ser la etiqueta del registro cuando la pantalla la conoce, o la
de la ruta. La pantalla actual SHALL anunciarse como página actual. El título de la barra no SHALL
ser un encabezado: el `h1` sigue siendo el de la pantalla. Las migas SHALL ser el único mecanismo de
orientación de la pantalla: no SHALL acompañarse de un enlace de vuelta que repita una miga. En un
teléfono, el título y las migas no SHALL mostrarse en la barra superior.

#### Scenario: Pantalla interna
- **WHEN** un usuario abre el detalle de la factura 001-001-000000123
- **THEN** ve en la barra superior el título «Detalle de factura» y la ruta Inicio / Ventas / Facturas / 001-001-000000123, con Facturas como enlace a la lista y el número anunciado como página actual
- **AND** mientras el número todavía no se conoce, la última miga es «Detalle de factura»

#### Scenario: Borrador
- **WHEN** un usuario abre un borrador de nota de crédito
- **THEN** ve la ruta Inicio / Ventas / Notas de crédito / Borrador de nota de crédito, con Notas de crédito como enlace

#### Scenario: Nueva factura
- **WHEN** un usuario abre la pantalla de nueva factura
- **THEN** ve el título «Nueva factura» y la ruta Inicio / Ventas / Facturas / Nueva factura, con Facturas como enlace

#### Scenario: Una sola orientación
- **WHEN** un usuario abre el editor de un borrador o el detalle de un comprobante
- **THEN** la pantalla ofrece la vuelta al destino solo a través de las migas, sin un enlace de vuelta aparte, y el contenido no repite las migas

#### Scenario: Destino de primer nivel
- **WHEN** un usuario abre la lista de facturas
- **THEN** ve el título «Facturas» y la ruta Inicio / Ventas / Facturas, con Facturas anunciada como página actual

#### Scenario: Sección de configuración
- **WHEN** un administrador abre Empresa
- **THEN** ve la ruta Inicio / Configuración / Empresa, con Empresa anunciada como página actual

#### Scenario: Teléfono
- **WHEN** un usuario abre cualquier pantalla autenticada en un teléfono
- **THEN** la barra superior no muestra el título ni las migas, y el `h1` de la pantalla la orienta

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

### Requirement: Paleta de comandos
El shell SHALL abrir, con Ctrl+K o ⌘+K y desde un control visible, una paleta con los destinos y las
acciones de creación rápida que el rol permite. El control y el campo de la paleta SHALL declarar
ese alcance («Buscar pantalla o acción»), visible y en su nombre accesible, y no SHALL presentarse
como búsqueda de comprobantes, terceros o productos. Escribir SHALL filtrar por el nombre del
destino o la acción y por sus sinónimos, sin distinguir mayúsculas ni tildes. Elegir uno SHALL
llevar a su pantalla. La paleta no SHALL consultar al servidor mientras se escribe, ni ofrecer
resultados de registros concretos.

#### Scenario: Atajo y destino
- **WHEN** un operador pulsa Ctrl+K, escribe «credito» y elige Notas de crédito
- **THEN** llega a la lista de notas de crédito y la paleta se cierra

#### Scenario: Alcance declarado
- **WHEN** un usuario ve el control de la paleta en la barra superior, en escritorio o en un teléfono
- **THEN** su texto visible o su nombre accesible es «Buscar pantalla o acción», y el campo de la paleta usa el mismo texto

#### Scenario: Sinónimos
- **WHEN** un operador escribe «clientes» o un administrador escribe «contraseña» o «IVA»
- **THEN** la paleta ofrece Terceros, Mi cuenta o Catálogos fiscales, respectivamente

#### Scenario: Acción de creación
- **WHEN** un usuario abre la paleta y elige «Nueva guía de remisión»
- **THEN** llega a la pantalla de nueva guía de remisión sin que se cree nada

#### Scenario: Sin consultas al servidor
- **WHEN** un usuario escribe en la paleta
- **THEN** no se envía ninguna petición a la API por lo escrito

#### Scenario: Sin resultados
- **WHEN** lo escrito no coincide con ningún destino ni acción, por ejemplo un número de comprobante o el nombre de un cliente
- **THEN** la paleta dice que no encontró una pantalla o acción con ese término, sin afirmar que el comprobante o el cliente no existen, y no ofrece destinos ocultos para el rol

#### Scenario: Cerrar con Escape
- **WHEN** un usuario abre la paleta desde su control y pulsa Escape
- **THEN** la paleta se cierra y el foco vuelve al control que la abrió

#### Scenario: Destinos según el rol
- **WHEN** un operador busca «Usuarios» en la paleta
- **THEN** no aparece el destino Usuarios

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

### Requirement: Menú de cuenta
El shell SHALL ofrecer un menú de cuenta, con nombre accesible «Cuenta de» seguido del nombre del
usuario, que muestre su nombre y su rol, lleve a Mi cuenta y permita cerrar sesión. Cerrar sesión
SHALL terminar la sesión y llevar al inicio de sesión.

#### Scenario: Contenido del menú
- **WHEN** un operador abre su menú de cuenta
- **THEN** ve su nombre, el rol Operador, la opción Mi cuenta y la opción Cerrar sesión

#### Scenario: Cerrar sesión
- **WHEN** un usuario elige Cerrar sesión
- **THEN** su sesión termina y llega al inicio de sesión

#### Scenario: Cierre repetido
- **WHEN** un usuario elige Cerrar sesión dos veces seguidas
- **THEN** la opción queda inactiva tras la primera y se produce un único cierre de sesión

### Requirement: Saltar al contenido
El primer elemento enfocable de cada pantalla autenticada SHALL ser un enlace «Saltar al contenido»
que se hace visible al enfocarlo y lleva el foco al contenido principal, sin recorrer la navegación.

#### Scenario: Primer Tab
- **WHEN** un usuario abre una pantalla autenticada, pulsa Tab y luego Enter
- **THEN** el enlace «Saltar al contenido» aparece al enfocarlo y el foco pasa al contenido principal

### Requirement: Carga de una pantalla
Mientras una pantalla autenticada carga, el shell SHALL seguir visible y usable: navegación,
contexto de la empresa y ambiente. El área de contenido SHALL mostrar un estado de carga anunciado a
las tecnologías de asistencia, nunca un área en blanco.

#### Scenario: Navegación lenta
- **WHEN** un usuario navega a una pantalla que tarda en cargar
- **THEN** ve el estado de carga en el área de contenido, y la navegación y el indicador del ambiente siguen visibles

### Requirement: Error inesperado en una pantalla
Si una pantalla autenticada falla de forma inesperada al mostrarse, el shell SHALL seguir visible y
el área de contenido SHALL mostrar un mensaje en español, sin detalles técnicos, trazas, JSON ni
identificadores internos, con una acción para intentarlo de nuevo.

#### Scenario: Fallo al mostrar
- **WHEN** una pantalla autenticada falla de forma inesperada al mostrarse
- **THEN** el usuario ve un mensaje comprensible y la acción «Intentar de nuevo», y puede seguir navegando a otros destinos

#### Scenario: Sin detalles técnicos
- **WHEN** el fallo trae un mensaje técnico
- **THEN** ese mensaje no se muestra al usuario

### Requirement: Dirección inexistente
Una dirección que no corresponde a ninguna pantalla SHALL mostrar que la página no existe, con el
nombre del producto y un enlace a Inicio, sin solicitar datos de la empresa. Las rutas de la API no
SHALL verse afectadas por esa página.

#### Scenario: Dirección inexistente
- **WHEN** un usuario abre una dirección que no existe en la aplicación
- **THEN** ve que la página no existe y un enlace a Inicio

#### Scenario: La API no cambia
- **WHEN** la interfaz llama a una ruta existente de la API después de este cambio
- **THEN** la respuesta es la de la API, no la página de dirección inexistente

### Requirement: Destino no permitido
Cuando un usuario abre la dirección de un destino que su rol no puede usar, el shell SHALL mostrar
dentro del área de contenido que no tiene acceso, con un enlace a Inicio, sin mostrar el contenido
del destino ni solicitar sus datos. Es solo presentación: la API sigue rechazando la operación.

#### Scenario: Operador en Usuarios
- **WHEN** un operador abre directamente la dirección de Usuarios
- **THEN** ve dentro del shell que no tiene acceso a esa sección y un enlace a Inicio
- **AND** no se solicita la lista de usuarios

#### Scenario: Sin destello del contenido
- **WHEN** un operador abre directamente la dirección de Secuenciales
- **THEN** en ningún momento se muestra el contenido de Secuenciales antes del estado sin acceso

#### Scenario: Destino permitido
- **WHEN** un operador abre directamente la dirección de Catálogos fiscales
- **THEN** ve la pantalla de catálogos fiscales como hasta ahora

### Requirement: Barra superior estable
La barra superior SHALL ocupar una sola línea a todas las anchuras soportadas, en la barra lateral
expandida o colapsada, sin que ningún texto o control se parta en varias líneas, se salga de la
barra ni se monte sobre otro. A la izquierda SHALL reunir el botón de navegación y, desde 768 px, el
título y las migas de la pantalla; a la derecha, el contexto global: el acceso a la paleta de
comandos, el ambiente fiscal, el contexto de la empresa y el menú de cuenta. No SHALL ofrecer
controles que el producto no respalda, como notificaciones o ayuda.

#### Scenario: Pantalla interna en una tableta
- **WHEN** un administrador abre Empresa, dentro de Configuración, en una ventana de 768 px de ancho
- **THEN** la barra superior muestra en una sola línea, sin solaparse, el título con sus migas, el acceso a la paleta, el ambiente, la empresa y la cuenta

#### Scenario: Editor en un portátil
- **WHEN** un operador abre la pantalla de nueva factura en una ventana de 1024 o 1280 px, con la barra lateral expandida o colapsada
- **THEN** ningún elemento de la barra superior ocupa más de una línea

#### Scenario: Teléfono
- **WHEN** un usuario abre cualquier pantalla autenticada en un teléfono
- **THEN** la barra superior muestra en una sola línea el botón de navegación, el acceso a la paleta, el ambiente, el contexto de la empresa y la cuenta

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
