# Spec Delta

## MODIFIED Requirements

### Requirement: Catálogos fiscales oficiales
El sistema SHALL ofrecer a todas las empresas los catálogos fiscales oficiales de tipos de identificación, impuestos, tarifas de IVA, códigos de ICE, códigos de IRBPNR, formas de pago, impuestos a retener, códigos de retención del IVA, conceptos de retención del impuesto a la renta, tipos de documento sustento y códigos de sustento. Cada entrada SHALL indicar su código, su descripción oficial, su vigencia desde y, si la tiene, hasta, el origen de su fecha de inicio (declarada por la fuente o base del proyecto), su documento fuente, la versión de esa fuente y su estado normativo.

#### Scenario: Consulta de un catálogo
- **WHEN** un usuario consulta las formas de pago
- **THEN** ve cada código con su descripción oficial, su vigencia, su fuente y la versión de la fuente

#### Scenario: Mismas entradas para todas las empresas
- **WHEN** usuarios de dos empresas consultan las tarifas de IVA
- **THEN** ambos ven las mismas entradas oficiales, con los mismos códigos, descripciones y vigencias

#### Scenario: Fecha de inicio declarada por la fuente
- **WHEN** un usuario consulta una forma de pago cuya tabla oficial declara su fecha de inicio
- **THEN** ve esa fecha identificada como declarada por la fuente

#### Scenario: Entrada sin fecha en la fuente
- **WHEN** un usuario consulta una tarifa de IVA, cuya tabla oficial no declara fecha de inicio
- **THEN** ve como inicio la fecha base del proyecto, identificada como publicación de la versión de la ficha y no como fecha legal de vigencia, sin ninguna historia anterior

#### Scenario: Funciona sin conexión con el SRI
- **WHEN** el sistema arranca sin acceso a internet
- **THEN** los catálogos fiscales están disponibles con los datos distribuidos en la versión instalada

#### Scenario: Catálogos de retención
- **WHEN** un usuario consulta los conceptos de retención del impuesto a la renta
- **THEN** ve cada concepto con su código, su denominación oficial, su porcentaje o el texto con que la fuente lo publica, su vigencia, su fuente (el Catálogo ATS con su fecha de actualización y su SHA-256) y su clasificación de alcance

### Requirement: Habilitación de entradas por empresa
El sistema SHALL permitir que un administrador habilite o deshabilite para su empresa las tarifas de IVA, los códigos de ICE e IRBPNR, las formas de pago, los códigos de retención del IVA y los conceptos de retención de la renta. Sin una decisión de la empresa rige el valor por defecto de cada catálogo: habilitadas las tarifas de IVA, las formas de pago y los catálogos de retención, deshabilitados ICE e IRBPNR. Una entrada solo es utilizable si está habilitada y vigente. La habilitación no cambia los datos oficiales.

En los catálogos de retención solo se habilitan o deshabilitan las entradas soportadas: los conceptos de la renta clasificados como soportados para residentes con porcentaje fijo (`SUPPORTED_FIXED_RESIDENT`) y los códigos de retención del IVA clasificados como soportados (`SUPPORTED_FIXED`), entre ellos el código 7, que representa explícitamente una retención en cero. Habilitar o deshabilitar una entrada fuera de alcance (`OUT_OF_SCOPE_NON_RESIDENT`, `OUT_OF_SCOPE_VARIABLE`, `OUT_OF_SCOPE_SPECIAL_STRUCTURE` u `OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION`, como el código 8 de no procede retención) se rechaza siempre con el mismo motivo y no registra ninguna decisión. La entrada sigue en el catálogo para su trazabilidad y no puede usarse en una retención.

#### Scenario: Deshabilitar una tarifa
- **WHEN** un administrador deshabilita la tarifa de IVA del 14 %
- **THEN** esa tarifa figura como deshabilitada para su empresa y su entrada oficial no cambia

#### Scenario: Habilitar un código de ICE
- **WHEN** un administrador habilita un código de ICE
- **THEN** ese código figura como habilitado para su empresa

#### Scenario: Habilitación repetida
- **WHEN** un administrador habilita una entrada que ya está habilitada
- **THEN** nada cambia

#### Scenario: Empresa nueva
- **WHEN** se consulta la habilitación de una empresa recién aprovisionada
- **THEN** cada entrada tiene el valor por defecto de su catálogo, sin decisiones registradas

#### Scenario: Entrada nueva de una versión posterior
- **WHEN** una versión nueva del producto incorpora una tarifa de IVA y un código de ICE
- **THEN** en cada empresa sin decisión sobre ellas, la tarifa figura habilitada y el código de ICE deshabilitado

