# inventory Specification

## Purpose

Existencias de los productos controlados contabilizadas por hechos fiscales autorizados: saldo de
partida, salida de cada factura al autorizar, entradas manuales, ajustes y kárdex, sin reservas de
disponibilidad.

## Requirements

### Requirement: Inventario contabilizado por hechos fiscales autorizados
El sistema SHALL llevar el stock de los productos controlados como existencias contabilizadas por hechos fiscales autorizados, nunca como una reserva de disponibilidad. Ninguna factura modifica el stock antes de entrar en `AUTHORIZED`, y una factura que no llega a ese estado nunca lo modifica.

#### Scenario: Estados anteriores o distintos de autorizado
- **WHEN** una factura de un producto con inventario pasa por reservada, firmada, recibida, verificando con el SRI o revisión manual, o termina devuelta o no autorizada
- **THEN** el saldo y el kárdex del producto no cambian, y no se registra ninguna compensación

#### Scenario: Transmisión apagada
- **WHEN** la transmisión al SRI está deshabilitada y se emiten facturas de un producto con inventario
- **THEN** esas facturas quedan pendientes y el saldo del producto no cambia

#### Scenario: Sin reservas
- **WHEN** un usuario guarda un borrador o emite una factura
- **THEN** el sistema no reserva ni compromete existencias

### Requirement: Un solo saldo por producto
El sistema SHALL llevar un único saldo por empresa y producto, sin bodegas, ubicaciones, lotes, series, caducidad ni valoración (ERS RF-315). El saldo es exactamente la suma de las variaciones de los movimientos del producto, sin redondeo.

#### Scenario: Ventas desde dos establecimientos
- **WHEN** una empresa factura el mismo producto desde dos establecimientos y ambas facturas se autorizan
- **THEN** las dos salidas afectan el mismo saldo

#### Scenario: Saldo igual a la suma del kárdex
- **WHEN** un usuario consulta un producto con varios movimientos con decimales
- **THEN** su saldo es exactamente la suma de las variaciones de su kárdex

### Requirement: Tipos de movimiento y su signo
Cada movimiento SHALL tener un tipo y una variación con signo: `INICIAL` mayor o igual que cero, `ENTRADA_MANUAL` positiva, `SALIDA_FACTURA` negativa y `AJUSTE` positiva o negativa, nunca cero salvo el `INICIAL` de cero. `DEVOLUCION_NC` es un tipo reconocido, pero ninguna operación lo registra todavía: la devolución por nota de crédito la define su propio cambio.

#### Scenario: Signo de cada movimiento
- **WHEN** se registran un `INICIAL` de 10, una entrada de 5, la salida de una factura de 3 unidades y un ajuste de -1
- **THEN** sus variaciones son 10, 5, -3 y -1, y el saldo es 11

#### Scenario: Sin devoluciones por nota de crédito
- **WHEN** un usuario o el sistema opera sobre el inventario
- **THEN** ninguna operación registra una devolución por nota de crédito

### Requirement: Inicialización del inventario de un producto
Un administrador SHALL inicializar el inventario de un producto marcado como controlado con un movimiento `INICIAL`, de cantidad mayor o igual que cero en el dominio de las cantidades. El `INICIAL` fija el saldo de partida y el inicio del kárdex, se registra junto con el saldo en una sola operación y existe a lo sumo una vez en toda la vida del inventario del producto.

#### Scenario: Inicializar
- **WHEN** un administrador inicializa con `12.5` un producto marcado como controlado
- **THEN** el producto tiene saldo `12.5` y su kárdex empieza con un `INICIAL` de `12.5`

#### Scenario: Inicializar en cero
- **WHEN** un administrador inicializa con `0` un producto marcado que no tiene existencias
- **THEN** el producto queda inicializado con saldo `0` y un `INICIAL` de `0`

#### Scenario: Cantidad inválida
- **WHEN** un administrador inicializa un producto con una cantidad negativa, con más de 6 decimales o enviada como número JSON
- **THEN** el sistema rechaza la solicitud y el producto sigue sin inicializar

