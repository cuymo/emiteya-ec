# fiscal-numbering Specification

## Purpose

Asigna a cada comprobante un secuencial de nueve dígitos que nunca se duplica ni se reutiliza,
con una numeración independiente por ambiente, establecimiento, punto de emisión y tipo de
comprobante, y permite al administrador fijar el siguiente valor de forma controlada y auditada.

## Requirements

### Requirement: Contador por ambiente, establecimiento, punto y tipo
El sistema SHALL mantener un contador de secuenciales independiente por empresa, ambiente, establecimiento, punto de emisión y tipo de comprobante: factura, liquidación de compra, nota de crédito, nota de débito, guía de remisión y comprobante de retención. Una reserva en un contador no altera ningún otro, y cambiar de ambiente no comparte ni reinicia ninguna secuencia.

#### Scenario: Tipos independientes
- **WHEN** se reservan dos secuenciales de factura y luego uno de nota de crédito en el mismo punto y ambiente
- **THEN** las facturas reciben los secuenciales 1 y 2, y la nota de crédito el 1

#### Scenario: Puntos independientes
- **WHEN** se reserva un secuencial de factura en el punto `001-001` y otro en el punto `001-002`
- **THEN** cada uno recibe el secuencial 1

#### Scenario: Ambientes independientes
- **WHEN** se reservan tres facturas en `Pruebas` y la empresa pasa a `Producción`
- **THEN** la primera factura en `Producción` recibe el secuencial 1

#### Scenario: Volver a un ambiente
- **WHEN** después de emitir en `Producción` la empresa vuelve a `Pruebas` y se reserva otra factura
- **THEN** recibe el secuencial 4, a continuación de la secuencia de `Pruebas`

### Requirement: Valor inicial de un contador
El sistema SHALL asignar el secuencial 1 en la primera reserva de un contador que nunca reservó ni se ajustó. Si el administrador fijó el siguiente valor antes de la primera reserva, esa reserva recibe el valor fijado.

#### Scenario: Primer secuencial
- **WHEN** se reserva por primera vez un secuencial de factura en un punto y ambiente
- **THEN** recibe el secuencial 1

#### Scenario: Continuar la numeración de un sistema anterior
- **WHEN** el administrador fija en 1501 el siguiente secuencial de factura de un punto en `Producción`, antes de reservar ninguno
- **THEN** la primera reserva recibe el secuencial 1501

### Requirement: Reserva atómica sin duplicados
El sistema SHALL reservar el siguiente secuencial de un contador de forma atómica, de modo que cada reserva confirmada reciba un número distinto, también cuando muchas reservas ocurren a la vez desde varios procesos o instancias.

#### Scenario: Reservas concurrentes
- **WHEN** se confirman 120 reservas simultáneas en el mismo contador, que empieza en 1
- **THEN** las 120 reciben números distintos, del 1 al 120

#### Scenario: Reservas desde varias instancias
- **WHEN** dos instancias del sistema reservan a la vez en el mismo contador
- **THEN** ningún número se asigna dos veces

### Requirement: Un número reservado no se reutiliza
Un secuencial queda reservado cuando la operación que lo reserva se confirma. El sistema SHALL no volver a asignar nunca un número reservado, aunque falle lo que ocurra después con el comprobante. Si la operación que reserva se revierte antes de confirmarse, el número no queda reservado.

#### Scenario: Falla posterior a la reserva
- **WHEN** se reserva el secuencial 7 y luego falla un paso posterior de la emisión
- **THEN** la siguiente reserva del contador recibe el 8 y el 7 no vuelve a asignarse
- **AND** el hueco en la numeración se tolera

#### Scenario: Reversión antes de confirmar
- **WHEN** la operación que reservaría el secuencial 7 se revierte antes de confirmarse
- **THEN** el 7 no queda reservado y la siguiente reserva confirmada lo recibe