#### Scenario: Entrada habilitada que deja de estar vigente
- **WHEN** una entrada que una empresa habilitó vence o se retira
- **THEN** la decisión de la empresa se conserva, pero la entrada no es utilizable

#### Scenario: Habilitar una entrada sin vigencia
- **WHEN** un administrador intenta habilitar una entrada sin versión vigente ni futura
- **THEN** el sistema rechaza la solicitud y nada cambia

#### Scenario: Catálogo sin habilitación por empresa
- **WHEN** un administrador intenta deshabilitar un tipo de identificación
- **THEN** el sistema rechaza la solicitud y nada cambia

#### Scenario: Cambios simultáneos de la misma entrada
- **WHEN** dos administradores cambian a la vez la habilitación de la misma entrada
- **THEN** la entrada queda en un único estado final y se registra un solo cambio por cada transición real

#### Scenario: Deshabilitar un concepto de retención
- **WHEN** un administrador deshabilita el concepto de renta 303 para su empresa
- **THEN** el concepto deja de ofrecerse en sus retenciones y su entrada oficial no cambia

#### Scenario: Habilitar un concepto de renta fuera de alcance
- **WHEN** un administrador intenta habilitar un concepto de renta clasificado fuera de alcance por no residente, por porcentaje variable, por estructura especial excluida o por representación ambigua
- **THEN** el sistema rechaza cada solicitud con el mismo motivo, no registra ninguna decisión y el concepto sigue en el catálogo sin poder usarse

#### Scenario: Habilitar el código 8 de retención del IVA
- **WHEN** un administrador intenta habilitar el código 8 de no procede retención
- **THEN** el sistema rechaza la solicitud, no registra ninguna decisión y el código sigue en el catálogo sin poder seleccionarse para una retención

#### Scenario: Habilitar el código 7 de retención del IVA
- **WHEN** un administrador deshabilita el código 7 de retención en cero y lo vuelve a habilitar
- **THEN** el código queda habilitado para su empresa y una retención con él lleva el 0 % y un valor retenido de 0.00

## ADDED Requirements

### Requirement: Clasificación de alcance de las entradas de retención
Cada concepto de retención de la renta y cada código de retención del IVA SHALL conservar la fila oficial completa, con su código y su porcentaje o el texto literal de la fuente, e indicar su clasificación: soportado (residente con porcentaje fijo), fuera de alcance por porcentaje variable, por no residente, por estructura especial excluida o por representación ambigua en la fuente. Solo las soportadas se pueden elegir.

#### Scenario: Concepto con porcentaje textual
- **WHEN** un usuario consulta un concepto que la fuente publica con "varios porcentajes"
- **THEN** lo ve con ese texto literal, sin un porcentaje inventado, clasificado fuera de alcance por porcentaje variable

#### Scenario: Concepto de no residentes
- **WHEN** un usuario consulta un concepto del módulo de pagos a no residentes
- **THEN** lo ve clasificado fuera de alcance por no residente

#### Scenario: Código publicado con un espacio
- **WHEN** un usuario consulta un concepto cuyo código la fuente publica con un espacio interno, como `323 M`
- **THEN** lo ve con el código literal de la fuente, con el espacio, clasificado fuera de alcance por representación ambigua, pendiente de evidencia y de soporte futuro

#### Scenario: Retención del IVA que no procede
- **WHEN** un usuario consulta el código 8 de retención del IVA, "no procede retención"
- **THEN** lo ve con su porcentaje 0 % y su denominación, clasificado fuera de alcance porque la fuente no define su representación en el comprobante

#### Scenario: Cantidad de conceptos soportados
- **WHEN** se instala la versión del catálogo de la renta del Catálogo ATS del 06/08/2026, con sus 127 filas
- **THEN** la cantidad de conceptos soportados es la que resulta de aplicar las reglas de clasificación a esas filas, sin un número fijado en el sistema

### Requirement: Compatibilidad del sustento con el tipo de documento
El catálogo de tipos de documento sustento SHALL indicar, para cada tipo, los códigos de sustento que admite según el Catálogo ATS, y el catálogo de códigos de sustento su vigencia. Un código de sustento solo es utilizable con un tipo que lo admite y en su vigencia.

#### Scenario: Códigos admitidos por la nota de venta
- **WHEN** un usuario consulta el tipo de documento sustento nota de venta
- **THEN** ve los códigos de sustento que el Catálogo ATS le asigna, sin el de crédito tributario del IVA

#### Scenario: Código de sustento vencido
- **WHEN** un usuario consulta el código de sustento 00, vigente hasta el 28/02/2015
- **THEN** lo ve con su vigencia cerrada y no es utilizable