#### Scenario: Producto sin marca de control
- **WHEN** un administrador inicializa un producto que no está marcado como controlado, o un servicio
- **THEN** el sistema rechaza la solicitud indicando que primero debe marcarse como controlado

#### Scenario: Segunda inicialización
- **WHEN** un administrador intenta inicializar un producto ya inicializado, también después de desactivar y reactivar su control
- **THEN** el sistema rechaza la solicitud, y el saldo y el kárdex no cambian

#### Scenario: Inicializaciones simultáneas
- **WHEN** dos administradores inicializan a la vez el mismo producto
- **THEN** exactamente una inicialización se aplica, la otra se rechaza y el kárdex tiene un solo `INICIAL`

### Requirement: Producto marcado sin inventario inicializado
Un producto marcado como controlado sin `INICIAL` SHALL quedar configurado pero sin inicializar: no tiene saldo, no registra movimientos y nunca se presenta con saldo cero. El inventario empieza en su `INICIAL`, sin reconstruir el pasado: ninguna factura autorizada antes de la inicialización genera movimientos.

#### Scenario: Producto marcado sin inicializar
- **WHEN** un usuario consulta un producto marcado como controlado que nadie inicializó
- **THEN** el producto aparece sin inicializar, sin saldo y sin movimientos

#### Scenario: Productos marcados antes del inventario
- **WHEN** el inventario se pone en marcha con productos que ya estaban marcados y facturas ya autorizadas
- **THEN** esos productos quedan sin inicializar y ninguna de esas facturas genera movimientos

### Requirement: Decisión de inventario congelada al emitir
Cada línea de una factura SHALL llevar, desde su reserva, la decisión de si afecta al inventario: sí solo si su producto estaba marcado como controlado y con inventario inicializado en ese momento. Esa decisión es la única fuente de la salida: nunca se consultan el producto ni el inventario vigentes al autorizar. Las facturas emitidas antes de que existiera esa decisión no afectan al inventario.

#### Scenario: Control desactivado entre la emisión y la autorización
- **WHEN** se emite una factura de 3 unidades de un producto con inventario activo y saldo 0, el administrador desactiva su control con saldo 0 y la factura se autoriza después
- **THEN** la factura registra su salida aunque el control esté desactivado, y el saldo queda en -3

#### Scenario: Factura emitida con el control desactivado
- **WHEN** se emite una factura de un producto con el control desactivado, el administrador lo reactiva y la factura se autoriza después
- **THEN** la decisión de la línea es que no afecta al inventario, y la factura no registra salida

#### Scenario: Control desactivado y reactivado antes de autorizar
- **WHEN** se emite una factura de un producto con inventario activo, el administrador desactiva su control con saldo 0, lo reactiva y la factura se autoriza después
- **THEN** la factura registra exactamente una salida

#### Scenario: Inventario inicializado después de emitir
- **WHEN** se emite una factura de un producto marcado sin inicializar, el administrador lo inicializa y la factura se autoriza después
- **THEN** la factura no registra salida

#### Scenario: Factura emitida antes del inventario
- **WHEN** se autoriza una factura emitida antes de que el sistema congelara esta decisión
- **THEN** la factura no registra movimientos

### Requirement: Salida de una factura al autorizar
Cuando una factura entra en `AUTHORIZED`, el sistema SHALL registrar en la misma operación que esa transición una sola salida por cada producto de sus líneas que afectan al inventario, con la suma exacta de sus cantidades restada del saldo. Un producto cuya suma es cero no genera salida. La salida referencia la factura y no se repite por reintentos, repeticiones ni reconciliaciones.

#### Scenario: Autorización
- **WHEN** se autoriza una factura con 3 unidades del producto A y 2 del producto B, ambos con inventario
- **THEN** existen una salida de -3 para A y una de -2 para B que referencian la factura, y sus saldos bajan en esas cantidades

#### Scenario: Mismo producto en varias líneas
- **WHEN** se autoriza una factura con dos líneas del producto A de `1.5` y `2.25`
- **THEN** existe una sola salida de `-3.75` para A

#### Scenario: Autorización por reconciliación
- **WHEN** una factura llega a autorizada por una reconciliación automática o manual
- **THEN** registra una salida por producto, igual que una autorización directa

