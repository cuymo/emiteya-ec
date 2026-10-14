# Spec Delta

## Purpose

Define el shell autenticado de la interfaz web de EmiteYa: cómo se orienta el usuario, qué contexto
de empresa y de ambiente fiscal ve siempre, cómo llega a cada destino que su rol permite y qué ve
mientras una pantalla carga, falla, no existe o no le está permitida.

## ADDED Requirements

### Requirement: Shell autenticado disponible
Toda pantalla autenticada SHALL mostrarse dentro del shell: navegación, barra superior con el
contexto de la empresa y el ambiente, avisos persistentes y el área de contenido de la pantalla.
Mientras se verifica la sesión, el shell SHALL mostrar su estructura y anunciar la verificación,
nunca una pantalla en blanco. Sin sesión, SHALL llevar al inicio de sesión conservando el destino
pedido.

#### Scenario: Pantalla autenticada
- **WHEN** un operador con sesión abre la pantalla de facturas
- **THEN** ve la navegación, la barra superior y el contenido de facturas dentro del shell
- **AND** el contenido de la pantalla es el mismo que antes del shell nuevo

#### Scenario: Verificación de la sesión
- **WHEN** un usuario abre una pantalla autenticada y su sesión todavía se está verificando
- **THEN** ve la estructura del shell y un estado anunciado de verificación de la sesión, no una pantalla en blanco

#### Scenario: Sin sesión
- **WHEN** una persona sin sesión abre la pantalla de comprobantes
- **THEN** llega al inicio de sesión, y al iniciar sesión vuelve a la pantalla de comprobantes

#### Scenario: Aviso de la firma dentro del shell
- **WHEN** la firma electrónica de la empresa está por vencer
- **THEN** el shell sigue mostrando el aviso de vencimiento de la firma junto al aviso de ambiente, sin ocultar ninguno de los dos

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
mostrar un nombre supuesto.

#### Scenario: Empresa con nombre comercial
- **WHEN** un operador navega por una empresa con nombre comercial registrado
- **THEN** ve ese nombre comercial en la barra superior en cualquier pantalla, también en móvil

#### Scenario: Empresa sin nombre comercial
- **WHEN** la empresa no tiene nombre comercial registrado
- **THEN** el shell muestra su razón social

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
estados (barra expandida o colapsada, panel móvil). En Pruebas, el aviso persistente que no puede
cerrarse; en Producción, un indicador con texto e icono, nunca solo con color. Si el ambiente no
puede confirmarse, no SHALL presentarse como Producción.

#### Scenario: Pruebas con la barra colapsada
- **WHEN** un operador de una empresa en Pruebas colapsa la barra lateral y navega a otra pantalla
- **THEN** sigue viendo el aviso de Pruebas, que indica que los comprobantes no tienen validez tributaria, y no puede cerrarlo

#### Scenario: Pruebas en móvil
- **WHEN** un operador de una empresa en Pruebas abre y cierra la navegación en un teléfono
- **THEN** el aviso de Pruebas sigue visible al cerrarla

#### Scenario: Producción sin depender del color
- **WHEN** un usuario navega por una empresa en Producción, en escritorio o en móvil
- **THEN** ve un indicador con el texto «Producción» y un icono

#### Scenario: Ambiente desconocido
- **WHEN** el ambiente de la empresa no puede confirmarse
- **THEN** el shell advierte que no pudo confirmar si los comprobantes tienen validez tributaria y no muestra el indicador de Producción

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
  - Ventas: Facturas, Notas de crédito, Notas de débito;
  - Compras: Liquidaciones de compra, Retenciones;
  - Logística: Guías de remisión, Inventario;
  - Documentos: Comprobantes, Borradores;
  - Maestros: Terceros, Productos;
  - Análisis: Reportes;
  - Configuración: Empresa, Ambiente, Establecimientos, Secuenciales, Firma electrónica, Catálogos fiscales, Usuarios, Portabilidad de datos.

#### Scenario: Operador
- **WHEN** un operador abre la navegación
- **THEN** ve los mismos grupos que el administrador hasta Análisis, y en Configuración solo Catálogos fiscales

#### Scenario: Navegación no es autorización
- **WHEN** un operador solicita a la API una operación de un destino que su navegación no muestra
- **THEN** la API la sigue rechazando como antes

### Requirement: Destino actual
La navegación SHALL marcar como actual exactamente un destino: el de la pantalla abierta, también
cuando es una pantalla interna de ese destino, como un detalle o un editor. La marca SHALL ser
perceptible sin depender solo del color y SHALL anunciarse a las tecnologías de asistencia, con la
barra expandida, colapsada o en el panel móvil.

#### Scenario: Pantalla de un destino
- **WHEN** un usuario abre la lista de retenciones
- **THEN** Retenciones figura como destino actual y ningún otro destino lo hace

#### Scenario: Pantalla interna
- **WHEN** un usuario abre el detalle de una factura o el editor de un borrador de nota de crédito
- **THEN** figuran como actuales Facturas o Notas de crédito, respectivamente

#### Scenario: Barra colapsada
- **WHEN** la barra lateral está colapsada a iconos
- **THEN** el destino actual sigue marcado y anunciado como actual

### Requirement: Navegación adaptable
En escritorio y tableta, la barra lateral SHALL poder colapsarse a iconos y volver a expandirse, y
el navegador SHALL recordar la elección al recargar. Colapsada, cada destino SHALL conservar su
nombre accesible y mostrarlo como ayuda al enfocarlo o señalarlo. En móvil, la misma navegación
SHALL abrirse en un panel lateral desde un botón de menú.

#### Scenario: Colapsar y recargar
- **WHEN** un usuario colapsa la barra lateral y recarga la pantalla
- **THEN** la barra sigue colapsada

