# Spec Delta

## Purpose

Pone a disposición de cada empresa los catálogos fiscales oficiales del SRI como datos normativos
versionados del sistema, con vigencia y fuente, y le permite decidir qué entradas usa; incluye la
política de consumidor final, el registro de esquemas XSD y la matriz de casos especiales.

## ADDED Requirements

### Requirement: Catálogos fiscales oficiales
El sistema SHALL ofrecer a todas las empresas los catálogos fiscales oficiales de tipos de identificación, impuestos, tarifas de IVA, códigos de ICE, códigos de IRBPNR y formas de pago. Cada entrada SHALL indicar su código, su descripción oficial, su vigencia desde y, si la tiene, hasta, su documento fuente, la versión de esa fuente y su estado normativo.

#### Scenario: Consulta de un catálogo
- **WHEN** un usuario consulta las formas de pago
- **THEN** ve cada código con su descripción oficial, su vigencia, su fuente y la versión de la fuente

#### Scenario: Mismas entradas para todas las empresas
- **WHEN** usuarios de dos empresas consultan las tarifas de IVA
- **THEN** ambos ven las mismas entradas oficiales, con los mismos códigos, descripciones y vigencias

#### Scenario: Funciona sin conexión con el SRI
- **WHEN** el sistema arranca sin acceso a internet
- **THEN** los catálogos fiscales están disponibles con los datos distribuidos en la versión instalada

### Requirement: Semántica de cada impuesto
El sistema SHALL describir cada tarifa según la semántica de su impuesto, sin reducirlas a un único porcentaje. Una tarifa de IVA indica su porcentaje o su condición (no objeto, exento o diferenciado). Una entrada de ICE identifica el código y su descripción oficial; su tarifa la fija la normativa vigente y el catálogo no la inventa. Una entrada de IRBPNR identifica su código.

#### Scenario: Tarifa de IVA con porcentaje
- **WHEN** un usuario consulta la tarifa de IVA con código 4
- **THEN** ve que corresponde al 15 %

#### Scenario: Tarifa de IVA sin porcentaje fijo
- **WHEN** un usuario consulta las tarifas de IVA con códigos 6, 7 y 8
- **THEN** ve no objeto de impuesto, exento de IVA e IVA diferenciado, sin un porcentaje inventado

#### Scenario: Código de ICE sin tarifa publicada
- **WHEN** un usuario consulta un código de ICE
- **THEN** ve su código y su descripción oficial, y que su tarifa se rige por la normativa vigente

### Requirement: Datos oficiales no modificables por la empresa
El sistema SHALL impedir que cualquier usuario cree códigos fiscales oficiales o modifique sus códigos, descripciones oficiales, tarifas o vigencias. Los catálogos oficiales solo cambian con una versión nueva del producto.

#### Scenario: Intento de cambiar una tarifa
- **WHEN** un administrador intenta cambiar el porcentaje, la descripción o la vigencia de una entrada oficial
- **THEN** el sistema rechaza la solicitud y la entrada no cambia

#### Scenario: Intento de crear un código
- **WHEN** un administrador intenta registrar un código fiscal que no está en los catálogos oficiales
- **THEN** el sistema rechaza la solicitud y el catálogo no cambia

### Requirement: Actualización versionada de los catálogos
El sistema SHALL incorporar las actualizaciones oficiales como entradas o versiones nuevas, sin alterar el código, la descripción oficial, los valores ni el inicio de vigencia de una entrada ya publicada. Una versión posterior solo puede cerrar una vigencia abierta o cambiar el estado normativo, indicando su fuente. El sistema SHALL negarse a arrancar con datos que alteren una entrada publicada.

#### Scenario: Nueva tarifa oficial
- **WHEN** una versión nueva del producto incorpora una tarifa de IVA con su fecha de inicio
- **THEN** la nueva tarifa está disponible desde esa fecha y las entradas anteriores se conservan con su vigencia

#### Scenario: Cierre de una vigencia
- **WHEN** una versión nueva del producto cierra la vigencia de una forma de pago citando su fuente
- **THEN** la entrada conserva sus datos, deja de estar vigente después de la fecha de cierre y su historia sigue consultable

#### Scenario: Datos que alteran una entrada publicada
- **WHEN** el sistema arranca con datos que cambian la descripción o los valores de una entrada ya publicada
- **THEN** no arranca e indica qué entrada se alteró, sin modificar los datos existentes

#### Scenario: Arranques repetidos
- **WHEN** el sistema arranca varias veces con la misma versión de los catálogos
- **THEN** cada entrada existe una sola vez y nada cambia

### Requirement: Vigencia por fecha
El sistema SHALL determinar qué versión de una entrada está vigente en una fecha del calendario de Ecuador: la que empieza en esa fecha o antes y termina en esa fecha o después, o no tiene fin. Una entrada sin versión vigente en esa fecha no está vigente.

#### Scenario: Último día de vigencia
- **WHEN** se consulta una entrada en el último día de su vigencia
- **THEN** la entrada está vigente