#### Scenario: Repetición de la autorización
- **WHEN** la misma autorización se procesa otra vez por un reintento del trabajo, una repetición de la decisión o una reconciliación posterior
- **THEN** no se registra otra salida y el saldo no cambia

#### Scenario: Línea sin inventario
- **WHEN** una factura autorizada incluye un servicio, un producto sin marca de control o un producto sin inventario inicializado al emitir
- **THEN** esas líneas no generan movimientos

#### Scenario: Fallo al registrar la salida
- **WHEN** la salida de uno de los productos no puede registrarse
- **THEN** la factura no queda autorizada localmente y no queda la salida de ningún producto de esa factura

### Requirement: Recuperación de la salida tras un fallo local
Si el SRI autorizó una factura y la operación local que la autoriza y registra su salida falla, el sistema SHALL conservar la respuesta del SRI y volver a aplicar la autorización desde esa respuesta guardada, sin otra llamada de transmisión, hasta dejar la factura autorizada con una sola salida por producto.

#### Scenario: Fallo local y recuperación
- **WHEN** el SRI respondió `AUTORIZADO`, la respuesta quedó guardada y la operación local falló al registrar la salida
- **THEN** la factura sigue sin autorizar localmente
- **AND** al reintentarse, el sistema clasifica la respuesta guardada sin volver a llamar al SRI, la factura queda autorizada y existe una sola salida por producto

### Requirement: Saldo negativo permitido y visible
El inventario MUST NOT bloquear guardar un borrador, emitir, reservar el secuencial, firmar, transmitir ni autorizar. Una salida SHALL registrarse aunque el saldo quede negativo, y el saldo negativo se muestra tal cual: nunca se trunca a cero, se rechaza la salida ni se compensa con un ajuste. No altera el comprobante.

#### Scenario: Saldo que cruza cero
- **WHEN** un producto con saldo 2 recibe la salida de una factura autorizada de 5 unidades
- **THEN** la factura queda autorizada y el saldo queda en -3

#### Scenario: Emisión sin existencias
- **WHEN** un usuario emite una factura de un producto con saldo 0
- **THEN** la emisión no se rechaza por existencias

#### Scenario: Saldo negativo visible
- **WHEN** un usuario consulta un producto con saldo -3
- **THEN** el producto aparece con saldo -3, indicado como saldo negativo

### Requirement: Entradas manuales de existencias
Un usuario con permiso SHALL registrar una entrada manual en un producto con inventario inicializado y control activo, con una cantidad mayor que cero en el dominio de las cantidades y una nota opcional. La entrada suma su cantidad al saldo y guarda su actor, su nota y su momento.

#### Scenario: Entrada
- **WHEN** un operador registra una entrada de 10 unidades en un producto con saldo 4
- **THEN** el saldo queda en 14 y el kárdex muestra la entrada con el operador como actor

#### Scenario: Cantidad cero o negativa
- **WHEN** un usuario registra una entrada de 0 o de -2
- **THEN** el sistema rechaza la solicitud y el saldo no cambia

#### Scenario: Producto sin inventario activo
- **WHEN** un usuario registra una entrada en un producto sin inicializar o con el control desactivado
- **THEN** el sistema rechaza la solicitud indicando el estado del producto

### Requirement: Ajustes de existencias
Un administrador SHALL registrar un ajuste positivo o negativo, distinto de cero, con un motivo obligatorio, en un producto con inventario inicializado y control activo. El ajuste suma su variación al saldo aunque quede negativo, y guarda su actor, su motivo y su momento.

#### Scenario: Ajuste negativo
- **WHEN** un administrador registra un ajuste de -4 con el motivo "Merma por rotura" en un producto con saldo 3
- **THEN** el saldo queda en -1 y el kárdex muestra el ajuste con su motivo y su actor

#### Scenario: Ajuste sin motivo o de cero
- **WHEN** un administrador registra un ajuste sin motivo, o de cero
- **THEN** el sistema rechaza la solicitud y el saldo no cambia

