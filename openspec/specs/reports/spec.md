# reports Specification

## Purpose

Ofrecer a la empresa los cinco reportes operativos del ERS (Documentos emitidos, Facturas, Retenciones, Inventario y Terceros) como listados filtrables, con su exportación a XLSX con los mismos registros de cada lista, sin convertirlos en contabilidad ni en anexos tributarios.

## Requirements

### Requirement: Reportes de la empresa
El sistema SHALL ofrecer exactamente cinco reportes: Documentos emitidos, Facturas, Retenciones, Inventario (con sus vistas Existencias y Movimientos) y Terceros. Cada reporte es un listado paginado de filas, con sus filtros y su exportación a XLSX. Los reportes no suman totales, no compensan comprobantes entre sí y no reemplazan obligaciones contables ni anexos tributarios.

#### Scenario: Los cinco reportes
- **WHEN** un usuario con permiso abre Reportes
- **THEN** puede elegir Documentos emitidos, Facturas, Retenciones, Inventario o Terceros, y ningún otro

#### Scenario: Sin totales ni compensación
- **WHEN** la empresa tiene una factura de 100.00, una nota de crédito de 20.00 y una nota de débito de 10.00 sobre ella, todas autorizadas
- **THEN** Documentos emitidos muestra tres filas, cada una con su propio importe, sin una fila de totales ni un valor neto de 90.00 o 110.00

#### Scenario: Aviso de los reportes
- **WHEN** un usuario consulta o exporta un reporte
- **THEN** el reporte indica que no reemplaza obligaciones contables ni anexos tributarios

### Requirement: Reporte de documentos emitidos
Documentos emitidos SHALL listar una fila por comprobante de cualquiera de los seis tipos desde que reserva su número, nunca un borrador, con la fecha de emisión, el tipo, el número, la identificación y el nombre del tercero, el subtotal, los impuestos, el total, el estado y el ambiente. Por defecto incluye todos los estados.

#### Scenario: Todos los estados por defecto
- **WHEN** la empresa tiene comprobantes reservados, firmados, autorizados, devueltos y no autorizados, y borradores sin emitir
- **THEN** el reporte sin filtro de estado lista todos los comprobantes con su estado en cada fila y ningún borrador

#### Scenario: Filtro por estado
- **WHEN** un usuario filtra Documentos emitidos por el estado autorizado
- **THEN** el reporte lista solo los comprobantes autorizados

#### Scenario: Notas, guías y liquidaciones como filas
- **WHEN** la empresa emitió una nota de crédito, una nota de débito, una guía de remisión y una liquidación de compra
- **THEN** cada una aparece como una fila de Documentos emitidos con su tipo, y no existe un reporte propio para ninguna

#### Scenario: Importes por tipo de comprobante
- **WHEN** el reporte lista una factura, una nota de crédito, una nota de débito, una liquidación de compra, un comprobante de retención y una guía de remisión
- **THEN** los cuatro primeros muestran su subtotal sin impuestos, sus impuestos y su total; la retención muestra solo su total retenido, y la guía no muestra importes

#### Scenario: Tercero de cada tipo
- **WHEN** el reporte lista una factura, una liquidación de compra, un comprobante de retención y guías con uno y con tres destinatarios
- **THEN** la factura muestra su comprador, la liquidación su proveedor, la retención su sujeto retenido, la guía de un destinatario su destinatario y la de tres "3 destinatarios"

### Requirement: Reporte de facturas
Facturas SHALL listar solo facturas, una fila por factura, con la fecha de emisión, el número, la identificación y el nombre del cliente, el subtotal sin impuestos, el IVA, los otros impuestos, el total, el estado y el ambiente. Por defecto incluye solo las facturas autorizadas; el usuario puede elegir otro estado o todos.

#### Scenario: Autorizadas por defecto
- **WHEN** la empresa tiene facturas autorizadas, firmadas sin autorizar y no autorizadas
- **THEN** el reporte sin cambiar el filtro de estado lista solo las autorizadas

