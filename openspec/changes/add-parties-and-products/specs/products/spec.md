# Spec Delta

## Purpose

Permite a cada empresa mantener su catálogo de productos y servicios, con precio unitario exacto
sin impuestos e impuestos referidos al catálogo fiscal, y saber en todo momento si su
configuración tributaria sigue lista para emitir.

## ADDED Requirements

### Requirement: Catálogo de productos y servicios
El sistema SHALL permitir registrar en la empresa ítems como bien o servicio, con código principal opcional, código auxiliar opcional, ambos de 1 a 25 caracteres sin saltos de línea, nombre de 1 a 300 caracteres, que es la descripción del ítem en los comprobantes, descripción interna opcional de hasta 1000 caracteres, precio unitario e impuestos.

#### Scenario: Alta de un bien
- **WHEN** un usuario registra el bien "Cemento 50 kg" con código principal `CEM-50`, precio `8.75` e IVA 15 %
- **THEN** el producto existe en su empresa, activo, con esos datos

#### Scenario: Servicio sin código principal
- **WHEN** un usuario registra el servicio "Instalación" sin código principal
- **THEN** el servicio se crea

#### Scenario: Datos fuera de sus límites
- **WHEN** un usuario registra un producto sin nombre, con un código de más de 25 caracteres o con un salto de línea en un código
- **THEN** el sistema rechaza la solicitud indicando el campo, y no se crea ningún producto

### Requirement: Precio unitario exacto sin impuestos
El precio unitario SHALL ser el precio antes de impuestos, como decimal exacto en texto: no negativo, con como máximo 6 decimales y 12 dígitos enteros (18 dígitos en total, nunca 18 enteros más 6 decimales), sin exponente, coma decimal, separadores, ceros a la izquierda ni espacios. El sistema MUST rechazar un número JSON y un valor con más decimales de los admitidos, sin redondearlo, y devuelve el precio en su forma exacta más corta. Este cambio no calcula impuestos ni totales.

#### Scenario: Precio con seis decimales
- **WHEN** un usuario registra un producto con precio `0.123456`
- **THEN** el producto conserva y devuelve exactamente `0.123456`

#### Scenario: Límite superior exacto
- **WHEN** un usuario registra un precio `999999999999.999999`
- **THEN** el producto conserva y devuelve exactamente ese valor

#### Scenario: Trece dígitos enteros
- **WHEN** un usuario registra un precio `1000000000000`
- **THEN** el sistema rechaza la solicitud indicando el máximo de 12 dígitos enteros

#### Scenario: Más decimales de los admitidos
- **WHEN** un usuario registra un precio `1.1234567` o `1.1234560`
- **THEN** el sistema rechaza la solicitud indicando el máximo de 6 decimales, y no redondea el valor

#### Scenario: Precio como número JSON
- **WHEN** un usuario envía el precio como el número JSON `12.5`
- **THEN** el sistema rechaza la solicitud y pide el precio como texto decimal

#### Scenario: Precio negativo o con formato no admitido
- **WHEN** un usuario envía el precio `-1`, `1e3`, `1,50` o `01.5`
- **THEN** el sistema rechaza la solicitud, y no se crea ningún producto

#### Scenario: Forma exacta más corta
- **WHEN** un usuario registra un precio `12.50`
- **THEN** el producto devuelve el precio `12.5`

#### Scenario: Precio sin impuestos
- **WHEN** un usuario registra un producto con precio `10` e IVA 15 %
- **THEN** el producto muestra el precio `10` y no calcula ningún impuesto ni total

### Requirement: Impuestos del producto referidos al catálogo fiscal
Cada producto SHALL referir exactamente una tarifa de IVA, como máximo un código de ICE y como máximo un código de IRBPNR, este solo en bienes. Cada referencia identifica una entrada del catálogo fiscal por su catálogo y su identidad de entrada, nunca por su denominación ni su porcentaje, y el producto no copia ninguna tarifa. Al asignar o cambiar una referencia, la entrada SHALL existir, tener versión aplicable en la fecha de la operación en Ecuador y estar habilitada para la empresa.

