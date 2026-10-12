# Spec Delta

## Purpose

Protege las peticiones HTTP antes de la lógica de dominio. Fija de qué origen pueden llegar las
mutaciones de la API, cómo se rechazan las peticiones de otros sitios y qué tamaño y tipo de cuerpo
se acepta, también en la autenticación, sin reemplazar la autenticación, la autorización ni el
aislamiento por empresa.

## ADDED Requirements

### Requirement: Origen obligatorio en las mutaciones de la API
Toda petición `POST`, `PUT`, `PATCH` o `DELETE` a `/api/v1` SHALL traer una cabecera `Origin`
exactamente igual al origen canónico de la aplicación. Si el origen falta, es `null`, está
malformado o difiere en esquema, host o puerto, el sistema SHALL rechazarla con 403, antes de leer
su cuerpo y antes de autenticarla.

#### Scenario: Origen canónico
- **WHEN** un navegador con sesión envía una mutación válida con el origen canónico
- **THEN** el sistema la procesa como hasta ahora

#### Scenario: Origen ajeno
- **WHEN** una mutación llega con el `Origin` de otro sitio
- **THEN** el sistema responde 403 y no ejecuta la operación

#### Scenario: Origen de un sitio hermano
- **WHEN** una mutación llega desde un subdominio hermano o desde otro puerto del mismo host
- **THEN** el sistema responde 403 y no ejecuta la operación

#### Scenario: Origen ausente, nulo o malformado
- **WHEN** una mutación llega sin `Origin`, con `Origin: null` o con un valor que no es un origen
  válido
- **THEN** el sistema responde 403 y no ejecuta la operación

#### Scenario: Otro esquema u otro puerto
- **WHEN** una mutación llega con el mismo host del origen canónico pero con otro esquema u otro
  puerto
- **THEN** el sistema responde 403

#### Scenario: POST sin cuerpo
- **WHEN** un `POST` sin cuerpo, como un reintento de firma o una solicitud de impresión, llega sin
  el origen canónico
- **THEN** el sistema responde 403 y el reintento o la solicitud no se registran

#### Scenario: Rechazo antes del cuerpo y de la autenticación
- **WHEN** una mutación con un origen ajeno trae un cuerpo mayor que el límite de la API, o no trae
  sesión
- **THEN** el sistema responde 403, no 413 ni 401

#### Scenario: El origen no sustituye la autenticación ni la autorización
- **WHEN** una mutación con el origen canónico llega sin sesión, o de un usuario cuyo rol no
  permite la acción
- **THEN** el sistema responde como hasta ahora: 401 sin sesión, o la denegación por permiso, sin
  revelar datos de otra empresa

### Requirement: Origen canónico único
El origen canónico SHALL ser el de la dirección pública configurada de la aplicación, la misma que
usa la autenticación, normalizada como esquema, host y puerto. No SHALL existir una lista
adicional, comodines ni una forma de desactivar la regla. Si no se puede obtener un origen
`http` o `https` válido, la aplicación SHALL negarse a arrancar.

#### Scenario: Dirección con ruta
- **WHEN** la dirección pública configurada incluye una ruta
- **THEN** el origen canónico es solo su esquema, host y puerto

#### Scenario: Dirección inutilizable
- **WHEN** la dirección pública configurada no produce un origen `http` o `https` válido
- **THEN** la aplicación no arranca y nombra la variable sin mostrar su valor

### Requirement: Cabeceras reenviadas sin autoridad sobre el origen
El sistema SHALL ignorar `Host`, `X-Forwarded-Host`, `Forwarded` y `X-Forwarded-Proto` al decidir
qué origen acepta. Ninguna combinación de esas cabeceras SHALL ampliar el conjunto de orígenes
aceptados.

#### Scenario: Host reenviado falsificado
- **WHEN** una mutación trae un `Origin` ajeno y además un `X-Forwarded-Host` o un `Host` iguales a
  ese origen ajeno
- **THEN** el sistema responde 403

### Requirement: Fetch Metadata como defensa adicional
Cuando una petición a `/api/v1` trae `Sec-Fetch-Site`, el sistema SHALL dejarla seguir si vale
`same-origin` o `none`, y SHALL rechazarla con 403 si vale `same-site` o `cross-site`, en todos los
métodos salvo `OPTIONS`, incluidos `GET` y `HEAD`. Si la cabecera falta, no SHALL rechazar solo por
eso.