#### Scenario: Otro estado elegido
- **WHEN** un usuario elige el estado no autorizada en Facturas
- **THEN** el reporte lista solo las facturas no autorizadas, que siguen existiendo en el sistema

#### Scenario: Solo facturas
- **WHEN** la empresa tiene facturas y notas de crédito sobre ellas
- **THEN** Facturas lista solo las facturas, con sus importes sin descontar las notas

#### Scenario: IVA y otros impuestos
- **WHEN** el reporte lista una factura con IVA del 15 % y otra con un producto con ICE
- **THEN** cada fila muestra por separado su IVA y sus otros impuestos

### Requirement: Reporte de retenciones
Retenciones SHALL listar una fila por línea de retención de cada comprobante de retención, con la fecha de emisión, el número, la identificación y el nombre del sujeto retenido, el período fiscal, el impuesto, el código de retención, la base, el porcentaje, el valor retenido, el estado y el ambiente. Por defecto incluye solo las retenciones autorizadas; el usuario puede elegir otro estado o todos.

#### Scenario: Una fila por línea
- **WHEN** una retención autorizada tiene dos documentos sustento con tres líneas de retención en total
- **THEN** el reporte lista tres filas de esa retención, cada una con su impuesto, su código, su base, su porcentaje y su valor

#### Scenario: Autorizadas por defecto
- **WHEN** la empresa tiene retenciones autorizadas y otras firmadas sin autorizar
- **THEN** el reporte sin cambiar el filtro de estado lista solo las líneas de las autorizadas

#### Scenario: Filtro por período fiscal
- **WHEN** un usuario filtra Retenciones por el período fiscal 2026-09
- **THEN** el reporte lista solo las líneas de las retenciones de ese período, aunque se hayan emitido en octubre

### Requirement: Existencias del inventario
La vista Existencias de Inventario SHALL listar una fila por producto con inventario inicializado, con su código, su nombre y su saldo actual, tal como lo registra el inventario. Los productos sin control de stock o sin inventario inicializado no aparecen. El saldo nunca se recalcula desde los comprobantes.

#### Scenario: Saldo registrado
- **WHEN** un producto inicializado con 20 unidades tiene una salida por factura de 5 y una entrada manual de 3
- **THEN** Existencias muestra su saldo de 18, el mismo que muestra el inventario

#### Scenario: Productos sin inventario
- **WHEN** la empresa tiene un producto marcado sin inicializar y otro sin control de stock
- **THEN** ninguno aparece en Existencias

#### Scenario: Saldo negativo
- **WHEN** un producto tiene salidas registradas que superan sus existencias
- **THEN** Existencias muestra su saldo negativo tal cual

### Requirement: Movimientos del inventario
La vista Movimientos de Inventario SHALL listar los movimientos registrados del inventario de toda la empresa, una fila por movimiento, con la fecha y hora, el código y el nombre del producto, el tipo de movimiento, la cantidad, el saldo resultante y el comprobante que lo originó cuando existe. Se filtra por producto, rango de fechas y tipo de movimiento.

#### Scenario: Movimientos de toda la empresa
- **WHEN** la empresa tiene movimientos de varios productos y un usuario no filtra por producto
- **THEN** la vista lista los movimientos de todos los productos

#### Scenario: Filtro por tipo de movimiento
- **WHEN** un usuario filtra Movimientos por las salidas por factura
- **THEN** la vista lista solo esas salidas, cada una con el número de su factura

#### Scenario: Vistas separadas
- **WHEN** un usuario consulta o exporta Inventario
- **THEN** elige Existencias o Movimientos, y nunca recibe las dos en una misma tabla

### Requirement: Reporte de terceros
Terceros SHALL listar una fila por tercero de la empresa con su identificación, su razón social, su correo, su teléfono, sus roles y su estado, tal como están registrados hoy. Se filtra por rol, identificación y estado.

#### Scenario: Filtro por rol
- **WHEN** un usuario filtra Terceros por el rol de proveedor
- **THEN** el reporte lista solo los terceros con ese rol, con todos sus roles en la fila

