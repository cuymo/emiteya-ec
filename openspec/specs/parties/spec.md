# parties Specification

## Purpose

Permite a cada empresa mantener un catálogo único de terceros reutilizables en cualquier rol, con
su identificación validada con las reglas oficiales, y garantiza el consumidor final del sistema.

## Requirements

### Requirement: Catálogo único de terceros
El sistema SHALL permitir registrar en la empresa terceros reutilizables en cualquier rol, con tipo y número de identificación, razón social o nombres y, opcionalmente, dirección, correo, teléfono y roles. Los roles cliente, proveedor y transportista son opcionales y combinables, y solo clasifican: un tercero sin roles existe y puede recibir un uso más adelante.

#### Scenario: Alta de un tercero
- **WHEN** un usuario registra un tercero con RUC `1790012345001` y razón social "Comercial Andina S.A."
- **THEN** el tercero existe en su empresa, activo, con esos datos

#### Scenario: Tercero con varios roles
- **WHEN** un usuario registra un tercero como cliente y proveedor
- **THEN** el tercero aparece al filtrar por cliente y al filtrar por proveedor, y es un solo registro

#### Scenario: Tercero sin roles
- **WHEN** un usuario registra un tercero sin ningún rol
- **THEN** el tercero existe y aparece en las búsquedas sin filtro de rol, pero no al filtrar por un rol

#### Scenario: Datos fuera de sus límites
- **WHEN** un usuario registra un tercero sin razón social, con una razón social de más de 300 caracteres o con un correo con formato inválido
- **THEN** el sistema rechaza la solicitud indicando el campo, y no se crea ningún tercero

### Requirement: Identificación validada con las reglas oficiales
El sistema SHALL validar la identificación de un tercero con la regla de formato que publica el catálogo fiscal para su tipo, vigente en la fecha de la operación: RUC de 13 dígitos terminado en 001, cédula de 10 dígitos, y pasaporte o identificación del exterior de 1 a 20 caracteres sin saltos de línea. El sistema MUST NOT rechazar una identificación por un algoritmo de dígito verificador que el SRI no exige. El tipo de venta a consumidor final está reservado al consumidor final del sistema.

#### Scenario: RUC sin algoritmo local
- **WHEN** un usuario registra un RUC de 13 dígitos terminado en 001 cuyo dígito verificador no cumple un algoritmo de módulo 11
- **THEN** el sistema lo acepta

#### Scenario: Formato inválido
- **WHEN** un usuario registra una cédula de 9 dígitos
- **THEN** el sistema rechaza la solicitud indicando la regla del tipo, y no se crea ningún tercero

#### Scenario: Tipo reservado
- **WHEN** un usuario registra un tercero con el tipo de venta a consumidor final
- **THEN** el sistema rechaza la solicitud porque ese tipo está reservado al consumidor final del sistema

#### Scenario: Tipo inexistente
- **WHEN** un usuario registra un tercero con un tipo de identificación que no está en el catálogo fiscal
- **THEN** el sistema rechaza la solicitud, y no se crea ningún tercero

### Requirement: Identificación única por empresa
El sistema SHALL impedir que dos terceros de una misma empresa tengan el mismo tipo y número de identificación, también cuando uno está desactivado. La comparación es exacta, después de quitar los espacios de los extremos. La misma identificación puede existir en otra empresa.

#### Scenario: Identificación repetida
- **WHEN** un usuario registra un tercero con un tipo y un número que ya tiene otro tercero de su empresa
- **THEN** el sistema rechaza la solicitud indicando que ese tercero ya existe, y no se crea otro

#### Scenario: Identificación de un tercero desactivado
- **WHEN** un usuario registra la identificación de un tercero desactivado de su empresa
- **THEN** el sistema rechaza la solicitud indicando que el tercero existe desactivado

#### Scenario: Altas simultáneas con la misma identificación
- **WHEN** dos usuarios registran a la vez un tercero con el mismo tipo y número en la misma empresa
- **THEN** existe exactamente un tercero con esa identificación, y la otra solicitud recibe el rechazo por identificación repetida

#### Scenario: Misma identificación en otra empresa
- **WHEN** usuarios de dos empresas registran un tercero con la misma identificación
- **THEN** cada empresa tiene su propio tercero, sin ningún indicio del de la otra

### Requirement: Corrección de un tercero
El sistema SHALL permitir corregir la identificación, la razón social, los datos de contacto y los roles de un tercero, solo a partir de la versión que el usuario consultó. Una corrección que repite la identificación de otro tercero de la empresa se rechaza.

#### Scenario: Corrección
- **WHEN** un usuario corrige la razón social y los roles de un tercero con la versión vigente
- **THEN** el tercero queda con los datos nuevos

#### Scenario: Versión desactualizada
- **WHEN** un usuario corrige un tercero que otro usuario cambió después de su consulta
- **THEN** el sistema rechaza la solicitud indicando que el tercero cambió, y el tercero conserva los datos del otro usuario

#### Scenario: Correcciones simultáneas
- **WHEN** dos usuarios corrigen a la vez el mismo tercero a partir de la misma versión
- **THEN** se aplica exactamente una de las correcciones, y la otra recibe el rechazo por cambio concurrente

#### Scenario: Corrección hacia una identificación ocupada
- **WHEN** un usuario corrige la identificación de un tercero con la de otro tercero de su empresa
- **THEN** el sistema rechaza la solicitud por identificación repetida, y ningún tercero cambia

