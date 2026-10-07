# document-archive Specification

## Purpose

Bandeja de los comprobantes fiscales de la empresa y conservación de sus documentos: el RIDE
generado una vez desde el comprobante autorizado, las descargas verificadas del RIDE y de los XML,
la impresión del mismo RIDE y el historial de las entregas que el sistema puede observar.

## Requirements

### Requirement: Bandeja de comprobantes
El sistema SHALL listar en una bandeja los comprobantes fiscales de la empresa desde que se reservan, de cualquier tipo, con paginación y del más reciente al más antiguo. Los borradores nunca aparecen. Cada comprobante muestra su tipo, número, fecha de emisión, receptor, total y estado visible. Una guía de remisión no tiene total monetario: se muestra sin importe, nunca como 0.00, y en lugar de un receptor muestra el nombre de su único destinatario o el número de sus destinatarios.

#### Scenario: Comprobantes en todos los estados
- **WHEN** la empresa tiene comprobantes reservados, firmados, en transmisión, autorizados, no autorizados, devueltos y en revisión manual
- **THEN** la bandeja los muestra todos con su estado visible

#### Scenario: Borradores fuera de la bandeja
- **WHEN** la empresa tiene borradores sin emitir
- **THEN** ninguno aparece en la bandeja

#### Scenario: Bandeja vacía
- **WHEN** la empresa todavía no tiene comprobantes
- **THEN** la bandeja responde una lista vacía

#### Scenario: Guía con un destinatario
- **WHEN** la empresa tiene una guía de remisión con un solo destinatario
- **THEN** la bandeja la muestra con el nombre de ese destinatario y sin importe

#### Scenario: Guía con varios destinatarios
- **WHEN** la empresa tiene una guía de remisión con tres destinatarios
- **THEN** la bandeja la muestra con "3 destinatarios" y sin importe, y su detalle muestra los tres

### Requirement: Filtros de la bandeja
La bandeja SHALL filtrar por rango de fechas de emisión, tipo de comprobante, estado, identificación del receptor, número, establecimiento y punto de emisión, combinables entre sí. La identificación del receptor encuentra una guía de remisión por cualquiera de sus destinatarios. Un filtro con un valor inválido SHALL rechazarse sin consultar.

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

#### Scenario: Identificación de un destinatario de una guía
- **WHEN** un usuario filtra por la identificación del segundo destinatario de una guía de remisión
- **THEN** la bandeja contiene esa guía

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
El RIDE SHALL presentar, en el formato oficial de su tipo, la factura 1.1.0, la nota de crédito 1.1.0, la nota de débito 1.0.0, la guía de remisión 1.1.0 o el comprobante de retención 2.0.0 que el sistema emite. La factura muestra emisor y sus leyendas, número, autorización, ambiente, emisión, clave, receptor, detalle, formas de pago y totales de IVA, solo con los subtotales llenados. La nota de crédito sigue su distribución oficial (ficha v2.34, anexo 2): muestra además el comprobante que modifica, su fecha de emisión y la razón de la modificación, y no lleva formas de pago. La nota de débito sigue su distribución oficial (ficha v2.34, anexo 2, página 62): muestra el comprobante que modifica y su fecha de emisión, cada razón de la modificación con su valor, la forma de pago, los subtotales llenados por tratamiento de IVA, el IVA por tarifa y el valor total. El comprobante de retención sigue la distribución oficial publicada para su versión 1.0.0 (ficha v2.34, anexo 2, página 63): una fila por retención con el tipo, el número y la fecha de su documento sustento, el ejercicio fiscal, la base, el impuesto, el porcentaje y el valor retenido; y, como datos adicionales que el anexo 2 permite (página 60), los impuestos declarados de cada documento sustento. La guía de remisión sigue su distribución oficial (ficha v2.34, anexo 2, página 64): el transporte con el transportista, la placa, el punto de partida y las fechas, y un bloque por destinatario con su comprobante de venta, su motivo, su destino, su identificación, su ruta y su detalle de cantidad, descripción y códigos, sin importes. Importes y cantidades SHALL salir del texto exacto del comprobante, sin recalcular, redondear ni convertir. Si el comprobante trae contenido que el sistema no emite, el RIDE no se genera: nunca se omite en silencio.

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