#### Scenario: Datos vigentes
- **WHEN** un tercero corrige su correo
- **THEN** el reporte de terceros muestra el correo vigente

### Requirement: Filtros de los reportes
Cada reporte SHALL aplicar solo sus filtros mínimos del ERS, que viven en la URL de la pantalla: el rango de fechas, el tipo y el estado del comprobante, el establecimiento y el punto, la identificación del cliente o del sujeto retenido, el período fiscal, el producto y el tipo de movimiento, y el rol, la identificación y el estado del tercero, según el reporte. El atajo mensual solo fija el rango de fechas.

#### Scenario: Atajo mensual
- **WHEN** un usuario elige el mes de septiembre de 2026 en un reporte
- **THEN** el reporte aplica el rango del 2026-09-01 al 2026-09-30, igual que si lo hubiera escrito

#### Scenario: Rango inválido
- **WHEN** un usuario pide un reporte con la fecha final anterior a la inicial
- **THEN** el sistema rechaza la consulta indicando el rango, sin listar ni exportar

#### Scenario: Filtro de otro reporte
- **WHEN** una solicitud de Terceros envía un filtro de estado del comprobante
- **THEN** el sistema la rechaza por contener un filtro que ese reporte no tiene

### Requirement: Ambiente de los reportes
Los reportes de comprobantes SHALL mostrar el ambiente de cada fila y filtrar por ambiente. Por defecto muestran el ambiente vigente de la empresa; Pruebas, Producción o los dos solo se listan por elección explícita del usuario. La exportación aplica exactamente el mismo filtro de ambiente que la lista.

#### Scenario: Ambiente vigente por defecto
- **WHEN** la empresa está en Producción y tiene comprobantes de Pruebas anteriores
- **THEN** los reportes sin filtro de ambiente listan solo los de Producción

#### Scenario: Ambos ambientes elegidos
- **WHEN** un usuario elige los dos ambientes en Documentos emitidos
- **THEN** el reporte lista los comprobantes de Pruebas y de Producción, cada uno con su ambiente

#### Scenario: Ambiente de otra empresa
- **WHEN** una solicitud intenta fijar el ambiente o la empresa con un valor que no corresponde a la sesión
- **THEN** el sistema usa solo la empresa de la sesión y su filtro de ambiente válido, y nunca lista comprobantes de otra empresa

### Requirement: Datos históricos de los reportes
Los reportes de comprobantes y de retenciones SHALL mostrar los datos que el comprobante congeló al reservar su número: su número, su fecha, su tercero, sus importes y sus líneas de retención. Una corrección posterior de un tercero, de un producto o de un catálogo no cambia lo que muestran.

#### Scenario: Tercero corregido después de emitir
- **WHEN** el comprador de una factura emitida corrige su razón social
- **THEN** Documentos emitidos y Facturas siguen mostrando la razón social con que se emitió la factura

#### Scenario: Catálogo cambiado después de emitir
- **WHEN** cambia la tarifa de un código de retención después de emitir una retención
- **THEN** Retenciones sigue mostrando el porcentaje y el valor con que se emitió

### Requirement: Exportación a XLSX con los mismos registros
La exportación de un reporte SHALL entregar un archivo XLSX con exactamente los registros de su lista completa para los mismos filtros, en el mismo orden, y no solo los de la página visible. Es el único formato de exportación.

#### Scenario: Filtro mensual exportado
- **WHEN** un usuario filtra Documentos emitidos por un mes con 3 páginas de resultados y exporta
- **THEN** el XLSX contiene las filas de las 3 páginas, en el mismo orden y sin filas adicionales

#### Scenario: Exportación sin resultados
- **WHEN** un usuario exporta un reporte cuyos filtros no tienen resultados
- **THEN** recibe un XLSX con solo los encabezados

#### Scenario: Filtros respetados
- **WHEN** un usuario exporta Facturas con un cliente y un estado elegidos
- **THEN** el XLSX contiene solo las facturas de ese cliente en ese estado