#### Scenario: Destino colapsado accesible
- **WHEN** la barra está colapsada y un usuario enfoca con el teclado el icono de Facturas
- **THEN** el destino se anuncia como «Facturas» y se muestra su nombre como ayuda

#### Scenario: Panel móvil
- **WHEN** un usuario en un teléfono abre el menú, elige un destino o pulsa Escape, toca fuera del panel o pulsa el botón de cerrar
- **THEN** el panel se cierra y el foco vuelve al botón de menú

#### Scenario: Mismos destinos en el panel móvil
- **WHEN** un operador abre el panel de navegación en móvil
- **THEN** ve los mismos destinos que en la barra lateral de escritorio, ni uno más

### Requirement: Migas de navegación
El shell SHALL mostrar migas que aporten jerarquía, derivadas de la misma navegación, y nunca una
miga que solo repita el título de la página. Los grupos operativos no son una miga. Configuración
sí, porque agrupa secciones. En una pantalla interna, el destino SHALL ser un enlace, y la última
miga SHALL anunciarse como página actual.

#### Scenario: Pantalla interna
- **WHEN** un usuario abre el detalle de la factura 001-001-000000123
- **THEN** ve la ruta Facturas › 001-001-000000123, con Facturas como enlace a la lista y el número anunciado como página actual
- **AND** mientras el número todavía no se conoce, la última miga es «Detalle de factura»

#### Scenario: Borrador
- **WHEN** un usuario abre un borrador de nota de crédito
- **THEN** ve la ruta Notas de crédito › Borrador de nota de crédito, con Notas de crédito como enlace

#### Scenario: Destino de primer nivel sin miga redundante
- **WHEN** un usuario abre la lista de facturas o la de productos
- **THEN** el shell no muestra migas, porque solo repetirían el título de la página

#### Scenario: Sección de configuración
- **WHEN** un administrador abre Empresa o Secuenciales
- **THEN** ve la ruta Configuración › Empresa o Configuración › Secuenciales, con la sección anunciada como página actual

#### Scenario: Inicio
- **WHEN** un usuario abre Inicio
- **THEN** el shell no muestra migas

#### Scenario: Mismos nombres
- **WHEN** un usuario abre una pantalla interna de inventario
- **THEN** el destino de las migas, el destino actual de la navegación y el destino que ofrece la paleta de comandos se llaman igual, Inventario

### Requirement: Creación rápida
El shell SHALL ofrecer en todas las pantallas autenticadas una creación rápida con las pantallas de
creación existentes que el rol permite: factura, nota de crédito, nota de débito, retención, guía de
remisión y liquidación de compra. Elegir una acción SHALL llevar a esa pantalla. Nunca SHALL crear un
borrador, reservar un número ni emitir por sí misma.

#### Scenario: Nueva factura
- **WHEN** un operador elige «Nueva factura» en la creación rápida
- **THEN** llega a la pantalla de nueva factura, igual que desde la lista de facturas

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
acciones de creación rápida que el rol permite. Escribir SHALL filtrarlos sin distinguir mayúsculas
ni tildes. Elegir uno SHALL llevar a su pantalla. La paleta no SHALL consultar al servidor mientras
se escribe.

#### Scenario: Atajo y destino
- **WHEN** un operador pulsa Ctrl+K, escribe «credito» y elige Notas de crédito
- **THEN** llega a la lista de notas de crédito y la paleta se cierra

#### Scenario: Acción de creación
- **WHEN** un usuario abre la paleta y elige «Nueva guía de remisión»
- **THEN** llega a la pantalla de nueva guía de remisión sin que se cree nada

#### Scenario: Sin consultas al servidor
- **WHEN** un usuario escribe en la paleta
- **THEN** no se envía ninguna petición a la API por lo escrito

#### Scenario: Sin resultados
- **WHEN** lo escrito no coincide con ningún destino ni acción
- **THEN** la paleta dice que no hay resultados y no ofrece destinos ocultos para el rol

#### Scenario: Cerrar con Escape
- **WHEN** un usuario abre la paleta desde su control y pulsa Escape
- **THEN** la paleta se cierra y el foco vuelve al control que la abrió

#### Scenario: Destinos según el rol
- **WHEN** un operador busca «Usuarios» en la paleta
- **THEN** no aparece el destino Usuarios

### Requirement: Tema accesible
El shell SHALL permitir elegir el tema Claro, Oscuro o Sistema con un grupo de opciones accesible
llamado «Tema», que se recorre con las flechas. La elección SHALL recordarse y, sin elección, SHALL
seguirse la preferencia del sistema. En pantallas estrechas, el tema SHALL ofrecerse dentro del menú
de cuenta. A ningún ancho SHALL haber dos controles de tema visibles a la vez.

#### Scenario: Cambiar el tema
- **WHEN** un usuario elige Oscuro en el grupo «Tema» y recarga la pantalla
- **THEN** la interfaz sigue en tema oscuro

#### Scenario: Teclado
- **WHEN** un usuario enfoca el grupo «Tema» y pulsa la flecha derecha
- **THEN** se selecciona la opción siguiente y la interfaz cambia de tema

#### Scenario: Pantalla estrecha
- **WHEN** un usuario en un teléfono abre el menú de cuenta
- **THEN** encuentra las opciones de tema Claro, Oscuro y Sistema, con la vigente marcada

#### Scenario: Un solo control por ancho
- **WHEN** un usuario usa la aplicación en escritorio y luego en un teléfono
- **THEN** en escritorio el tema está solo en la barra superior y no en el menú de cuenta, y en el teléfono está solo en el menú de cuenta, y ambos cambian el mismo tema

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
- **THEN** ve el estado de carga en el área de contenido, y la navegación y el aviso de ambiente siguen visibles

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