### Requirement: Idempotencia de las entradas y los ajustes
Cada entrada y cada ajuste SHALL llevar una clave de idempotencia, con alcance empresa, operación (entrada o ajuste) y clave, y el sistema guarda la huella canónica de la solicitud: producto, cantidad o variación exacta, y nota o motivo. La misma clave con la misma huella devuelve el mismo movimiento; con otra huella se rechaza. La clave no caduca.

#### Scenario: Doble envío
- **WHEN** la misma entrada, o el mismo ajuste, con la misma clave llega dos veces, también a la vez
- **THEN** se registra un solo movimiento, y la repetición responde con ese mismo movimiento

#### Scenario: Clave reutilizada con otra solicitud
- **WHEN** un usuario reutiliza la clave de una entrada con otra cantidad, o la de un ajuste con otro motivo
- **THEN** el sistema rechaza la solicitud indicando que la clave ya se usó con otra solicitud, y el saldo no cambia

#### Scenario: Misma cantidad escrita de otra forma
- **WHEN** una entrada de `10` y su repetición de `10.00` llegan con la misma clave
- **THEN** se tratan como la misma solicitud y se registra un solo movimiento

#### Scenario: Misma clave en una entrada y en un ajuste
- **WHEN** un administrador usa la misma clave en una entrada y después en un ajuste
- **THEN** se registran los dos movimientos, porque la operación forma parte del alcance de la clave

#### Scenario: Misma clave en otra empresa
- **WHEN** un usuario de la empresa B usa una clave que ya usó la empresa A
- **THEN** la entrada de la empresa B se registra, sin relación con la de A

#### Scenario: Sin clave de idempotencia
- **WHEN** un usuario registra una entrada o un ajuste sin clave de idempotencia
- **THEN** el sistema rechaza la solicitud y no registra nada

### Requirement: Movimientos inmutables
Los movimientos MUST NOT editarse ni borrarse, y una corrección SHALL registrarse con otro movimiento. No existe ninguna operación para fijar ni recalcular el saldo fuera de los movimientos.

#### Scenario: Intento de modificar un movimiento
- **WHEN** cualquier operación intenta cambiar o borrar un movimiento
- **THEN** el sistema lo impide y el movimiento no cambia

#### Scenario: Corrección de una entrada equivocada
- **WHEN** un administrador corrige una entrada de 10 que debía ser de 1
- **THEN** registra un ajuste de -9, y la entrada original sigue en el kárdex

### Requirement: Saldo exacto con operaciones simultáneas
El sistema SHALL aplicar cada movimiento al saldo de forma atómica: operaciones simultáneas sobre el mismo producto registran todos sus movimientos y dejan un saldo final exacto, sin perder ninguna actualización, y las facturas con varios productos no se bloquean entre sí.

#### Scenario: Dos autorizaciones simultáneas
- **WHEN** dos facturas de 2 y 3 unidades del mismo producto, con saldo 1, se autorizan a la vez
- **THEN** existen las dos salidas y el saldo queda en -4

#### Scenario: Productos en orden inverso
- **WHEN** una factura con los productos A y B y otra con B y A se autorizan a la vez
- **THEN** ambas quedan autorizadas con sus salidas, sin bloquearse entre sí

#### Scenario: Entrada y salida simultáneas
- **WHEN** una entrada de 10 y la salida de una factura de 4 unidades llegan a la vez sobre un producto con saldo 0
- **THEN** el saldo queda en 6 y el kárdex muestra ambos movimientos

### Requirement: Desactivación y reactivación del control
Solo un administrador SHALL desactivar o reactivar el control de stock de un producto con inventario inicializado, y solo desactivarlo con saldo cero. Desactivar solo hace que las emisiones nuevas no afecten al inventario: no cancela las salidas ya congeladas en facturas emitidas antes. Ambas operaciones conservan el kárdex y el saldo; reactivar continúa el mismo kárdex, sin otro `INICIAL`.

#### Scenario: Desactivar con saldo cero
- **WHEN** un administrador desactiva el control de un producto inicializado con saldo 0
- **THEN** el producto queda con el control desactivado, y su saldo y su kárdex se conservan

#### Scenario: Desactivar con saldo distinto de cero
- **WHEN** un administrador intenta desactivar el control de un producto con saldo 5 o con saldo -2
- **THEN** el sistema rechaza la solicitud indicando el saldo, y el control sigue activo

