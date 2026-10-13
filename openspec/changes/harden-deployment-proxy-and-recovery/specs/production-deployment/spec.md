# Spec Delta

## Purpose

Define el comportamiento observable del despliegue de producción de referencia: qué servicios son
públicos y cuáles privados, cómo el borde TLS redirige, protege y enruta las peticiones, qué IP del
cliente llega a la aplicación, qué tamaños y esperas admite, qué estado sobrevive a recrear los
contenedores, y cómo un respaldo restaurado en una base nueva vuelve a dar una aplicación
utilizable, sin ningún tráfico al SRI.

## ADDED Requirements

### Requirement: Superficie pública limitada al borde TLS
En el despliegue de referencia, el único servicio alcanzable desde fuera SHALL ser el borde TLS, en
el puerto HTTPS y en el puerto HTTP solo para redirigir. La interfaz, la API y la base de datos SHALL
quedar en una red privada, sin puertos publicados en el servidor, y solo el borde y los propios
servicios de la aplicación SHALL alcanzarlas.

#### Scenario: Solo el borde es público
- **WHEN** se inspeccionan los puertos que el despliegue publica en el servidor
- **THEN** solo aparecen el puerto HTTPS y el puerto HTTP del borde, y ningún puerto de la interfaz,
  de la API ni de la base de datos

#### Scenario: Servicios internos inalcanzables desde fuera
- **WHEN** un cliente externo intenta conectar directamente con la interfaz, la API o la base de
  datos
- **THEN** la conexión no se establece, y la única forma de llegar a la aplicación es a través del
  borde

### Requirement: Redirección a HTTPS y HSTS en el borde
El borde SHALL responder a toda petición HTTP con una redirección permanente al mismo recurso en el
origen HTTPS canónico de la instalación, sin servir contenido de la aplicación por HTTP. Toda
respuesta HTTPS del borde SHALL llevar una sola cabecera `Strict-Transport-Security: max-age=31536000`,
sin `includeSubDomains` ni `preload`: el borde es su única fuente pública y descarta la que traiga la
respuesta de la aplicación. Una respuesta HTTP nunca SHALL llevar esa cabecera.

#### Scenario: Petición HTTP redirigida
- **WHEN** un cliente pide una página o una ruta de la API por HTTP
- **THEN** recibe una redirección permanente al mismo recurso en el origen HTTPS canónico, sin
  contenido de la aplicación

#### Scenario: HSTS en las respuestas HTTPS
- **WHEN** un cliente pide una página o una ruta de la API por HTTPS, también cuando la respuesta es
  un error
- **THEN** la respuesta lleva una sola cabecera `Strict-Transport-Security: max-age=31536000`, sin
  `includeSubDomains` ni `preload`, aunque la aplicación haya enviado otra

#### Scenario: Sin HSTS por HTTP
- **WHEN** el borde responde a una petición HTTP con su redirección
- **THEN** la respuesta no lleva `Strict-Transport-Security`

### Requirement: Enrutamiento del borde por origen único
En el mismo origen público, el borde SHALL enviar toda petición bajo `/api/` directamente a la API,
sin pasar por la interfaz, y toda otra petición a la interfaz. El navegador SHALL seguir viendo un
solo origen para las páginas y la API.

#### Scenario: La API atiende `/api/` directamente
- **WHEN** un cliente pide una ruta de `/api/v1` o de `/api/auth` por el origen público
- **THEN** la responde la API, con su sobre de error cuando corresponde, sin pasar por la interfaz

#### Scenario: La interfaz atiende las páginas
- **WHEN** un cliente pide una página de la aplicación por el origen público
- **THEN** la responde la interfaz, con su política de seguridad del navegador

### Requirement: Salud y métricas fuera del origen público
El borde SHALL rechazar por el origen público las rutas de salud y de métricas de la API, sin
reenviarlas, de forma explícita y no por un 404 accidental de la interfaz. Esas rutas SHALL seguir
alcanzables por la red privada para las comprobaciones del despliegue.

#### Scenario: Salud no publicada
- **WHEN** un cliente pide la salud de vida o de preparación de la API por el origen público
- **THEN** el borde la rechaza sin reenviarla a la API ni a la interfaz

#### Scenario: Métricas no publicadas
- **WHEN** un cliente pide las métricas de la API por el origen público
- **THEN** el borde las rechaza sin reenviarlas

#### Scenario: Comprobaciones internas
- **WHEN** el despliegue comprueba la salud de la API por la red privada
- **THEN** la API responde con su estado de vida y de preparación

### Requirement: IP real del cliente y cabeceras reenviadas no confiables
La API SHALL tomar como IP del cliente la dirección que observó el borde, y solo SHALL confiar en
las cabeceras reenviadas cuando la petición llega desde la dirección interna explícita del borde. El
borde SHALL sustituir cualquier cadena de reenvío que traiga el cliente por la dirección que él
observa. Una petición de cualquier otro servicio interno SHALL tratarse como un cliente directo.

