# Spec Delta

## Purpose

Bandeja de los comprobantes fiscales de la empresa y conservación de sus documentos: el RIDE
generado una vez desde el comprobante autorizado, las descargas verificadas del RIDE y de los XML,
la impresión del mismo RIDE y el historial de las entregas que el sistema puede observar.

## ADDED Requirements

### Requirement: Bandeja de comprobantes
El sistema SHALL listar en una bandeja los comprobantes fiscales de la empresa desde que se reservan, de cualquier tipo, con paginación y del más reciente al más antiguo. Los borradores nunca aparecen. Cada comprobante muestra su tipo, número, fecha de emisión, receptor, total y estado visible.

#### Scenario: Comprobantes en todos los estados
- **WHEN** la empresa tiene comprobantes reservados, firmados, en transmisión, autorizados, no autorizados, devueltos y en revisión manual
- **THEN** la bandeja los muestra todos con su estado visible

#### Scenario: Borradores fuera de la bandeja
- **WHEN** la empresa tiene borradores sin emitir
- **THEN** ninguno aparece en la bandeja

#### Scenario: Bandeja vacía
- **WHEN** la empresa todavía no tiene comprobantes
- **THEN** la bandeja responde una lista vacía

### Requirement: Filtros de la bandeja
La bandeja SHALL filtrar por rango de fechas de emisión, tipo de comprobante, estado, identificación del receptor, número, establecimiento y punto de emisión, combinables entre sí. Un filtro con un valor inválido SHALL rechazarse sin consultar.

#### Scenario: Rango de fechas
- **WHEN** un usuario filtra del 1 al 15 de octubre de 2026
- **THEN** la bandeja contiene solo los comprobantes emitidos en ese rango, ambos días incluidos

#### Scenario: Establecimiento, punto y estado
- **WHEN** un usuario combina un establecimiento, un punto y el estado autorizado
- **THEN** la bandeja contiene solo los comprobantes autorizados de ese punto

#### Scenario: Identificación y número
- **WHEN** un usuario filtra por la identificación de un receptor o por un número de comprobante
- **THEN** la bandeja contiene solo los comprobantes que coinciden

#### Scenario: Filtro inválido
- **WHEN** un usuario envía una fecha mal formada, un rango invertido o un estado desconocido
- **THEN** el sistema rechaza la solicitud con un error de validación

### Requirement: Documentos disponibles de un comprobante
Para cada comprobante, el sistema SHALL indicar qué documentos están disponibles y el estado de la generación de su RIDE, en la bandeja y en su detalle. El RIDE solo está disponible si el comprobante está autorizado y su RIDE existe; el XML autorizado, solo si el SRI lo devolvió; el XML firmado, desde que el comprobante está firmado. Las acciones ofrecidas dependen de esa disponibilidad.

#### Scenario: Autorizado con RIDE
- **WHEN** un comprobante autorizado tiene su RIDE y su XML autorizado
- **THEN** se ofrecen el RIDE, el XML autorizado y el XML firmado

#### Scenario: Autorizado con el RIDE en preparación
- **WHEN** un comprobante autorizado todavía no tiene su RIDE
- **THEN** se indica que el RIDE está en preparación y no se ofrece su descarga ni su impresión

#### Scenario: Comprobante sin autorizar
- **WHEN** un comprobante está firmado, en transmisión, devuelto, no autorizado o en revisión manual
- **THEN** solo se ofrece el XML firmado, nunca como XML autorizado, y no se ofrece RIDE

#### Scenario: Comprobante reservado
- **WHEN** un comprobante sigue reservado
- **THEN** no se ofrece ningún documento

### Requirement: RIDE programado al autorizar
Cada comprobante que pasa a autorizado SHALL quedar con la generación de su RIDE programada en la misma operación que lo autoriza, de modo que ningún autorizado queda sin ella. Los autorizados sin RIDE que existan al desplegar SHALL recibirla con un barrido repetible que no duplica generaciones ni reactiva las detenidas.