#### Scenario: Reactivar
- **WHEN** un administrador reactiva el control de un producto desactivado
- **THEN** el producto continúa con el mismo saldo y el mismo kárdex, sin un nuevo `INICIAL`

#### Scenario: Repetir el estado actual
- **WHEN** un administrador desactiva el control de un producto que ya lo tiene desactivado
- **THEN** nada cambia

### Requirement: Kárdex de un producto
El sistema SHALL mostrar el kárdex de un producto con inventario: sus movimientos en un rango de fechas, del más reciente al más antiguo y paginados, cada uno con su tipo, su variación, el saldo resultante, su momento, su origen (usuario o sistema), su actor y, cuando lo tiene, la factura o el motivo.

#### Scenario: Kárdex de un mes
- **WHEN** un usuario consulta el kárdex de un producto entre el 1 y el 31 de octubre
- **THEN** ve solo los movimientos de ese rango, los más recientes primero, con el saldo después de cada uno

#### Scenario: Salida de una factura en el kárdex
- **WHEN** un usuario consulta un kárdex con la salida de una factura
- **THEN** la salida muestra el número de la factura y el sistema como origen

#### Scenario: Rango de fechas inválido
- **WHEN** un usuario consulta el kárdex con la fecha final anterior a la inicial
- **THEN** el sistema rechaza la consulta sin buscar movimientos

### Requirement: Lista de inventario
El sistema SHALL listar, paginados, los productos marcados como controlados y los que tienen inventario, con su estado (marcado sin inicializar, inicializado con control activo o inicializado con control desactivado), su saldo si está inicializado y si es negativo, con búsqueda por código o nombre y filtro por estado. Un producto sin inicializar nunca se muestra con saldo cero.

#### Scenario: Estados de la lista
- **WHEN** una empresa tiene un producto marcado sin inicializar, uno activo con saldo 8, uno activo con saldo -1 y uno con el control desactivado
- **THEN** la lista muestra los cuatro con su estado; el primero sin saldo, y el tercero indicado como saldo negativo

#### Scenario: Filtro de saldo negativo
- **WHEN** un usuario filtra la lista por saldo negativo
- **THEN** solo aparecen los productos inicializados con saldo menor que cero

#### Scenario: Producto sin control ni inventario
- **WHEN** un producto no está marcado como controlado y nunca tuvo inventario
- **THEN** no aparece en la lista de inventario

### Requirement: Permisos del inventario
Administradores y operadores SHALL consultar el inventario y registrar entradas manuales. Solo un administrador SHALL inicializar un inventario, registrar un ajuste y activar o desactivar el control de un producto con inventario inicializado. El servidor aplica estos permisos en cada operación, no solo la interfaz.

#### Scenario: Operador registra una entrada
- **WHEN** un operador registra una entrada válida
- **THEN** la entrada se registra

#### Scenario: Operador intenta una operación de administrador
- **WHEN** un operador intenta inicializar un inventario, registrar un ajuste o desactivar un control
- **THEN** el sistema rechaza la solicitud por falta de permiso, y nada cambia

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión consulta o cambia el inventario
- **THEN** el sistema responde no autenticado

### Requirement: Aislamiento del inventario por empresa
El sistema SHALL limitar la consulta y los movimientos del inventario a la empresa del usuario autenticado, que se deriva de su sesión. Un usuario no puede leer, cambiar ni deducir el saldo, el kárdex ni los movimientos de los productos de otra empresa.

#### Scenario: Producto de otra empresa
- **WHEN** un usuario de la empresa A consulta, inicializa, registra una entrada o un ajuste, o cambia el control de un producto de la empresa B
- **THEN** el sistema responde igual que ante un producto inexistente, y nada de la empresa B cambia

#### Scenario: Lista aislada
- **WHEN** la empresa B tiene productos con saldo negativo
- **THEN** la lista y sus filtros que ve la empresa A no los incluyen

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un usuario incluye un identificador de empresa en el cuerpo de una inicialización, una entrada o un ajuste
- **THEN** el sistema rechaza la solicitud y no registra nada