### Requirement: Formato del secuencial y del número del comprobante
El sistema SHALL representar el secuencial con nueve dígitos, con ceros a la izquierda, y el número completo del comprobante como `EEE-PPP-SSSSSSSSS`: código del establecimiento, código del punto de emisión y secuencial.

#### Scenario: Representación
- **WHEN** se reserva el secuencial 1 en el punto `002` del establecimiento `001`
- **THEN** el secuencial se representa como `000000001` y el número como `001-002-000000001`

### Requirement: Límite de nueve dígitos
El sistema SHALL rechazar una reserva en un contador cuyo último secuencial reservado es 999999999, sin reiniciar el contador ni reutilizar números, e indicar que la numeración de ese punto y tipo se agotó en ese ambiente.

#### Scenario: Último secuencial posible
- **WHEN** el siguiente secuencial de un contador es 999999999 y se reserva
- **THEN** la reserva recibe el 999999999

#### Scenario: Numeración agotada
- **WHEN** se intenta reservar en ese contador después del 999999999
- **THEN** el sistema rechaza la reserva e indica que la numeración se agotó
- **AND** el contador no se reinicia y los demás contadores siguen reservando

### Requirement: Reserva solo en puntos disponibles
El sistema SHALL rechazar la reserva de un secuencial en un punto de emisión que no está disponible, porque él o su establecimiento están inactivos, sin consumir ningún número. Una reserva comienza cuando comprueba la disponibilidad del punto: si en ese momento el punto y su establecimiento estaban activos, la reserva puede completarse aunque una desactivación se confirme mientras está en curso.

#### Scenario: Punto inactivo
- **WHEN** se intenta reservar en un punto de emisión inactivo
- **THEN** el sistema rechaza la reserva y el contador no cambia

#### Scenario: Establecimiento inactivo
- **WHEN** se intenta reservar en un punto activo de un establecimiento inactivo
- **THEN** el sistema rechaza la reserva y el contador no cambia

#### Scenario: Reactivación
- **WHEN** el punto vuelve a estar disponible y se reserva
- **THEN** la reserva continúa la secuencia donde quedó

#### Scenario: Desactivación durante una reserva en curso
- **WHEN** una reserva comenzó con el punto y su establecimiento activos, y una desactivación del punto se confirma antes de que la reserva termine
- **THEN** la reserva se completa y su número queda reservado
- **AND** la siguiente reserva en ese punto se rechaza sin consumir número

#### Scenario: Reserva que comienza después de la desactivación
- **WHEN** una reserva comienza después de que la desactivación del punto se confirmó
- **THEN** el sistema la rechaza y el contador no cambia

### Requirement: Consulta de los secuenciales
El sistema SHALL permitir al administrador consultar, para cualquiera de los dos ambientes, el siguiente secuencial y el último reservado de cada tipo de comprobante en cada punto de emisión de su empresa, incluidos los puntos no disponibles. La interfaz SHALL mostrarlos en Establecimientos, dentro de cada punto de emisión, solo para el ambiente vigente de la empresa: en Pruebas, los de Pruebas; en Producción, los de Producción.

#### Scenario: Empresa sin reservas
- **WHEN** un administrador consulta los secuenciales de `Producción` de una empresa con un punto de emisión
- **THEN** ve los seis tipos de comprobante de ese punto con el siguiente secuencial 1 y sin números reservados

#### Scenario: Ambientes por separado
- **WHEN** se reservaron facturas en `Pruebas` y el administrador consulta `Producción`
- **THEN** ve los valores de `Producción`, que no cambiaron

#### Scenario: Interfaz en el ambiente vigente
- **WHEN** la empresa emite en `Producción` y el administrador despliega los secuenciales de un punto en Establecimientos
- **THEN** ve los contadores de `Producción` de ese punto, sin un selector de ambiente

#### Scenario: Contador agotado
- **WHEN** el último secuencial reservado de un contador es 999999999
- **THEN** el administrador ve ese contador como agotado, con el último reservado 999999999 y sin siguiente secuencial

