## MODIFIED Requirements

### Requirement: Sin salida a Internet por defecto
En el despliegue de referencia, los servicios de la aplicación SHALL carecer de salida a Internet
por defecto, además de la transmisión al SRI y el envío de correos apagados por la configuración.
Dar salida al backend SHALL requerir una decisión explícita del dueño, documentada y nunca activa
en las pruebas, en la CI ni en la topología por defecto. La salida al servidor de correo SHALL ser
un paso propio, separado de la salida al SRI.

#### Scenario: Salida bloqueada por defecto
- **WHEN** un servicio de la aplicación intenta conectar con un destino fuera de la red privada en
  la topología por defecto
- **THEN** la conexión falla, y ningún destino externo recibe tráfico

#### Scenario: Salida deliberada documentada
- **WHEN** el dueño decide habilitar el uso real del SRI
- **THEN** la documentación describe el paso explícito que da salida al backend, separado de la
  topología por defecto y de la habilitación de la transmisión

#### Scenario: Salida al servidor de correo
- **WHEN** el dueño decide enviar los comprobantes por correo con un servidor externo
- **THEN** la documentación describe el paso explícito que da salida al backend hacia el servidor
  de correo, separado de la salida al SRI y del interruptor del envío

## ADDED Requirements

### Requirement: Buzón de pruebas en el despliegue de revisión
El despliegue local de revisión SHALL poder incluir un buzón de pruebas en la red privada que
atrapa los correos sin entregarlos a nadie y los muestra en una página local. El despliegue de
producción no SHALL incluirlo.

#### Scenario: Correo atrapado
- **WHEN** en el despliegue de revisión, con el buzón de pruebas como servidor de correo, se autoriza en Pruebas una factura
- **THEN** el correo aparece en el buzón de pruebas con sus dos adjuntos, y ningún destino externo recibe tráfico

#### Scenario: Producción sin buzón de pruebas
- **WHEN** se arranca la topología de producción
- **THEN** no existe el buzón de pruebas