#### Scenario: Contenido que el sistema no emite
- **WHEN** el comprobante de origen trae ICE, IRBPNR, propina, información adicional, compensaciones u otro elemento que el sistema no emite
- **THEN** no se genera el RIDE y la generación se detiene indicando los elementos

#### Scenario: Nota de crédito
- **WHEN** se genera el RIDE de una nota de crédito de devolución con dos líneas
- **THEN** muestra "NOTA DE CRÉDITO" con su número y su autorización, el comprobante que modifica como FACTURA con su número y su fecha de emisión, la razón de la modificación, cada línea con su cantidad, precio, descuento y total, y los subtotales llenados con el valor total, sin formas de pago

#### Scenario: Clave de la nota en el RIDE
- **WHEN** se genera el RIDE de una nota de crédito o de una nota de débito
- **THEN** el código de barras y la clave impresa son los de la nota, nunca los de la factura que modifica

#### Scenario: Distribución propia de la nota de crédito
- **WHEN** se comparan el RIDE de una factura y el de una nota de crédito
- **THEN** la nota de crédito tiene su propio bloque del comprobante modificado y no reutiliza el bloque de formas de pago de la factura

#### Scenario: Nota de débito con varias tarifas
- **WHEN** se genera el RIDE de una nota de débito con conceptos de intereses de mora al 15 % y de costos posteriores al 0 %
- **THEN** muestra "NOTA DE DÉBITO" con su número y su autorización, el comprobante que modifica como FACTURA con su número y su fecha de emisión, cada razón con su valor, la forma de pago con su denominación, el subtotal del 15 %, el del 0 %, el subtotal sin impuestos, el IVA del 15 % y el valor total

#### Scenario: Distribución propia de la nota de débito
- **WHEN** se comparan el RIDE de una nota de débito con el de una factura y el de una nota de crédito
- **THEN** la nota de débito tiene su propio bloque de razones y valores de la modificación y no reutiliza el detalle de líneas de la factura ni el de la nota de crédito

#### Scenario: Retención con varios documentos sustento
- **WHEN** se genera el RIDE de un comprobante de retención con dos documentos sustento y tres retenciones
- **THEN** muestra "COMPROBANTE DE RETENCIÓN" con su número y su autorización, el sujeto retenido y la fecha de emisión, y una fila por retención con el tipo, el número y la fecha de su documento sustento, el ejercicio fiscal, la base, el impuesto, el porcentaje y el valor retenido

#### Scenario: Impuestos declarados del documento sustento en el RIDE
- **WHEN** se genera el RIDE de una retención cuyo documento sustento declara IVA e ICE
- **THEN** el RIDE muestra, como datos adicionales del documento, cada impuesto declarado con su código, su código de porcentaje, su base, su tarifa y su valor

#### Scenario: Distribución propia de la retención
- **WHEN** se comparan el RIDE de un comprobante de retención con el de una factura y el de las notas
- **THEN** la retención tiene su propia tabla de retenciones y no reutiliza el detalle de líneas, las formas de pago ni los subtotales de los otros tipos

#### Scenario: Guía con dos destinatarios
- **WHEN** se genera el RIDE de una guía de remisión con dos destinatarios, uno con factura y otro con una excepción declarada
- **THEN** muestra "GUÍA DE REMISIÓN" con su número y su autorización, el transportista con su identificación, la placa, el punto de partida y las fechas de inicio y fin, y un bloque por destinatario con su motivo, su destino, su identificación, su ruta y su detalle; el de la factura muestra FACTURA con su número, su fecha de emisión y su autorización, y el otro deja vacíos los datos del comprobante de venta