#### Scenario: Producto con IVA 15 %
- **WHEN** un usuario registra un producto con la tarifa de IVA de código 4
- **THEN** el producto refiere esa entrada, y al consultarlo muestra la denominación y el porcentaje que publica el catálogo fiscal

#### Scenario: Producto sin IVA
- **WHEN** un usuario registra un producto sin tarifa de IVA
- **THEN** el sistema rechaza la solicitud indicando que el IVA es obligatorio

#### Scenario: Más de un ICE
- **WHEN** un usuario registra un producto con dos códigos de ICE
- **THEN** el sistema rechaza la solicitud, y no se crea ningún producto

#### Scenario: IRBPNR en un servicio
- **WHEN** un usuario registra un servicio con un código de IRBPNR
- **THEN** el sistema rechaza la solicitud indicando que el IRBPNR solo aplica a bienes

#### Scenario: Entrada deshabilitada para la empresa
- **WHEN** un usuario asigna un código de ICE que su empresa no ha habilitado
- **THEN** el sistema rechaza la solicitud indicando el impuesto, y después de que un administrador lo habilite, la misma asignación se acepta

#### Scenario: Entrada sin versión aplicable hoy
- **WHEN** un usuario asigna una entrada del catálogo fiscal que no tiene versión aplicable en la fecha de hoy en Ecuador
- **THEN** el sistema rechaza la solicitud indicando el impuesto

#### Scenario: Referencia por porcentaje o denominación
- **WHEN** un usuario envía como impuesto un porcentaje o una denominación en lugar de la identidad de una entrada
- **THEN** el sistema rechaza la solicitud

#### Scenario: Variante de un código repetido
- **WHEN** un usuario asigna la entrada de ICE de cerveza industrial de gran escala, cuyo código 3041 comparten otras entradas
- **THEN** el producto refiere exactamente esa entrada y no las otras del código 3041

### Requirement: Estado de la configuración tributaria
El sistema SHALL mostrar con cada producto un estado derivado de sus referencias fiscales en la fecha de hoy en Ecuador. Es `REVIEW_REQUIRED` si una referencia no tiene versión aplicable, fue retirada o no está habilitada para la empresa; `INCOMPLETE` si todas son utilizables pero alguna carece en el catálogo de datos para calcular su impuesto; y `READY` en otro caso. Indica el motivo de cada referencia afectada y nunca cambia las referencias.

#### Scenario: Producto listo
- **WHEN** un usuario consulta un producto con IVA 15 % y sin ICE ni IRBPNR
- **THEN** su estado es `READY`

#### Scenario: Entrada deshabilitada después de asignarla
- **WHEN** un administrador deshabilita la tarifa de IVA que usa un producto
- **THEN** el producto pasa a `REVIEW_REQUIRED` con el motivo de la tarifa deshabilitada, conserva su referencia, y vuelve a `READY` si la tarifa se habilita otra vez

#### Scenario: Entrada que deja de estar vigente
- **WHEN** una versión posterior de los catálogos cierra la vigencia de la tarifa que usa un producto
- **THEN** a partir del día siguiente al cierre el producto está en `REVIEW_REQUIRED`, y su referencia no cambia

#### Scenario: Código de ICE sin tarifa transcrita
- **WHEN** un usuario consulta un producto con un código de ICE habilitado, cuya tarifa el catálogo no publica
- **THEN** su estado es `INCOMPLETE`, con el motivo de que faltan los datos para calcular el ICE, y no `REVIEW_REQUIRED`

#### Scenario: Código de IRBPNR sin valor transcrito
- **WHEN** un usuario consulta un bien con el código de IRBPNR habilitado, cuyo valor el catálogo no publica
- **THEN** su estado es `INCOMPLETE`, con el motivo de que faltan los datos para calcular el IRBPNR

#### Scenario: IVA diferenciado
- **WHEN** un usuario consulta un producto con la tarifa de IVA diferenciado, que no tiene porcentaje en el catálogo
- **THEN** su estado es `INCOMPLETE`

#### Scenario: Filtro por estado
- **WHEN** un usuario filtra los productos por `REVIEW_REQUIRED`
- **THEN** obtiene solo los productos que hoy necesitan revisión, con el total