#### Scenario: Autorización nueva
- **WHEN** un comprobante pasa a autorizado
- **THEN** su generación del RIDE queda programada con la autorización

#### Scenario: Caída al autorizar
- **WHEN** la operación que autoriza el comprobante falla antes de confirmarse
- **THEN** no queda ni la autorización ni la generación programada

#### Scenario: Autorizados anteriores al despliegue
- **WHEN** existen comprobantes autorizados sin RIDE ni generación programada
- **THEN** el barrido programa una generación para cada uno

#### Scenario: Barrido repetido
- **WHEN** el barrido corre varias veces, o en varias instancias a la vez
- **THEN** cada comprobante tiene a lo sumo una generación activa y ninguno que ya tenga RIDE recibe otra

#### Scenario: Generación detenida
- **WHEN** un comprobante autorizado tiene su generación del RIDE detenida
- **THEN** el barrido no la reactiva

### Requirement: RIDE generado una vez
El sistema SHALL generar el RIDE de un comprobante autorizado una sola vez, fuera de cualquier petición del usuario, y guardarlo como documento inmutable con sus bytes exactos, su hash, su tamaño, su tipo, las versiones con que se generó y su origen. Toda descarga e impresión SHALL usar esos mismos bytes. Un RIDE guardado nunca se regenera ni se reemplaza.

#### Scenario: Primera generación
- **WHEN** se ejecuta la generación programada de un comprobante autorizado
- **THEN** queda guardado su RIDE con su hash, su tamaño, su tipo, las versiones del generador, del código de barras y de las fuentes, y el documento de origen con su hash

#### Scenario: Generación repetida
- **WHEN** una generación se ejecuta para un comprobante que ya tiene RIDE
- **THEN** no se genera otro y el RIDE guardado no cambia

#### Scenario: Generaciones simultáneas
- **WHEN** dos generaciones del mismo comprobante se ejecutan a la vez
- **THEN** queda un solo RIDE

#### Scenario: RIDE inmutable
- **WHEN** cualquier operación intenta cambiar o borrar un RIDE guardado
- **THEN** el sistema lo impide

#### Scenario: Cambio de versión del generador
- **WHEN** se actualiza el generador, el código de barras o las fuentes
- **THEN** los RIDE ya guardados no se regeneran y conservan sus bytes y versiones

### Requirement: Fuente canónica del RIDE
El RIDE SHALL salir del XML autorizado y de los datos inmutables de la autorización. Si el SRI autorizó de forma concluyente sin devolver el comprobante, SHALL salir del XML firmado transmitido, y su origen se registra como tal. Lo que el XML no trae solo puede salir de los datos inmutables ya asociados al comprobante; nunca de terceros, productos, configuración ni catálogos vigentes.

#### Scenario: Con XML autorizado
- **WHEN** el comprobante tiene su XML autorizado
- **THEN** el RIDE sale de él y su origen se registra como XML autorizado

#### Scenario: Autorizado sin comprobante
- **WHEN** el SRI autorizó el comprobante sin devolver el XML autorizado
- **THEN** el RIDE sale del XML firmado transmitido, su origen se registra como XML firmado de respaldo y en ningún lugar se presenta como XML autorizado

#### Scenario: Datos vigentes cambiados
- **WHEN** después de autorizar cambian el nombre del comprador, la descripción de un producto, la configuración tributaria o la denominación de una forma de pago
- **THEN** el RIDE muestra los datos del comprobante autorizado

#### Scenario: Datos de autorización que no corresponden
- **WHEN** el número de autorización no coincide con la clave del XML o el ambiente no coincide
- **THEN** no se genera el RIDE y la generación se detiene con su motivo

#### Scenario: Documento de origen alterado
- **WHEN** el hash o el tamaño del documento de origen no coinciden con los guardados
- **THEN** no se genera el RIDE y la generación se detiene con su motivo