#### Scenario: Guía sin importes
- **WHEN** se genera el RIDE de una guía de remisión
- **THEN** no muestra precios, subtotales, impuestos, total ni formas de pago, ni una fila con la fecha de emisión de la guía

#### Scenario: Distribución propia de la guía
- **WHEN** se comparan el RIDE de una guía de remisión con el de los demás tipos
- **THEN** la guía tiene sus propios bloques de transporte y de destinatarios y no reutiliza el detalle de líneas, las formas de pago ni los subtotales de los otros tipos

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

#### Scenario: Fuentes de la instalación alteradas
- **WHEN** faltan las fuentes del RIDE o su manifiesto, o un hash no coincide
- **THEN** la instalación no se declara lista y no se genera ningún RIDE

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
- **WHEN** el documento de origen trae definiciones de tipo, entidades, un tamaño o un anidamiento excesivos, o no es una factura 1.1.0
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
El sistema SHALL servir el RIDE, el XML autorizado y el XML firmado de un comprobante con los bytes exactos guardados, solo cuando están disponibles. Antes de servirlos SHALL comprobar la empresa, el permiso, la asociación con el comprobante, el hash y el tamaño; si no coinciden, no sirve nada. El nombre del archivo SHALL ser determinista y no depender de texto del usuario.

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
La solicitud de impresión SHALL ser una acción explícita, distinta de la lectura del RIDE: comprueba que el RIDE guardado existe y está íntegro, registra la solicitud, y la interfaz imprime los mismos bytes de la descarga, sin una versión propia. Leer el RIDE nunca registra una solicitud de impresión. Nunca SHALL registrar ni afirmar que la impresión terminó.

#### Scenario: Imprimir
- **WHEN** un usuario con permiso pide imprimir el RIDE de un comprobante autorizado
- **THEN** queda registrada una solicitud de impresión y se imprimen los bytes del RIDE guardado

#### Scenario: Imprimir sin RIDE
- **WHEN** el comprobante no tiene RIDE
- **THEN** no se ofrece la impresión y una solicitud responde que el documento no está disponible

#### Scenario: Imprimir un RIDE alterado
- **WHEN** el hash o el tamaño del RIDE guardado no coinciden con sus datos
- **THEN** no se registra la solicitud y el usuario recibe un error

#### Scenario: Lecturas del RIDE
- **WHEN** el RIDE se lee una o varias veces, también por una precarga, una caché o una repetición automática
- **THEN** no se registra ninguna solicitud de impresión

### Requirement: Historial de entregas
El sistema SHALL registrar en un historial de solo agregado cada descarga servida y cada solicitud de impresión, con el comprobante, el tipo y el hash del documento, el actor y el momento, nunca sus bytes. Una descarga significa que la aplicación inició una respuesta autorizada con el documento, no que el cliente lo guardó; una solicitud de impresión, que un usuario la pidió. Ninguna significa que el receptor lo recibió. El historial no se duplica en la auditoría.

#### Scenario: Descarga registrada
- **WHEN** se sirve una descarga del RIDE o de un XML
- **THEN** queda una entrega de descarga con el comprobante, el tipo y el hash del documento, el usuario y el momento

#### Scenario: Solicitud de impresión registrada
- **WHEN** se solicita la impresión del RIDE
- **THEN** queda una entrega de solicitud de impresión con los mismos datos

#### Scenario: Bytes para imprimir
- **WHEN** después de la solicitud la interfaz obtiene el RIDE para imprimirlo
- **THEN** queda además una descarga, porque la aplicación sirvió los bytes

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

### Requirement: Notas de crédito en la bandeja
La bandeja SHALL incluir las notas de crédito desde que se reservan, con su tipo visible, el filtro por tipo de comprobante y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Factura y nota de crédito
- **WHEN** la empresa tiene facturas y notas de crédito emitidas
- **THEN** la bandeja muestra ambas con su tipo, y el filtro por nota de crédito deja solo las notas