#### Scenario: Corrección sin tocar los impuestos
- **WHEN** un usuario corrige el precio de un producto en `REVIEW_REQUIRED` sin cambiar sus impuestos
- **THEN** la corrección se acepta, sus referencias no cambian y el producto sigue en `REVIEW_REQUIRED`

### Requirement: Control de stock solo como dato de los bienes
El sistema SHALL permitir marcar un bien como controlado en stock, nunca un servicio. La marca no crea existencias, no registra movimientos, no bloquea ventas ni crea un kárdex.

#### Scenario: Bien con control de stock
- **WHEN** un usuario marca un bien como controlado en stock
- **THEN** el bien queda marcado, sin existencias ni movimientos

#### Scenario: Servicio con control de stock
- **WHEN** un usuario marca un servicio como controlado en stock
- **THEN** el sistema rechaza la solicitud indicando que solo los bienes llevan control de stock

### Requirement: Coherencia entre el tipo, el control de stock y el IRBPNR
Un servicio MUST NOT llevar control de stock ni IRBPNR. Cada alta y cada corrección SHALL validarse con el estado final que resulta de la solicitud, aunque solo cambie el tipo: un bien pasa a servicio solo si la misma solicitud deja su IRBPNR vacío y su control de stock desactivado.

#### Scenario: Bien con IRBPNR que pasa a servicio
- **WHEN** un usuario corrige a servicio un bien con IRBPNR y conserva el IRBPNR
- **THEN** el sistema rechaza la solicitud indicando que debe quitar el IRBPNR, y el producto no cambia

#### Scenario: Bien controlado en stock que pasa a servicio
- **WHEN** un usuario corrige a servicio un bien controlado en stock y conserva el control de stock
- **THEN** el sistema rechaza la solicitud indicando que debe quitar el control de stock, y el producto no cambia

#### Scenario: Paso a servicio corregido en la misma solicitud
- **WHEN** un usuario corrige a servicio un bien con IRBPNR y control de stock, y en la misma solicitud quita el IRBPNR y desactiva el control de stock
- **THEN** la corrección se acepta y el producto queda como servicio sin IRBPNR ni control de stock

### Requirement: Código principal único por empresa
El sistema SHALL impedir que dos productos de una misma empresa tengan el mismo código principal, también cuando uno está desactivado. La comparación es exacta, después de quitar los espacios de los extremos. Los productos sin código principal no chocan entre sí, y el mismo código puede existir en otra empresa.

#### Scenario: Código principal repetido
- **WHEN** un usuario registra un producto con un código principal que ya tiene otro producto de su empresa
- **THEN** el sistema rechaza la solicitud indicando que el código está en uso, y no se crea otro producto

#### Scenario: Altas simultáneas con el mismo código
- **WHEN** dos usuarios registran a la vez un producto con el mismo código principal en la misma empresa
- **THEN** existe exactamente un producto con ese código, y la otra solicitud recibe el rechazo por código en uso

#### Scenario: Productos sin código principal
- **WHEN** un usuario registra dos productos sin código principal
- **THEN** ambos se crean

#### Scenario: Mismo código en otra empresa
- **WHEN** usuarios de dos empresas registran un producto con el mismo código principal
- **THEN** cada empresa tiene su propio producto

### Requirement: Corrección de un producto
El sistema SHALL permitir corregir los datos, el precio y los impuestos de un producto, solo a partir de la versión que el usuario consultó.

#### Scenario: Corrección
- **WHEN** un usuario corrige el precio y el nombre de un producto con la versión vigente
- **THEN** el producto queda con los datos nuevos

#### Scenario: Versión desactualizada
- **WHEN** un usuario corrige un producto que otro usuario cambió después de su consulta
- **THEN** el sistema rechaza la solicitud indicando que el producto cambió, y el producto conserva los datos del otro usuario

#### Scenario: Correcciones simultáneas
- **WHEN** dos usuarios corrigen a la vez el mismo producto a partir de la misma versión
- **THEN** se aplica exactamente una de las correcciones, y la otra recibe el rechazo por cambio concurrente

### Requirement: Desactivación y reactivación de productos
El sistema SHALL permitir desactivar y reactivar productos, nunca borrarlos. Un producto desactivado conserva sus datos, no aparece en las búsquedas de productos activos y se encuentra al filtrar por desactivados. Repetir el estado actual no cambia nada.