#### Scenario: Petición del mismo origen
- **WHEN** la interfaz pide un listado con `Sec-Fetch-Site: same-origin`
- **THEN** el sistema responde como hasta ahora

#### Scenario: Navegación directa
- **WHEN** un operador abre una ruta de la API escribiéndola en el navegador (`Sec-Fetch-Site:
  none`)
- **THEN** el sistema no la rechaza por Fetch Metadata

#### Scenario: Exportación desde otro sitio
- **WHEN** una página de otro sitio lleva al navegador a la exportación de un reporte
  (`Sec-Fetch-Site: cross-site`)
- **THEN** el sistema responde 403 y no genera ni registra la exportación

#### Scenario: Petición desde un sitio hermano
- **WHEN** una página de un sitio hermano pide un `GET` de la API (`Sec-Fetch-Site: same-site`)
- **THEN** el sistema responde 403

#### Scenario: Llamada de servidor sin Fetch Metadata
- **WHEN** el servidor del frontend reenvía una descarga con un `GET` sin `Sec-Fetch-Site`
- **THEN** el sistema la atiende como hasta ahora

#### Scenario: Las dos reglas se suman
- **WHEN** una mutación trae el origen canónico pero `Sec-Fetch-Site: cross-site`
- **THEN** el sistema responde 403

### Requirement: Sin exposición entre orígenes
El sistema SHALL mantener la API sin CORS: ninguna respuesta de `/api/v1` SHALL llevar cabeceras
`Access-Control-Allow-*`, y `OPTIONS` SHALL responder como antes de este cambio.

#### Scenario: Preflight desde otro origen
- **WHEN** un navegador envía un `OPTIONS` de preflight a `/api/v1` desde otro origen
- **THEN** la respuesta es la misma que antes de este cambio y no lleva cabeceras
  `Access-Control-Allow-*`

#### Scenario: Respuestas sin CORS
- **WHEN** cualquier petición a `/api/v1` recibe respuesta, aceptada o rechazada
- **THEN** la respuesta no lleva `Access-Control-Allow-Origin`

### Requirement: Límite general del cuerpo de la API
Un cuerpo JSON a `/api/v1` SHALL admitir hasta 100 KiB, salvo en las rutas cuyo límite propio fija
su capacidad, que conservan ese límite. Un cuerpo mayor SHALL rechazarse con 413 antes de llegar a
la lógica de dominio.

#### Scenario: Cuerpo normal
- **WHEN** una mutación válida trae un cuerpo JSON de menos de 100 KiB
- **THEN** el sistema la procesa como hasta ahora

#### Scenario: Cuerpo general demasiado grande
- **WHEN** una mutación sin límite propio trae un cuerpo JSON de más de 100 KiB
- **THEN** el sistema responde 413 sin ejecutar la operación

#### Scenario: Rutas con límite propio
- **WHEN** una ruta con límite propio, como el borrador de una liquidación de compra o de una guía,
  recibe un cuerpo dentro de ese límite y mayor que 100 KiB
- **THEN** el sistema lo acepta
- **AND** un cuerpo mayor que su límite propio recibe 413

### Requirement: Cuerpo acotado de la autenticación
Toda petición a `/api/auth/*` SHALL admitir como máximo 8192 bytes de cuerpo. Un `Content-Length`
mayor SHALL rechazarse sin leer el cuerpo. Sin `Content-Length` o con transferencia `chunked`, el
límite SHALL contarse sobre los bytes que el servidor entrega para esa petición. Un cuerpo mayor
SHALL rechazarse con 413 antes de que la autenticación lo procese.

#### Scenario: Inicio de sesión normal
- **WHEN** un operador inicia sesión con su correo y su contraseña
- **THEN** la autenticación responde como hasta ahora

#### Scenario: Cuerpo en el límite
- **WHEN** una petición válida a la autenticación trae un cuerpo de 8192 bytes o menos
- **THEN** la autenticación la procesa

#### Scenario: Un byte de más
- **WHEN** una petición a la autenticación trae un cuerpo de 8193 bytes
- **THEN** el sistema responde 413 y la autenticación no la procesa

#### Scenario: Content-Length mayor que el límite
- **WHEN** una petición declara un `Content-Length` mayor que 8192
- **THEN** el sistema responde 413 sin leer el cuerpo

#### Scenario: Transferencia chunked
- **WHEN** una petición válida a la autenticación envía su cuerpo en modo `chunked`, sin
  `Content-Length`