#### Scenario: Día siguiente al fin de la vigencia
- **WHEN** se consulta una entrada el día siguiente al fin de su vigencia
- **THEN** la entrada no está vigente

#### Scenario: Fecha anterior al inicio
- **WHEN** se consulta una entrada en una fecha anterior al inicio de su primera versión
- **THEN** la entrada no está vigente

### Requirement: Habilitación de entradas por empresa
El sistema SHALL permitir que un administrador habilite o deshabilite para su empresa las tarifas de IVA, los códigos de ICE e IRBPNR y las formas de pago. Por defecto, las tarifas de IVA y las formas de pago están habilitadas, y los códigos de ICE e IRBPNR, deshabilitados. La habilitación no cambia los datos oficiales ni lo ya registrado, y no aplica a los demás catálogos.

#### Scenario: Deshabilitar una tarifa
- **WHEN** un administrador deshabilita la tarifa de IVA del 14 %
- **THEN** esa tarifa deja de ofrecerse para su empresa y su entrada oficial no cambia

#### Scenario: Habilitar un código de ICE
- **WHEN** un administrador habilita un código de ICE
- **THEN** ese código se ofrece para su empresa

#### Scenario: Habilitación repetida
- **WHEN** un administrador habilita una entrada que ya está habilitada
- **THEN** nada cambia

#### Scenario: Catálogo sin habilitación por empresa
- **WHEN** un administrador intenta deshabilitar un tipo de identificación
- **THEN** el sistema rechaza la solicitud y nada cambia

#### Scenario: Cambios simultáneos de la misma entrada
- **WHEN** dos administradores cambian a la vez la habilitación de la misma entrada
- **THEN** la entrada queda en un único estado final y se registra un solo cambio por cada transición real

### Requirement: Política de consumidor final
El sistema SHALL conservar como dato versionado la política de consumidor final: el monto máximo para facturar sin identificar al comprador, su vigencia y su fuente. Este cambio solo la publica; no la aplica.

#### Scenario: Consulta de la política
- **WHEN** un usuario consulta la política de consumidor final
- **THEN** ve el monto máximo vigente con su fuente y su vigencia

### Requirement: Registro de esquemas XSD
El sistema SHALL mantener como dato versionado el registro de los esquemas XSD oficiales: tipo de comprobante, raíz, versión, archivo, hash SHA-256, fuente, fecha de descarga y si la aplicación soporta esa versión. Un esquema solo figura como registrado si su archivo coincide con su hash.

#### Scenario: Consulta del registro
- **WHEN** un administrador consulta los esquemas registrados
- **THEN** ve las versiones registradas de los seis comprobantes, con su hash y su fuente, y cuáles soporta la aplicación

#### Scenario: Archivo que no coincide con su hash
- **WHEN** el archivo de un esquema registrado no coincide con el hash del registro
- **THEN** la verificación del registro falla e identifica el esquema

### Requirement: Matriz de casos especiales
El sistema SHALL publicar la categoría de soporte de cada anexo de la ficha técnica: soportado en el alcance del MVP, condición del emisor, condición del go-live, no aplicable o fuera del MVP. Nadie la cambia desde la aplicación; cambiarla exige una versión nueva del producto.

#### Scenario: Consulta de la matriz
- **WHEN** un usuario consulta la matriz de casos especiales
- **THEN** ve los 26 anexos de la ficha con su tema y su categoría

#### Scenario: Anexo del RUC del proveedor
- **WHEN** un usuario consulta el anexo 26
- **THEN** figura como condición del go-live, no como funcionalidad ordinaria

#### Scenario: Intento de cambiar una categoría
- **WHEN** un administrador intenta cambiar la categoría de un anexo
- **THEN** el sistema rechaza la solicitud y la matriz no cambia

### Requirement: Permisos de los catálogos fiscales
El sistema SHALL permitir que administradores y operadores consulten los catálogos fiscales, la política de consumidor final, el registro de esquemas y la matriz de casos especiales. Solo un administrador SHALL cambiar la habilitación de entradas para su empresa.

#### Scenario: Operador consulta un catálogo
- **WHEN** un operador consulta las tarifas de IVA
- **THEN** ve las entradas y cuáles están habilitadas para su empresa

#### Scenario: Operador intenta cambiar la habilitación
- **WHEN** un operador intenta habilitar o deshabilitar una entrada
- **THEN** el sistema rechaza la solicitud por falta de permiso y nada cambia

### Requirement: Aislamiento de la habilitación por empresa
El sistema SHALL limitar la consulta y el cambio de la habilitación a la empresa del usuario autenticado. Un usuario no puede leer, cambiar ni deducir la habilitación de otra empresa.

#### Scenario: Habilitación de otra empresa
- **WHEN** el administrador de la empresa A deshabilita una tarifa
- **THEN** la empresa B sigue viéndola con su propia habilitación, sin ningún indicio del cambio de A

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un administrador incluye un identificador de empresa en una solicitud de habilitación
- **THEN** el sistema rechaza la solicitud y la habilitación de ninguna empresa cambia