### Requirement: Desactivación y reactivación de terceros
El sistema SHALL permitir desactivar y reactivar terceros, nunca borrarlos. Un tercero desactivado conserva sus datos y su identificación, no aparece en las búsquedas de terceros activos y se encuentra al filtrar por desactivados. Repetir el estado actual no cambia nada.

#### Scenario: Desactivar un tercero
- **WHEN** un administrador desactiva un tercero
- **THEN** el tercero deja de aparecer en las búsquedas de terceros activos y conserva sus datos

#### Scenario: Reactivar un tercero
- **WHEN** un administrador reactiva un tercero desactivado
- **THEN** el tercero vuelve a aparecer en las búsquedas de terceros activos

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un tercero que ya está desactivado
- **THEN** nada cambia

#### Scenario: Sin borrado
- **WHEN** un usuario intenta borrar un tercero
- **THEN** el sistema no ofrece esa operación y el tercero sigue existiendo

### Requirement: Búsqueda y paginación de terceros
El sistema SHALL buscar terceros por el inicio de su identificación o por un fragmento de su razón social, sin distinguir mayúsculas, minúsculas ni tildes. Se puede filtrar por estado, activos por defecto, y por rol. El resultado se pagina, con 25 terceros por página por defecto y como máximo 100, indica el total y sigue un orden estable con desempate, de modo que cada tercero aparece una sola vez al recorrer las páginas.

#### Scenario: Búsqueda por identificación
- **WHEN** un usuario busca `17900`
- **THEN** obtiene los terceros activos cuya identificación empieza por `17900`

#### Scenario: Búsqueda por nombre sin tildes ni mayúsculas
- **WHEN** un usuario busca "garcia"
- **THEN** obtiene los terceros activos cuya razón social contiene "García", "GARCIA" o "garcía"

#### Scenario: Orden estable entre páginas
- **WHEN** varios terceros tienen la misma razón social y un usuario recorre todas las páginas del resultado
- **THEN** cada tercero aparece exactamente una vez y en el mismo orden en cada consulta

#### Scenario: Tamaño de página fuera de rango
- **WHEN** un usuario pide 101 terceros por página
- **THEN** el sistema rechaza la solicitud indicando el máximo

#### Scenario: Filtro por rol
- **WHEN** un usuario filtra por transportista
- **THEN** obtiene solo los terceros activos con el rol transportista

### Requirement: Consumidor final del sistema
Cada empresa SHALL tener exactamente un consumidor final: un tercero del sistema con el tipo de venta a consumidor final, la identificación `9999999999999` y la razón social de la política de consumidor final vigente al crearlo. Se crea en la misma operación que la empresa, y las empresas anteriores a este cambio lo reciben antes de que el sistema atienda peticiones. Se reconoce como registro del sistema y nadie lo edita, desactiva ni borra. No guarda el monto máximo de la política.

#### Scenario: Empresa nueva
- **WHEN** el sistema aprovisiona la empresa de la instalación
- **THEN** la empresa tiene su consumidor final, con la identidad de la política vigente, desde la misma operación que la crea

#### Scenario: Fallo al crear la empresa
- **WHEN** la creación de una empresa falla antes de terminar
- **THEN** no queda ni la empresa ni su consumidor final, y nunca existe una empresa sin consumidor final

#### Scenario: Empresas anteriores al cambio
- **WHEN** el sistema arranca por primera vez con esta versión sobre una instalación que ya tenía su empresa
- **THEN** la empresa tiene su consumidor final antes de que el sistema atienda la primera petición

#### Scenario: Arranques repetidos o simultáneos
- **WHEN** el sistema arranca varias veces, o varias instancias arrancan a la vez
- **THEN** cada empresa tiene exactamente un consumidor final

#### Scenario: Intento de cambiar el consumidor final
- **WHEN** un administrador intenta corregir, desactivar o borrar el consumidor final
- **THEN** el sistema rechaza la solicitud indicando que es un registro del sistema, y nada cambia

#### Scenario: Consumidor final en la búsqueda
- **WHEN** un usuario busca "consumidor"
- **THEN** obtiene el consumidor final de su empresa, activo y marcado como registro del sistema, sin acciones de edición

### Requirement: Permisos de terceros
El sistema SHALL permitir que administradores y operadores consulten, registren y corrijan terceros. Solo un administrador SHALL desactivar o reactivar un tercero.

#### Scenario: Operador registra un tercero
- **WHEN** un operador registra un tercero válido
- **THEN** el tercero se crea

#### Scenario: Operador intenta desactivar
- **WHEN** un operador intenta desactivar o reactivar un tercero
- **THEN** el sistema rechaza la solicitud por falta de permiso, y nada cambia

### Requirement: Aislamiento de los terceros por empresa
El sistema SHALL limitar la consulta y el cambio de terceros a la empresa del usuario autenticado, que se deriva de su sesión. Un usuario no puede leer, cambiar ni deducir la existencia de los terceros de otra empresa.

#### Scenario: Tercero de otra empresa
- **WHEN** un usuario de la empresa A consulta, corrige o desactiva un tercero de la empresa B por su identificador
- **THEN** el sistema responde igual que ante un tercero inexistente, y el tercero de B no cambia

#### Scenario: Búsqueda aislada
- **WHEN** un usuario de la empresa A busca la identificación de un tercero que solo existe en la empresa B
- **THEN** no obtiene ningún resultado

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un usuario incluye un identificador de empresa en el cuerpo de un alta o de una corrección
- **THEN** el sistema rechaza la solicitud, y no se crea ni cambia ningún tercero
