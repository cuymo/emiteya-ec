# Spec Delta

## Purpose

Exige y valida, antes de aceptar tráfico o de construir el frontend, la configuración que solo
tiene sentido en un despliegue real: el ambiente declarado, el directorio de los paquetes de
portabilidad, el límite de confianza del proxy, el origen público de la autenticación y el destino
interno de la API. Un valor ausente o inseguro impide arrancar o construir, nunca cae en un
comportamiento de desarrollo en silencio.

## ADDED Requirements

### Requirement: Ambiente declarado de forma explícita
El backend SHALL exigir la variable de ambiente sin un valor por defecto. Un valor ausente, o
distinto de `development`, `test` o `production`, SHALL impedir que la API arranque, antes de
escuchar, con un mensaje que nombra la variable y no revela ningún otro valor del entorno.

#### Scenario: Ambiente de producción declarado
- **WHEN** el backend arranca con el ambiente puesto a `production` y el resto de la configuración
  es válida para ese ambiente
- **THEN** la API arranca

#### Scenario: Ambiente de desarrollo declarado
- **WHEN** el backend arranca con el ambiente puesto a `development`
- **THEN** la API arranca con las reglas de desarrollo, como hasta ahora

#### Scenario: Ambiente de pruebas declarado
- **WHEN** el backend arranca con el ambiente puesto a `test`
- **THEN** la API arranca con las reglas de pruebas, como hasta ahora

#### Scenario: Ambiente ausente o no admitido
- **WHEN** el backend arranca sin declarar el ambiente, o con un valor distinto de los tres
  admitidos
- **THEN** la API no arranca, y el mensaje nombra la variable sin mostrar ningún valor del entorno

### Requirement: Directorio de exportación obligatorio y preaprovisionado en producción
En producción, el directorio de los paquetes de portabilidad SHALL estar declarado, SHALL ser una
ruta absoluta, SHALL existir de antemano, SHALL ser un directorio real (nunca un enlace simbólico),
SHALL pertenecer al proceso que arranca y SHALL ser utilizable por ese proceso (lectura, escritura
y acceso). La API nunca SHALL crearlo ni caer en un directorio del temporal del sistema en
producción, y un incumplimiento SHALL impedir el arranque antes de escuchar, con un mensaje que
nombra la variable y la regla incumplida, sin un volcado de la pila. En desarrollo y en pruebas,
SHALL seguir siendo opcional, con un directorio temporal por defecto.

#### Scenario: Directorio válido en producción
- **WHEN** la API arranca en producción con el directorio declarado, absoluto, existente, propio y
  utilizable
- **THEN** la API arranca y usa ese directorio para los paquetes de portabilidad

#### Scenario: Directorio ausente en producción
- **WHEN** la API arranca en producción sin declarar el directorio
- **THEN** la API no arranca, y el mensaje nombra la variable, sin crear ningún directorio nuevo

#### Scenario: Ruta relativa en producción
- **WHEN** la API arranca en producción con una ruta relativa
- **THEN** la API no arranca

#### Scenario: Directorio inexistente en producción
- **WHEN** la API arranca en producción con una ruta absoluta que no existe
- **THEN** la API no arranca, y no crea el directorio

#### Scenario: Enlace simbólico en producción
- **WHEN** la ruta declarada en producción es un enlace simbólico
- **THEN** la API no arranca

#### Scenario: Directorio ajeno o no utilizable en producción
- **WHEN** el directorio declarado en producción no pertenece al proceso que arranca, o el proceso
  no puede leerlo, escribir en él o recorrerlo
- **THEN** la API no arranca, y el mensaje nombra la regla incumplida

#### Scenario: Desarrollo sin el directorio declarado
- **WHEN** la API arranca en desarrollo o en pruebas sin declarar el directorio
- **THEN** la API arranca y usa un directorio temporal por defecto, como hasta ahora

### Requirement: Límite de confianza del proxy validado y obligatorio en producción
El límite de confianza del proxy SHALL aceptar solo: un número entero de saltos mayor o igual que
1; una dirección IP explícita; un bloque CIDR explícito; una lista separada por comas de
direcciones IP o bloques CIDR explícitos; o el nombre `loopback`, solo. Cualquier otro valor SHALL
rechazarse al arrancar, en cualquier ambiente, sin llegar nunca al servidor HTTP: entre otros,
`true`, `0`, un número negativo o malformado, los nombres `linklocal` y `uniquelocal`, un texto
arbitrario, una dirección o un bloque malformados, y un bloque de longitud 0, que confía en
cualquier dirección. En producción, SHALL estar declarado de forma explícita, y ni su ausencia ni
el valor `false` SHALL aceptarse. En desarrollo y en pruebas, SHALL seguir admitiendo `false`, que
es su valor por defecto. La documentación del despliegue SHALL advertir que un número de saltos
solo es correcto si el despliegue garantiza esa longitud exacta de la cadena de proxies.