### Requirement: Tipos de dato del XLSX
El XLSX SHALL escribir las identificaciones, los números de comprobante, las claves y las autorizaciones como texto; los importes y las cantidades como números con su formato cuando caben sin pérdida en la precisión segura de la hoja, y si no, como texto exacto; y las fechas como fechas. Ningún valor decimal se redondea ni se aproxima al escribirlo.

#### Scenario: Identificación con ceros a la izquierda
- **WHEN** se exporta un tercero con la cédula 0102030405
- **THEN** la celda contiene el texto 0102030405, sin perder el cero

#### Scenario: Importe como número
- **WHEN** se exporta una factura con un total de 106.00
- **THEN** la celda del total es un número con formato monetario que vale exactamente 106.00

#### Scenario: Valor que excede la precisión segura
- **WHEN** se exporta un importe o una cantidad con más dígitos significativos de los que la hoja conserva sin pérdida
- **THEN** la celda contiene el texto exacto del valor, nunca un número aproximado

#### Scenario: Fecha de emisión
- **WHEN** se exporta un comprobante emitido el 2026-10-07
- **THEN** la celda es una fecha que vale el 7 de octubre de 2026, sin desplazarse por la zona horaria

### Requirement: Texto sin fórmulas en el XLSX
Todo texto que proviene de lo que un usuario escribió SHALL quedar en el XLSX como texto, con su valor visible intacto, y nunca como una fórmula, aunque comience con un signo igual, más, menos, arroba, tabulador o retorno de carro.

#### Scenario: Razón social que parece una fórmula
- **WHEN** se exporta un tercero cuya razón social es =HYPERLINK("http://ejemplo.invalid")
- **THEN** la celda contiene ese texto tal cual y la hoja no la evalúa como fórmula

#### Scenario: Prefijos peligrosos
- **WHEN** se exportan textos que comienzan con =, +, -, @, un tabulador o un retorno de carro
- **THEN** cada uno queda como texto con su valor intacto

### Requirement: Límites de recursos de la exportación
El sistema SHALL limitar las filas de una exportación y las exportaciones simultáneas con valores configurables. Son defensas de recursos del sistema, no límites del ERS. Una exportación que supera el máximo de filas se rechaza indicando que se acoten los filtros, y nunca se entrega truncada.

#### Scenario: Demasiadas filas
- **WHEN** un usuario exporta un reporte cuyos filtros superan el máximo configurado de filas
- **THEN** el sistema rechaza la exportación, indica que acote los filtros y no entrega ningún archivo

#### Scenario: Demasiadas exportaciones simultáneas
- **WHEN** se piden más exportaciones simultáneas que el máximo configurado
- **THEN** las que exceden se rechazan indicando que se intente de nuevo, sin afectar a las que están en curso

#### Scenario: La lista no tiene ese límite
- **WHEN** un reporte tiene más filas que el máximo de exportación
- **THEN** su lista paginada sigue mostrándolas todas por páginas

### Requirement: Permisos de reportes
Ver los reportes y exportarlos SHALL ser operaciones permitidas al administrador y al operador, verificadas en el servidor en cada consulta y en cada exportación.

#### Scenario: Operador exporta
- **WHEN** un operador exporta Documentos emitidos
- **THEN** recibe el XLSX

#### Scenario: Sin permiso
- **WHEN** un usuario sin el permiso consulta o exporta un reporte
- **THEN** el sistema responde que no tiene acceso y no lista ni genera nada

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión consulta o exporta un reporte
- **THEN** el sistema responde que se requiere iniciar sesión

### Requirement: Aislamiento de los reportes por empresa
Cada reporte y cada exportación SHALL contener solo datos de la empresa de la sesión. La empresa nunca sale de la solicitud, y la exportación no se descarga por un enlace que omita la autorización.

#### Scenario: Datos de otra empresa
- **WHEN** un usuario de una empresa consulta o exporta un reporte
- **THEN** no aparece ni se puede inferir ningún comprobante, movimiento, retención ni tercero de otra empresa

#### Scenario: Empresa en la solicitud
- **WHEN** una solicitud de reporte incluye un identificador de empresa
- **THEN** el sistema la rechaza por contener datos no permitidos