### Requirement: Ajuste del siguiente secuencial
El sistema SHALL permitir que un administrador fije el siguiente secuencial de un contador con un número entero entre 1 y 999999999, mayor que el último número reservado de ese contador. Avanzar el valor deja sin usar los números intermedios. El ajuste rige para las reservas siguientes, también en un punto no disponible.

#### Scenario: Avanzar el siguiente secuencial
- **WHEN** el siguiente secuencial es 10 y el administrador lo fija en 100
- **THEN** la siguiente reserva recibe el 100 y los números del 10 al 99 no se asignan

#### Scenario: Valor que no supera al último reservado
- **WHEN** el último secuencial reservado es 50 y el administrador intenta fijar el siguiente en 50 o en un número menor
- **THEN** el sistema rechaza el ajuste, indica el último número reservado y el contador no cambia

#### Scenario: Valor fuera de rango
- **WHEN** el administrador intenta fijar el siguiente secuencial en 0, en 1000000000 o en un número no entero
- **THEN** el sistema rechaza el ajuste e indica el rango admitido

#### Scenario: Mismo valor
- **WHEN** el administrador fija el siguiente secuencial en el valor que ya tiene
- **THEN** el contador no cambia

#### Scenario: Ajuste sobre un valor que cambió
- **WHEN** el administrador prepara un ajuste viendo el siguiente secuencial 10 y, antes de confirmarlo, una reserva lo avanza a 11
- **THEN** el sistema rechaza el ajuste con un conflicto que pide recargar, y el contador queda en 11

#### Scenario: Punto no disponible
- **WHEN** el administrador ajusta el siguiente secuencial de un punto inactivo
- **THEN** el ajuste se aplica y rige cuando el punto vuelva a estar disponible

#### Scenario: Contador agotado
- **WHEN** el administrador intenta ajustar un contador agotado
- **THEN** el sistema rechaza el ajuste e indica que la numeración se agotó

### Requirement: Retroceso explícito del siguiente secuencial
El sistema SHALL exigir una confirmación explícita con un motivo para fijar el siguiente secuencial en un valor menor que el vigente, y SHALL rechazar siempre un valor igual o menor que el último número reservado.

#### Scenario: Retroceder sin motivo
- **WHEN** el siguiente secuencial es 1000, el último reservado es 50 y el administrador intenta fijarlo en 100 sin indicar un motivo
- **THEN** el sistema rechaza el ajuste e indica que retroceder exige un motivo

#### Scenario: Retroceder con motivo
- **WHEN** el administrador fija ese siguiente secuencial en 100 indicando el motivo
- **THEN** el ajuste se aplica y la siguiente reserva recibe el 100

#### Scenario: Retroceder hasta un número reservado
- **WHEN** el administrador intenta fijar ese siguiente secuencial en 50, con motivo
- **THEN** el sistema rechaza el ajuste porque el 50 ya está reservado

### Requirement: Permisos de los secuenciales
El sistema SHALL reservar al administrador la consulta y el ajuste de los secuenciales. Un operador no los consulta ni los ajusta.

#### Scenario: Operador intenta consultar o ajustar
- **WHEN** un operador intenta consultar los secuenciales o ajustar el siguiente valor de un contador
- **THEN** el sistema rechaza la solicitud por falta de permiso
- **AND** nada cambia

### Requirement: Aislamiento de la numeración por empresa
El sistema SHALL limitar la consulta, el ajuste y la reserva de secuenciales a la empresa del usuario autenticado, y SHALL responder a un punto de emisión de otra empresa igual que a uno inexistente.

#### Scenario: Ajuste en un punto de otra empresa
- **WHEN** un administrador de la empresa B intenta ajustar un contador de un punto de emisión de la empresa A usando su identificador
- **THEN** el sistema responde como si el punto no existiera
- **AND** el contador de la empresa A no cambia

#### Scenario: Mismos códigos en dos empresas
- **WHEN** dos empresas tienen el establecimiento `001` con el punto `001` y cada una reserva una factura
- **THEN** cada una recibe el secuencial 1 de su propia numeración