#### Scenario: Límite válido en producción
- **WHEN** la API arranca en producción con el límite declarado como un número de saltos mayor o
  igual que 1, una dirección IP, un bloque CIDR, una lista de direcciones o bloques, o `loopback`
- **THEN** la API arranca con ese límite de confianza

#### Scenario: Límite ausente en producción
- **WHEN** la API arranca en producción sin declarar el límite de confianza
- **THEN** la API no arranca

#### Scenario: Sin confianza en producción
- **WHEN** la API arranca en producción con el límite puesto a `false`
- **THEN** la API no arranca

#### Scenario: Confianza total en producción
- **WHEN** la API arranca en producción con el límite puesto a `true`
- **THEN** la API no arranca

#### Scenario: Sintaxis no admitida
- **WHEN** la API arranca, en cualquier ambiente, con `0`, un número negativo o malformado,
  `linklocal`, `uniquelocal`, un texto arbitrario, una dirección o un bloque malformados, o un
  bloque de longitud 0
- **THEN** la API no arranca, y el valor nunca llega al servidor HTTP

#### Scenario: Desarrollo sin el límite declarado
- **WHEN** la API arranca en desarrollo o en pruebas sin declarar el límite de confianza
- **THEN** la API arranca sin confiar en ningún proxy, como hasta ahora

### Requirement: Origen de la autenticación con HTTPS en producción
En producción, el origen público de la autenticación SHALL usar `https:`, salvo que su host sea
exactamente `localhost`, `127.0.0.1` o `::1`, reservado a una prueba de humo del software de
producción. Un origen HTTP con cualquier otro host, incluido uno que solo se parece a esos (como
`localhost.example.com` o `127.0.0.1.example.com`), SHALL impedir que la API arranque en
producción. Esto no SHALL cambiar la comparación exacta del origen canónico que ya exige la
protección de las peticiones de `/api/v1`.

#### Scenario: Origen HTTPS en producción
- **WHEN** la API arranca en producción con el origen de la autenticación en `https:`
- **THEN** la API arranca

#### Scenario: Origen HTTP público en producción
- **WHEN** la API arranca en producción con el origen de la autenticación en `http:` y un host
  distinto de `localhost`, `127.0.0.1` y `::1`, incluido uno que solo se les parece
- **THEN** la API no arranca

#### Scenario: Origen HTTP de bucle local en producción
- **WHEN** la API arranca en producción con el origen de la autenticación en `http://localhost`,
  `http://127.0.0.1` o `http://[::1]`, con su puerto
- **THEN** la API arranca, para permitir una prueba de humo del software de producción sin
  exponerlo

### Requirement: Destino interno de la API obligatorio en producción, al construir y al ejecutar
El build de producción del frontend SHALL exigir el destino interno de la API de forma explícita,
como una URL `http:` o `https:` válida, sin caer en un valor de bucle local por defecto; un valor
ausente o inválido SHALL detener el build. En tiempo de ejecución, toda ruta del servidor que lea
ese destino SHALL fallar de forma determinista en producción si falta, sin caer tampoco en el
bucle local. El destino nunca SHALL derivarse de `Host` ni de una cabecera reenviada, y ningún
rechazo SHALL mostrar su valor. En desarrollo, SHALL seguir admitiendo el bucle local por defecto.
La documentación del despliegue SHALL dejar claro que el valor usado en tiempo de ejecución debe
coincidir con el usado al construir ese build.

#### Scenario: Destino declarado en el build de producción
- **WHEN** el frontend se construye para producción con el destino interno de la API declarado
- **THEN** el build se completa y reenvía `/api` a ese destino

#### Scenario: Destino ausente o inválido en el build de producción
- **WHEN** el frontend se construye para producción sin declarar el destino interno de la API, o
  con un valor que no es una URL `http:` o `https:` válida
- **THEN** el build falla con un mensaje que nombra la variable, sin generar un reenvío hacia un
  destino de bucle local por defecto

#### Scenario: Destino ausente al ejecutar en producción
- **WHEN** una ruta del servidor del frontend que lee el destino interno atiende una petición en
  producción y la variable no está declarada
- **THEN** la petición falla de forma determinista, sin contactar ningún destino de bucle local
  por defecto ni uno derivado de la petición

### Requirement: Los rechazos de configuración no revelan secretos
Ningún rechazo de arranque o de build por esta configuración SHALL mostrar las credenciales de la
base de datos, el secreto de autenticación, la clave maestra de custodia, una contraseña de
certificado, datos de un certificado ni el volcado completo del entorno. Cada rechazo SHALL nombrar
la variable o la regla que no se cumplió.

#### Scenario: Mensaje sin secretos
- **WHEN** la API rechaza el arranque por cualquiera de estas reglas
- **THEN** el mensaje nombra la variable o la regla, y no contiene el valor de ningún secreto ni el
  entorno completo