#### Scenario: Desactivar un producto
- **WHEN** un administrador desactiva un producto
- **THEN** el producto deja de aparecer en las búsquedas de productos activos y conserva sus datos

#### Scenario: Reactivar un producto
- **WHEN** un administrador reactiva un producto desactivado
- **THEN** el producto vuelve a aparecer en las búsquedas de productos activos

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un producto que ya está desactivado
- **THEN** nada cambia

### Requirement: Búsqueda y paginación de productos
El sistema SHALL buscar productos por el inicio de su código principal o auxiliar, o por un fragmento de su nombre, sin distinguir mayúsculas, minúsculas ni tildes. Se puede filtrar por estado, activos por defecto, por tipo y por estado de la configuración tributaria. El resultado se pagina, con 25 productos por página por defecto y como máximo 100, indica el total y sigue un orden estable con desempate.

#### Scenario: Búsqueda por código
- **WHEN** un usuario busca `cem`
- **THEN** obtiene los productos activos cuyo código principal o auxiliar empieza por `CEM` o `cem`

#### Scenario: Búsqueda por nombre sin tildes
- **WHEN** un usuario busca "cafe"
- **THEN** obtiene los productos activos cuyo nombre contiene "Café"

#### Scenario: Orden estable entre páginas
- **WHEN** varios productos tienen el mismo nombre y un usuario recorre todas las páginas del resultado
- **THEN** cada producto aparece exactamente una vez y en el mismo orden en cada consulta

### Requirement: Productos afectados por la habilitación de entradas fiscales
La pantalla `Catálogos fiscales` SHALL mostrar cuántos productos activos usan cada entrada que admite habilitación y cuántos productos necesitan revisión tributaria. Antes de que un administrador deshabilite una entrada que usan productos activos, el sistema SHALL pedir confirmación indicando cuántos productos pasarán a necesitar revisión. Deshabilitar no se bloquea.

#### Scenario: Entrada en uso
- **WHEN** un usuario consulta la tarifa de IVA del 12 % que usan tres productos activos
- **THEN** ve que la usan tres productos activos

#### Scenario: Deshabilitar una entrada en uso
- **WHEN** un administrador deshabilita esa tarifa
- **THEN** el sistema pide confirmación indicando que tres productos pasarán a necesitar revisión
- **AND** si confirma, la tarifa queda deshabilitada y los tres productos quedan en `REVIEW_REQUIRED`; si cancela, nada cambia

#### Scenario: Entrada sin uso
- **WHEN** un administrador deshabilita una entrada que ningún producto activo usa
- **THEN** la entrada se deshabilita sin confirmación adicional

#### Scenario: Productos desactivados
- **WHEN** solo productos desactivados usan una entrada
- **THEN** el recuento de productos activos de esa entrada es cero

### Requirement: Permisos de productos
El sistema SHALL permitir que administradores y operadores consulten, registren y corrijan productos. Solo un administrador SHALL desactivar o reactivar un producto.

#### Scenario: Operador registra un producto
- **WHEN** un operador registra un producto válido
- **THEN** el producto se crea

#### Scenario: Operador intenta desactivar
- **WHEN** un operador intenta desactivar o reactivar un producto
- **THEN** el sistema rechaza la solicitud por falta de permiso, y nada cambia

### Requirement: Aislamiento de los productos por empresa
El sistema SHALL limitar la consulta y el cambio de productos a la empresa del usuario autenticado, que se deriva de su sesión. Un usuario no puede leer, cambiar ni deducir la existencia de los productos de otra empresa, ni de sus recuentos.

#### Scenario: Producto de otra empresa
- **WHEN** un usuario de la empresa A consulta, corrige o desactiva un producto de la empresa B por su identificador
- **THEN** el sistema responde igual que ante un producto inexistente, y el producto de B no cambia

#### Scenario: Recuentos aislados
- **WHEN** la empresa B tiene productos que usan una tarifa
- **THEN** los recuentos de uso y de revisión que ve la empresa A no los incluyen

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un usuario incluye un identificador de empresa en el cuerpo de un alta o de una corrección
- **THEN** el sistema rechaza la solicitud, y no se crea ni cambia ningún producto