- **THEN** la autenticación la procesa si el cuerpo no pasa de 8192 bytes
- **AND** el sistema responde 413 si pasa de 8192 bytes

### Requirement: Tipo de contenido de la autenticación
Un cuerpo no vacío enviado a `/api/auth/*` SHALL ser `application/json`, con o sin parámetros como
`charset`. Cualquier otro tipo SHALL rechazarse con 415 antes de que la autenticación lo procese.
Un cuerpo vacío no SHALL exigir `Content-Type`. La autenticación conserva sus propios controles de
origen y CSRF.

#### Scenario: JSON
- **WHEN** el cierre de sesión o el cambio de contraseña llega con un cuerpo `application/json;
  charset=utf-8`
- **THEN** la autenticación lo procesa como hasta ahora

#### Scenario: Otro tipo de contenido
- **WHEN** una petición a la autenticación trae un cuerpo no vacío `text/plain`,
  `application/x-www-form-urlencoded` o `multipart/form-data`
- **THEN** el sistema responde 415 y la autenticación no la procesa

#### Scenario: Cuerpo vacío
- **WHEN** una petición a la autenticación llega sin cuerpo y sin `Content-Type`
- **THEN** el sistema no la rechaza por el tipo de contenido

#### Scenario: Defensa propia de la autenticación
- **WHEN** un inicio de sesión llega desde un origen ajeno a la aplicación
- **THEN** la autenticación lo rechaza como hasta ahora

### Requirement: Rechazos sin revelar la configuración
Los rechazos de este requisito SHALL usar el sobre de error de la API y no SHALL incluir el origen
canónico, la lista de orígenes ni la regla que falló.
- El rechazo por origen y el rechazo por Fetch Metadata comparten un mismo código.
- El cuerpo demasiado grande de `/api/v1` conserva su respuesta 413 actual.

#### Scenario: Rechazo por origen
- **WHEN** el sistema rechaza una petición por su origen o por Fetch Metadata
- **THEN** la respuesta 403 lleva el código común y un mensaje genérico, sin el origen esperado
- **AND** lleva `Cache-Control: no-store`, para que ningún intermediario la guarde

#### Scenario: Rechazos de la autenticación
- **WHEN** el sistema rechaza una petición a la autenticación por tamaño o por tipo de contenido
- **THEN** responde 413 o 415 con un mensaje genérico, sin repetir el cuerpo recibido

### Requirement: Observabilidad de los rechazos
Cada rechazo por origen o por Fetch Metadata SHALL emitir un evento de seguridad con el método, una
categoría gruesa de la ruta, el motivo y la correlación, y SHALL incrementar un contador con solo el
método y el motivo. El evento y el contador no SHALL llevar la URL con sus identificadores, los
valores de `Origin` o `Referer`, cuerpos, cookies, contraseñas ni el conjunto de cabeceras. Ningún
registro de un rechazo SHALL contener el cuerpo, contraseñas, cookies ni los valores de `Origin` o
`Referer`, y ningún rechazo SHALL crear auditoría de dominio.

#### Scenario: Evento de un rechazo
- **WHEN** el sistema rechaza una solicitud de impresión de un comprobante por su origen
- **THEN** el registro de seguridad tiene el evento con el método, la categoría de la ruta
  (`documents`), el motivo y la correlación, sin el identificador del comprobante
- **AND** el contador de rechazos sube para ese método y ese motivo

#### Scenario: Nada sensible en los registros
- **WHEN** el sistema rechaza un inicio de sesión de 9000 bytes, un cuerpo `text/plain` de la
  autenticación o una mutación con un `Origin` ajeno
- **THEN** ningún registro contiene el cuerpo, la contraseña, la cookie ni el valor de `Origin` o
  `Referer`

### Requirement: Mismo modelo en desarrollo y pruebas
Las reglas de origen, Fetch Metadata y límites de cuerpo SHALL aplicarse igual en desarrollo, en
pruebas y en producción. Los clientes de desarrollo y de pruebas SHALL enviar el origen canónico
como lo hace el navegador. La aplicación no SHALL tener excepciones, orígenes comodín ni cabeceras
de prueba que alteren su decisión.

#### Scenario: Mutación sin origen en desarrollo
- **WHEN** un cliente de desarrollo envía una mutación a `/api/v1` sin `Origin`
- **THEN** el sistema responde 403, igual que en producción