### Requirement: Contenido del RIDE
El RIDE SHALL presentar el contenido del formato oficial de la factura: emisor y sus leyendas tributarias, número, autorización, ambiente, emisión, clave, receptor, detalle, información adicional, formas de pago y totales, mostrando solo los subtotales que el comprobante llenó. Los importes y cantidades SHALL salir del texto exacto del comprobante, sin recalcularlos, redondearlos ni convertirlos.

#### Scenario: Factura completa
- **WHEN** se genera el RIDE de una factura con varias líneas, descuentos, varias tarifas de IVA y varias formas de pago
- **THEN** muestra cada línea con su cantidad, precio, descuento y total, cada subtotal llenado, el IVA por tarifa, el total y las formas de pago con su denominación

#### Scenario: Consumidor final
- **WHEN** el receptor es el consumidor final
- **THEN** el RIDE muestra CONSUMIDOR FINAL y su identificación

#### Scenario: Leyendas del emisor
- **WHEN** el emisor es contribuyente RIMPE, agente de retención, contribuyente especial y obligado a llevar contabilidad
- **THEN** el RIDE muestra cada leyenda con su valor tal como está en el comprobante

#### Scenario: Importes exactos
- **WHEN** una línea tiene la cantidad `999999.999999` y el precio `1.000001`
- **THEN** el RIDE muestra esos valores completos, sin redondearlos

#### Scenario: Ambiente de pruebas
- **WHEN** el comprobante es del ambiente de pruebas
- **THEN** el RIDE indica el ambiente de pruebas

### Requirement: Clave de acceso legible por máquina
El RIDE SHALL mostrar la clave de acceso completa como texto y como un código de barras Code128 que, leído, devuelve exactamente la misma clave, con un tamaño legible en la práctica.

#### Scenario: Lectura del código
- **WHEN** se lee el código de barras del RIDE de varios comprobantes distintos
- **THEN** cada lectura devuelve exactamente la clave de acceso de su comprobante

#### Scenario: Clave visible
- **WHEN** se genera un RIDE
- **THEN** la clave de acceso aparece completa como texto, sin truncarse

### Requirement: Caracteres del RIDE
El RIDE SHALL representar cada carácter del comprobante con fuentes propias embebidas, sin depender de las fuentes del equipo. Si un carácter no tiene representación en esas fuentes, la generación SHALL detenerse con ese motivo y los caracteres afectados, nunca sustituirlos en silencio.

#### Scenario: Tildes y eñes
- **WHEN** el emisor, el receptor o una línea tienen tildes, eñes, diéresis o comillas tipográficas
- **THEN** el RIDE los muestra tal como están

#### Scenario: Carácter sin representación
- **WHEN** el comprobante tiene un carácter que las fuentes no representan
- **THEN** no se genera el RIDE y la generación se detiene indicando los caracteres

#### Scenario: Equipo sin fuentes
- **WHEN** la instalación no tiene fuentes del sistema
- **THEN** el RIDE se genera igual

### Requirement: Paginación del RIDE
Un RIDE de varias páginas SHALL repetir la identificación del comprobante y el encabezado del detalle en cada página, numerar las páginas, no partir ninguna fila del detalle y mantener juntos los totales. La autorización y el código de barras SHALL quedar completos en la primera página.

#### Scenario: Una página
- **WHEN** la factura tiene pocas líneas
- **THEN** el RIDE ocupa una página

#### Scenario: Varias páginas
- **WHEN** la factura tiene más líneas de las que caben en una página
- **THEN** cada página lleva la identificación, el encabezado del detalle y su número, y ninguna fila se parte entre páginas

#### Scenario: Totales sin cortar
- **WHEN** los totales no caben al final de una página
- **THEN** pasan completos a la siguiente

