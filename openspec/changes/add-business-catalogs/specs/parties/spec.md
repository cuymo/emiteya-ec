# Spec Delta

## Purpose

Mantiene el catálogo único de terceros de cada empresa: personas y organizaciones reutilizables
como clientes, proveedores o transportistas, con su identificación oficial, y el consumidor final
como registro del sistema.

## ADDED Requirements

### Requirement: Alta de terceros
El sistema SHALL permitir registrar un tercero con su tipo y número de identificación, su razón social o nombres, y opcionalmente su dirección, correo electrónico, teléfono y roles (cliente, proveedor o transportista). Un mismo tercero sirve para cualquier rol.

#### Scenario: Cliente con RUC
- **WHEN** un usuario registra un tercero con tipo RUC, un RUC válido, una razón social y el rol cliente
- **THEN** el tercero queda activo en el catálogo de su empresa con esos datos

#### Scenario: Tercero en varios roles
- **WHEN** un usuario registra un tercero como cliente y proveedor
- **THEN** el mismo tercero figura en ambos roles, sin duplicarse

#### Scenario: Datos obligatorios ausentes
- **WHEN** un usuario intenta registrar un tercero sin número de identificación o sin razón social
- **THEN** el sistema rechaza el alta e indica los campos que faltan

### Requirement: Identificación conforme a las reglas oficiales
El sistema SHALL validar la identificación según el tipo, con el formato del XSD y las reglas expresamente oficiales: RUC de 13 dígitos terminado en 001, cédula de 10 dígitos, y pasaporte o identificación del exterior de 1 a 20 caracteres sin saltos de línea. El sistema MUST NOT rechazar una identificación por un algoritmo local de dígito verificador.

#### Scenario: RUC sin algoritmo verificable
- **WHEN** un usuario registra un RUC de 13 dígitos terminado en 001 cuyo dígito verificador no cumple ningún algoritmo local
- **THEN** el sistema lo acepta

#### Scenario: RUC con formato inválido
- **WHEN** un usuario registra un RUC de 12 dígitos o que no termina en 001
- **THEN** el sistema rechaza el alta e indica el formato esperado

#### Scenario: Cédula con letras
- **WHEN** un usuario registra una cédula con letras o con una longitud distinta de 10
- **THEN** el sistema rechaza el alta e indica el formato esperado

#### Scenario: Tipo de consumidor final
- **WHEN** un usuario intenta registrar un tercero con el tipo de identificación de venta a consumidor final
- **THEN** el sistema rechaza el alta e indica que el consumidor final es un registro del sistema

### Requirement: Identificación única por empresa
El sistema SHALL impedir dos terceros con el mismo tipo y número de identificación en una empresa. La misma identificación puede existir en otra empresa.

#### Scenario: Identificación repetida
- **WHEN** un usuario registra un tercero con un tipo y número que ya existen en su empresa
- **THEN** el sistema rechaza el alta e indica qué tercero tiene esa identificación

#### Scenario: Altas simultáneas con la misma identificación
- **WHEN** dos usuarios registran a la vez un tercero con el mismo tipo y número
- **THEN** solo uno se registra y el otro se rechaza por identificación repetida

#### Scenario: Misma identificación en dos empresas
- **WHEN** usuarios de dos empresas registran la misma identificación
- **THEN** cada empresa tiene su propio tercero

### Requirement: Edición de terceros
El sistema SHALL permitir corregir los datos de un tercero, incluida su identificación, indicando la versión que el usuario ve. Si otro cambio la modificó antes, el sistema rechaza la corrección con un conflicto.

#### Scenario: Corrección de datos de contacto
- **WHEN** un usuario cambia la dirección y el correo de un tercero indicando su versión vigente
- **THEN** el tercero conserva su identificación y queda con los datos nuevos

#### Scenario: Corrección con una versión desactualizada
- **WHEN** un usuario corrige un tercero que otro usuario cambió después de que lo abriera
- **THEN** el sistema rechaza la corrección con un conflicto que pide recargar, y nada cambia

#### Scenario: Corrección hacia una identificación existente
- **WHEN** un usuario cambia la identificación de un tercero a una que ya tiene otro tercero de su empresa
- **THEN** el sistema rechaza la corrección por identificación repetida