#### Scenario: IP del cliente a través del borde
- **WHEN** un cliente pide una ruta de la API a través del borde
- **THEN** la API atribuye la petición, también en el límite de intentos y en los eventos de
  seguridad, a la dirección que observó el borde

#### Scenario: Cadena de reenvío falsificada por el cliente
- **WHEN** un cliente envía su propia cabecera de reenvío con otra dirección
- **THEN** la API atribuye la petición a la dirección que observó el borde, nunca a la falsificada

#### Scenario: Otro servicio interno no es un proxy de confianza
- **WHEN** un servicio interno distinto del borde llama a la API con una cabecera de reenvío
- **THEN** la API atribuye la petición a la dirección de ese servicio e ignora la cabecera

### Requirement: Techo de cuerpo en el borde
El borde SHALL admitir en `/api/` cuerpos de hasta 8 MiB, por encima del mayor cuerpo legítimo de la
API, y de hasta 1 MiB en el resto. Un cuerpo mayor SHALL rechazarse en el borde con `413`, sin
llegar a la aplicación. Los límites propios de cada ruta de la API no cambian y siguen decidiendo
por debajo del techo.

#### Scenario: Cuerpo legítimo grande hasta la API
- **WHEN** un cliente envía a una ruta de `/api/` un cuerpo del tamaño del mayor borrador que admite
  la API
- **THEN** el cuerpo llega a la API, que responde según su propia autenticación, protección y
  límites

#### Scenario: Cuerpo de la API sobre el techo
- **WHEN** un cliente envía a `/api/` un cuerpo de más de 8 MiB
- **THEN** el borde responde `413` sin reenviarlo

#### Scenario: Cuerpo fuera de la API sobre su techo
- **WHEN** un cliente envía fuera de `/api/` un cuerpo de más de 1 MiB
- **THEN** el borde responde `413` sin reenviarlo

### Requirement: Espera extendida solo para la descarga de portabilidad
El borde SHALL esperar hasta 180 s el primer byte de la descarga del paquete de portabilidad y SHALL
entregarla por streaming, sin guardar el paquete en su almacenamiento temporal. Las demás rutas
SHALL conservar una espera normal de unos 60 s.

#### Scenario: Descarga con primer byte tardío
- **WHEN** la descarga de un paquete tarda más que la espera normal en enviar su primer byte, pero
  menos que la extendida
- **THEN** el borde mantiene la conexión y entrega el paquete completo por streaming

#### Scenario: Otra ruta lenta
- **WHEN** cualquier otra ruta tarda más que la espera normal en responder
- **THEN** el borde responde con un error de puerta de enlace, sin esperar la extendida

### Requirement: Estado persistente al recrear la aplicación
Los datos de la base de datos y los paquetes de portabilidad listos SHALL sobrevivir a detener y
recrear los contenedores de la aplicación, mientras no se borren sus volúmenes. Esto no SHALL
presentarse como un respaldo.

#### Scenario: Datos tras recrear los contenedores
- **WHEN** se recrean los contenedores de la aplicación sin borrar sus volúmenes
- **THEN** la empresa, los usuarios y la configuración siguen presentes y la aplicación vuelve a
  estar lista

#### Scenario: Paquete listo tras recrear los contenedores
- **WHEN** se recrean los contenedores con un paquete de portabilidad listo y vigente
- **THEN** el paquete sigue descargable, con el mismo contenido

### Requirement: Respaldo verificable de la base de datos
El respaldo de la base de datos SHALL producir un volcado en el formato propio de PostgreSQL de la
misma versión mayor, y registrar su SHA-256. Un volcado alterado o truncado SHALL detectarse antes
de usarlo, por su suma o por el fallo de la restauración. Un respaldo SHALL considerarse
demostrado solo cuando se ha restaurado.

#### Scenario: Respaldo con su suma
- **WHEN** el operador respalda la base de datos
- **THEN** obtiene el volcado y su SHA-256 registrado, sin la clave maestra ni otros secretos dentro

#### Scenario: Volcado alterado
- **WHEN** se intenta restaurar un volcado truncado o modificado
- **THEN** la suma no coincide o la restauración falla, y la base de destino no queda presentada
  como recuperada

### Requirement: Restauración en una base nueva
La restauración SHALL escribir solo en una base de destino vacía, y SHALL negarse a escribir sobre
una base con datos salvo con una opción destructiva explícita y documentada. Tras restaurar, las
migraciones SHALL aplicarse sin pérdida de datos, la aplicación SHALL arrancar sobre la base
restaurada y SHALL conservar, comparado con el estado anterior al respaldo, sus usuarios, su
empresa, sus membresías, su configuración, su custodia cifrada y el contenido de sus artefactos
almacenados. Un paquete de portabilidad listo cuyo archivo no se restauró SHALL quedar fallido de
forma cerrada, con su código y su evento de auditoría, y nunca SHALL entregarse; la empresa SHALL
poder generar uno nuevo.