### Requirement: Seguridad del RIDE
El RIDE SHALL dibujar el contenido del comprobante como texto literal, sin enlaces, acciones, scripts ni archivos embebidos, y sin recursos externos. La generación SHALL rechazar un documento de origen con definiciones de tipo o entidades, demasiado grande, demasiado anidado o que no sea el comprobante esperado. El logo solo puede salir de la configuración inmutable del comprobante, con su hash verificado.

#### Scenario: Texto con código o direcciones
- **WHEN** un campo del comprobante contiene marcado, código o direcciones web o de archivos
- **THEN** el RIDE lo muestra como texto y no contiene enlaces, acciones ni scripts

#### Scenario: Sin recursos externos
- **WHEN** se genera un RIDE
- **THEN** no se accede a la red ni a archivos fuera de los propios de la generación

#### Scenario: Documento de origen peligroso
- **WHEN** el documento de origen trae definiciones de tipo, entidades, un tamaño o un anidamiento excesivos, o no es una factura
- **THEN** no se genera el RIDE y la generación se detiene con su motivo

#### Scenario: Logo alterado
- **WHEN** el hash del logo de la configuración del comprobante no coincide con el guardado
- **THEN** no se genera el RIDE y la generación se detiene con su motivo

### Requirement: Fallo de la generación del RIDE
Un fallo al generar el RIDE SHALL ser un estado operativo, nunca un cambio del estado fiscal: el comprobante sigue autorizado. Los fallos transitorios SHALL reintentarse con espera creciente dentro de límites; al agotarlos, la generación queda detenida y visible con su motivo. Un usuario con permiso SHALL poder reintentar una generación detenida mientras el comprobante no tenga RIDE.

#### Scenario: Fallo transitorio
- **WHEN** la generación falla porque el generador está ocupado o tarda demasiado
- **THEN** se reintenta más tarde y el comprobante sigue autorizado

#### Scenario: Fallo persistente
- **WHEN** la generación agota sus intentos o falla por una causa que no se corrige reintentando
- **THEN** queda detenida, el comprobante sigue autorizado y se ve que su RIDE no está disponible y por qué

#### Scenario: Reintento de una generación detenida
- **WHEN** un usuario con permiso reintenta la generación detenida de un comprobante sin RIDE
- **THEN** queda programada una nueva generación

#### Scenario: Reintento con RIDE existente
- **WHEN** un usuario reintenta la generación de un comprobante que ya tiene RIDE
- **THEN** se rechaza y el RIDE guardado no cambia

#### Scenario: Reintento con una generación en curso
- **WHEN** un usuario reintenta mientras la generación del comprobante está programada o en curso
- **THEN** se rechaza sin programar otra

#### Scenario: Reintentos simultáneos
- **WHEN** dos usuarios reintentan a la vez la misma generación detenida
- **THEN** se programa una sola

### Requirement: Descargas verificadas
El sistema SHALL servir el RIDE, el XML autorizado y el XML firmado de un comprobante con los bytes exactos guardados, solo cuando están disponibles. Antes de servirlos SHALL comprobar la empresa, la asociación con el comprobante, el hash y el tamaño; si no coinciden, no sirve nada. El nombre del archivo SHALL ser determinista y no depender de texto del usuario.

#### Scenario: Descarga del RIDE
- **WHEN** un usuario con permiso descarga el RIDE de un comprobante autorizado que lo tiene
- **THEN** recibe los bytes guardados como PDF, con un nombre de archivo determinista, y su hash coincide con el guardado

#### Scenario: Documento no disponible
- **WHEN** un usuario pide el RIDE de un comprobante sin RIDE, o el XML autorizado de un comprobante que no lo tiene
- **THEN** el sistema responde que el documento no está disponible

#### Scenario: XML firmado
- **WHEN** un usuario descarga el XML firmado
- **THEN** recibe los bytes firmados guardados, identificados como XML firmado

#### Scenario: Documento alterado
- **WHEN** el hash o el tamaño del documento guardado no coinciden con sus datos
- **THEN** no se sirve ningún byte, el usuario recibe un error y se registra el problema