### Requirement: Búsqueda de terceros
El sistema SHALL permitir buscar terceros por el inicio de su identificación o por una parte de su nombre, sin distinguir mayúsculas ni tildes, con resultados paginados y filtros por estado y rol. Por defecto muestra solo los activos.

#### Scenario: Búsqueda por nombre sin tildes
- **WHEN** un usuario busca "jose perez"
- **THEN** encuentra a "JOSÉ PÉREZ"

#### Scenario: Búsqueda por identificación
- **WHEN** un usuario busca los primeros dígitos de un RUC
- **THEN** encuentra a los terceros cuya identificación empieza por ellos

#### Scenario: Resultados paginados
- **WHEN** una búsqueda coincide con más terceros que el tamaño de página
- **THEN** el sistema devuelve una página con el total de coincidencias

### Requirement: Desactivación de terceros
El sistema SHALL permitir desactivar y reactivar un tercero en lugar de eliminarlo. Un tercero desactivado conserva sus datos, deja de ofrecerse para documentos nuevos y sigue siendo consultable.

#### Scenario: Desactivación
- **WHEN** un administrador desactiva un tercero
- **THEN** el tercero deja de aparecer entre los activos y sigue consultable con el filtro de inactivos

#### Scenario: Reactivación
- **WHEN** un administrador reactiva un tercero desactivado
- **THEN** el tercero vuelve a estar activo con sus datos

#### Scenario: Desactivación repetida
- **WHEN** un administrador desactiva un tercero ya desactivado
- **THEN** nada cambia

### Requirement: Consumidor final del sistema
Cada empresa SHALL tener un único consumidor final, creado y controlado por el sistema, con el tipo de venta a consumidor final, la identificación 9999999999999 y la razón social CONSUMIDOR FINAL. El sistema SHALL reconocerlo como tal por su condición de registro del sistema, no por su texto, y no permitir duplicarlo, editarlo, desactivarlo ni eliminarlo.

#### Scenario: Empresa nueva
- **WHEN** se consulta el catálogo de terceros de una empresa recién aprovisionada
- **THEN** el consumidor final existe, activo y marcado como registro del sistema

#### Scenario: Intento de editar o desactivar
- **WHEN** un administrador intenta editar o desactivar el consumidor final
- **THEN** el sistema rechaza la solicitud e indica que es un registro del sistema, y nada cambia

#### Scenario: Un tercero con el mismo nombre
- **WHEN** un usuario registra un tercero con cédula cuya razón social es "Consumidor Final"
- **THEN** es un tercero normal y no se confunde con el consumidor final del sistema

#### Scenario: Arranques repetidos
- **WHEN** el sistema arranca varias veces
- **THEN** cada empresa sigue teniendo un solo consumidor final

### Requirement: Permisos de los terceros
El sistema SHALL permitir que administradores y operadores consulten, registren y corrijan terceros. Solo un administrador SHALL desactivar o reactivar un tercero.

#### Scenario: Operador registra un tercero
- **WHEN** un operador registra un tercero válido
- **THEN** el tercero se registra

#### Scenario: Operador intenta desactivar
- **WHEN** un operador intenta desactivar un tercero
- **THEN** el sistema rechaza la solicitud por falta de permiso y nada cambia

### Requirement: Aislamiento de los terceros por empresa
El sistema SHALL limitar toda consulta y todo cambio de terceros a la empresa del usuario autenticado. Un usuario no puede leer, cambiar ni detectar un tercero de otra empresa.

#### Scenario: Tercero de otra empresa
- **WHEN** un usuario de la empresa B consulta, corrige o desactiva un tercero de la empresa A por su identificador
- **THEN** el sistema responde como si el tercero no existiera

#### Scenario: Búsqueda desde otra empresa
- **WHEN** un usuario de la empresa B busca la identificación de un tercero de la empresa A
- **THEN** no obtiene ningún resultado de la empresa A

#### Scenario: Empresa indicada en la solicitud
- **WHEN** un usuario incluye un identificador de empresa al registrar o corregir un tercero
- **THEN** el sistema rechaza la solicitud y ninguna empresa cambia