#### Scenario: Restauración completa en una base nueva
- **WHEN** se restaura un respaldo válido en una base nueva y vacía de la misma versión mayor
- **THEN** las migraciones no cambian datos, la aplicación arranca y queda lista, y los recuentos,
  las huellas de los datos y los SHA-256 de los artefactos coinciden con los anteriores al respaldo

#### Scenario: Destino con datos
- **WHEN** se intenta restaurar sobre una base que ya tiene datos, sin la opción destructiva
- **THEN** la restauración se niega antes de escribir y no mezcla el respaldo con los datos
  existentes

#### Scenario: Paquete de portabilidad sin su archivo
- **WHEN** tras restaurar, la aplicación arranca con un paquete que figuraba listo y cuyo archivo no
  forma parte del respaldo, y el administrador intenta descargarlo
- **THEN** la exportación queda fallida con `DATA_EXPORT_PACKAGE_MISSING` y su evento de auditoría
  (lo detecta el barrido al arrancar o la propia descarga), la descarga no entrega ningún byte, y la
  empresa puede generar una exportación nueva

### Requirement: Custodia de la firma y clave maestra en la recuperación
Un respaldo de la base de datos SHALL ser insuficiente por sí solo para recuperar la custodia de la
firma: solo con la misma clave maestra, que el operador guarda aparte, SHALL volver a estar
disponible el certificado custodiado. Con otra clave, la aplicación SHALL arrancar y funcionar, pero
el certificado SHALL mostrarse no disponible y la firma SHALL quedar bloqueada hasta volver a
cargarlo.

#### Scenario: Misma clave maestra
- **WHEN** la aplicación arranca sobre la base restaurada con la misma clave maestra
- **THEN** el certificado custodiado aparece disponible, sin firmar ningún comprobante para
  comprobarlo

#### Scenario: Otra clave maestra
- **WHEN** la aplicación arranca sobre la base restaurada con una clave maestra distinta
- **THEN** la aplicación queda lista, el certificado aparece no disponible, y ningún mensaje muestra
  el contenido cifrado, el P12, su contraseña ni una clave

### Requirement: Sin salida a Internet por defecto
En el despliegue de referencia, los servicios de la aplicación SHALL carecer de salida a Internet
por defecto, además de la transmisión al SRI apagada por la configuración. Dar salida al backend
SHALL requerir una decisión explícita del dueño, documentada y nunca activa en las pruebas, en la CI
ni en la topología por defecto.

#### Scenario: Salida bloqueada por defecto
- **WHEN** un servicio de la aplicación intenta conectar con un destino fuera de la red privada en
  la topología por defecto
- **THEN** la conexión falla, y ningún destino externo recibe tráfico

#### Scenario: Salida deliberada documentada
- **WHEN** el dueño decide habilitar el uso real del SRI
- **THEN** la documentación describe el paso explícito que da salida al backend, separado de la
  topología por defecto y de la habilitación de la transmisión

### Requirement: Arranque y apagado ordenados
El backend SHALL arrancar solo después de que la base de datos esté sana y las migraciones se hayan
aplicado con éxito; si una migración falla, el despliegue SHALL fallar sin arrancar el backend. El
despliegue SHALL considerar lista la API solo cuando su preparación responde, y la salud de vida
SHALL bastar para no reiniciar el contenedor por una dependencia caída. Al detenerse, el backend
SHALL terminar sus peticiones en curso y cerrar sus recursos dentro del plazo de gracia, sin una
terminación forzada.

#### Scenario: Migración fallida
- **WHEN** la migración de la base de datos falla durante un despliegue
- **THEN** el backend no arranca y el despliegue informa el fallo

#### Scenario: Apagado normal
- **WHEN** el operador detiene el backend
- **THEN** el proceso cierra sus recursos y termina con éxito antes de agotar el plazo de gracia

### Requirement: Imágenes sin secretos ni privilegios
Las imágenes de producción SHALL contener solo lo necesario para ejecutar la aplicación, sin
archivos de entorno, certificados PKCS#12, claves privadas, salidas de build locales ni secretos, y
los procesos de la interfaz y de la API SHALL ejecutarse sin privilegios de administrador.

#### Scenario: Contexto de build sin archivos prohibidos
- **WHEN** el directorio del repositorio contiene archivos de entorno, certificados, claves o salidas
  de build sintéticos y se construyen las imágenes
- **THEN** ninguno de esos archivos llega al contexto ni a las imágenes

#### Scenario: Procesos sin privilegios
- **WHEN** se inspeccionan los procesos de la interfaz y de la API en ejecución
- **THEN** ninguno corre como administrador