### Requirement: Impresión del RIDE
La impresión SHALL usar el mismo RIDE guardado, sin una versión propia, y registrar que se solicitó. Nunca SHALL registrar ni afirmar que la impresión terminó.

#### Scenario: Imprimir
- **WHEN** un usuario con permiso imprime el RIDE de un comprobante autorizado
- **THEN** se abren los bytes del RIDE guardado y queda registrada una solicitud de impresión

#### Scenario: Imprimir sin RIDE
- **WHEN** el comprobante no tiene RIDE
- **THEN** no se ofrece la impresión y una solicitud responde que el documento no está disponible

### Requirement: Historial de entregas
El sistema SHALL registrar en un historial de solo agregado cada descarga servida y cada solicitud de impresión, con el comprobante, el tipo y el hash del documento, el actor y el momento, nunca sus bytes. Una descarga significa que la aplicación la sirvió y una solicitud de impresión, que la inició; ninguno significa que el receptor lo recibió. El historial no se duplica en la auditoría.

#### Scenario: Descarga registrada
- **WHEN** se sirve una descarga del RIDE o de un XML
- **THEN** queda una entrega de descarga con el comprobante, el tipo y el hash del documento, el usuario y el momento

#### Scenario: Solicitud de impresión registrada
- **WHEN** se solicita la impresión del RIDE
- **THEN** queda una entrega de solicitud de impresión con los mismos datos

#### Scenario: Descarga no servida
- **WHEN** una descarga se rechaza por permiso, disponibilidad o integridad
- **THEN** no queda ninguna entrega

#### Scenario: Consulta del historial
- **WHEN** un usuario con permiso consulta las entregas de un comprobante
- **THEN** las ve de la más reciente a la más antigua, sin bytes ni datos técnicos

#### Scenario: Historial inmutable
- **WHEN** cualquier operación intenta cambiar o borrar una entrega registrada
- **THEN** el sistema lo impide

#### Scenario: Sin entrega confirmada ni correo
- **WHEN** se consulta el historial
- **THEN** no hay entregas por correo ni entregas marcadas como recibidas o impresas

#### Scenario: Sin duplicar la auditoría
- **WHEN** se registra una entrega
- **THEN** no se registra un evento de auditoría por ella

### Requirement: Permisos de la bandeja
Cada operación SHALL exigir su permiso antes de leer o escribir datos: consultar la bandeja, los documentos disponibles y las entregas (`archive.read`), descargar e imprimir (`archive.download`) y reintentar una generación detenida (`archive.retryRide`). Sin sesión, el sistema responde no autenticado; sin el permiso, prohibido. Con la matriz vigente, administradores y operadores tienen los tres.

#### Scenario: Permiso exigido
- **WHEN** la política de acceso no concede el permiso de una operación de la bandeja
- **THEN** el sistema responde prohibido antes de leer o escribir datos y no registra ninguna entrega

#### Scenario: Matriz vigente
- **WHEN** se consulta la política de acceso
- **THEN** administradores y operadores tienen los permisos de consultar la bandeja, descargar e imprimir, y reintentar una generación detenida

#### Scenario: Sin sesión
- **WHEN** se consulta la bandeja o se descarga un documento sin sesión
- **THEN** el sistema responde no autenticado, sin efecto

### Requirement: Aislamiento de la bandeja por empresa
Los comprobantes, documentos y entregas de una empresa SHALL ser invisibles para cualquier otra. La empresa sale siempre de la sesión; ningún identificador enviado por el cliente la cambia.

#### Scenario: Comprobante de otra empresa
- **WHEN** un usuario de la empresa A consulta, descarga, imprime, reintenta o pide las entregas de un comprobante de la empresa B
- **THEN** el sistema responde que no existe, no revela ningún dato y no registra ninguna entrega

#### Scenario: Bandeja de otra empresa
- **WHEN** un usuario de la empresa A consulta la bandeja con cualquier filtro
- **THEN** no aparece ningún comprobante de la empresa B