#### Scenario: Documentos de una nota autorizada
- **WHEN** un usuario abre los documentos de una nota de crédito autorizada
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una nota sin autorizar
- **WHEN** un usuario abre los documentos de una nota firmada que todavía no está autorizada
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la nota
- **WHEN** una nota de crédito pasa a autorizada
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura

### Requirement: Notas de débito en la bandeja
La bandeja SHALL incluir las notas de débito desde que se reservan, con su tipo visible, el filtro por tipo de comprobante (factura, nota de crédito y nota de débito) y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Tres tipos en la bandeja
- **WHEN** la empresa tiene facturas, notas de crédito y notas de débito emitidas
- **THEN** la bandeja muestra las tres con su tipo, y el filtro por nota de débito deja solo las notas de débito

#### Scenario: Documentos de una nota de débito autorizada
- **WHEN** un usuario abre los documentos de una nota de débito autorizada
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una nota de débito sin autorizar
- **WHEN** un usuario abre los documentos de una nota de débito firmada que todavía no está autorizada
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la nota de débito
- **WHEN** una nota de débito pasa a autorizada
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura

#### Scenario: Enlace al detalle por tipo
- **WHEN** un usuario abre una nota de débito desde la bandeja
- **THEN** llega al detalle de la nota de débito, no al de una factura ni al de una nota de crédito

### Requirement: Comprobantes de retención en la bandeja
La bandeja SHALL incluir los comprobantes de retención desde que se reservan, con su tipo visible, el filtro por tipo de comprobante (factura, nota de crédito, nota de débito y comprobante de retención) y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Cuatro tipos en la bandeja
- **WHEN** la empresa tiene facturas, notas de crédito, notas de débito y comprobantes de retención emitidos
- **THEN** la bandeja muestra los cuatro con su tipo, y el filtro por comprobante de retención deja solo las retenciones

#### Scenario: Documentos de una retención autorizada
- **WHEN** un usuario abre los documentos de un comprobante de retención autorizado
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una retención sin autorizar
- **WHEN** un usuario abre los documentos de un comprobante de retención firmado que todavía no está autorizado
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la retención
- **WHEN** un comprobante de retención pasa a autorizado
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura

#### Scenario: Enlace al detalle por tipo
- **WHEN** un usuario abre un comprobante de retención desde la bandeja
- **THEN** llega al detalle de la retención, no al de otro tipo

### Requirement: Guías de remisión en la bandeja
La bandeja SHALL incluir las guías de remisión desde que se reservan, con su tipo visible, el filtro por tipo de comprobante (factura, nota de crédito, nota de débito, guía de remisión y comprobante de retención) y el acceso a su detalle. Sus documentos disponibles, descargas verificadas, impresión, historial de entregas y RIDE siguen las mismas reglas que los de una factura.

#### Scenario: Cinco tipos en la bandeja
- **WHEN** la empresa tiene facturas, notas de crédito, notas de débito, guías de remisión y comprobantes de retención emitidos
- **THEN** la bandeja muestra los cinco con su tipo, y el filtro por guía de remisión deja solo las guías

#### Scenario: Documentos de una guía autorizada
- **WHEN** un usuario abre los documentos de una guía de remisión autorizada
- **THEN** puede descargar su RIDE, su XML autorizado y su XML firmado, imprimir el RIDE y ver el historial de entregas

#### Scenario: Documentos de una guía sin autorizar
- **WHEN** un usuario abre los documentos de una guía de remisión firmada que todavía no está autorizada
- **THEN** solo puede descargar su XML firmado, rotulado como firmado; el RIDE y el XML autorizado no están disponibles

#### Scenario: RIDE programado al autorizar la guía
- **WHEN** una guía de remisión pasa a autorizada
- **THEN** la generación de su RIDE queda programada en la misma operación, como la de una factura

#### Scenario: Enlace al detalle por tipo
- **WHEN** un usuario abre una guía de remisión desde la bandeja
- **THEN** llega al detalle de la guía, no al de otro tipo
