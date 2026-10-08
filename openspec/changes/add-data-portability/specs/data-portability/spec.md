# Spec Delta

## Purpose

Permitir al administrador llevarse fuera del sistema, en un paquete autodescriptivo y versionado que se puede leer sin esta aplicación, los datos y artefactos que el sistema conserva de su empresa, sin secretos, sin convertirlo en un respaldo y sin importarlo ni restaurarlo.

## ADDED Requirements

### Requirement: Exportación de portabilidad de la empresa
El sistema SHALL permitir al administrador generar una exportación de portabilidad con los datos y artefactos de su empresa, en un paquete que se puede leer sin esta aplicación. La exportación no es un respaldo: el sistema no ofrece importar, restaurar ni volver a abrir un paquete, y exportar nunca cambia ni borra datos de la empresa.

#### Scenario: Administrador genera la exportación
- **WHEN** un administrador solicita una exportación de portabilidad
- **THEN** el sistema acepta la solicitud y, al terminar de generarla, ofrece un paquete con los datos y artefactos de su empresa

#### Scenario: Sin importación ni restauración
- **WHEN** un usuario busca importar, restaurar o volver a abrir un paquete de portabilidad
- **THEN** el sistema no ofrece ninguna operación para hacerlo

#### Scenario: Exportar no cambia la empresa
- **WHEN** se genera, se descarga o caduca una exportación
- **THEN** los comprobantes, los artefactos, la configuración, los terceros, los productos, el inventario y la auditoría de la empresa no cambian, salvo los eventos de auditoría de la propia exportación

### Requirement: Contenido del paquete
El paquete SHALL contener la configuración del contribuyente con todas sus versiones; los establecimientos, los puntos de emisión, los secuenciales y las habilitaciones de catálogos; los terceros y los productos en todos sus estados; los comprobantes de los seis tipos desde la reserva de su número, en todos sus estados, con sus transiciones, sus intentos con el SRI y sus entregas; las existencias y el kárdex; y la auditoría.

#### Scenario: Configuración con su historia
- **WHEN** el contribuyente cambió su razón social y su ambiente después de configurarse
- **THEN** el paquete contiene cada versión de la configuración con su vigencia

#### Scenario: Comprobantes en todos sus estados
- **WHEN** la empresa tiene comprobantes de los seis tipos reservados, firmados, autorizados, devueltos, no autorizados y en revisión manual
- **THEN** el paquete contiene cada uno con su estado y sus transiciones

#### Scenario: Terceros y productos inactivos
- **WHEN** la empresa desactivó un tercero y un producto
- **THEN** el paquete los contiene con su estado inactivo

#### Scenario: Inventario registrado
- **WHEN** un producto inicializado con 20 unidades tiene una salida por factura de 5 y una entrada manual de 3
- **THEN** el paquete contiene su saldo de 18 y sus tres movimientos, tal como los registra el inventario, sin recalcularlos

### Requirement: Usuarios y firmas como metadatos
El paquete SHALL contener de los usuarios de la empresa solo su nombre, su correo, su rol y su estado, y de cada firma, incluidas las reemplazadas, solo su titular, su emisor, su número de serie, su huella, su vigencia y su estado. Nunca contiene contraseñas ni sus hashes, cuentas, sesiones ni tokens de autenticación.

#### Scenario: Usuarios sin datos de autenticación
- **WHEN** el paquete contiene a los usuarios de la empresa
- **THEN** cada uno aparece con su nombre, su correo, su rol y su estado, y el paquete no contiene ninguna contraseña, hash, sesión ni token

#### Scenario: Firma reemplazada
- **WHEN** la empresa reemplazó su firma
- **THEN** el paquete contiene los metadatos de las dos firmas con su estado

### Requirement: Exclusión de la firma y los secretos
El paquete SHALL excluir siempre el archivo de la firma, cifrado o no, su contraseña, las claves que lo cifran, la clave maestra de la custodia y cualquier secreto del sistema. El paquete no permite reconstruir la firma ni su clave privada: para operar en otro sistema, el contribuyente vuelve a cargar su propia firma.

#### Scenario: Empresa con la firma activa
- **WHEN** un administrador exporta una empresa con una firma activa
- **THEN** el paquete no contiene el archivo de la firma en ninguna forma, ni su contraseña ni sus claves, solo sus metadatos

#### Scenario: Exclusión declarada
- **WHEN** un usuario lee el manifiesto o `LEEME.txt` del paquete
- **THEN** encuentra que la firma y sus secretos están excluidos y por qué

### Requirement: Borradores fuera de la versión 1
El paquete SHALL excluir los borradores de los seis tipos de comprobante: la versión 1 exporta el estado fiscal y operativo durable y sus artefactos, no el espacio de trabajo incompleto. La exclusión se declara en el manifiesto, en `LEEME.txt` y en la pantalla, nunca borra un borrador, y el paquete nunca se describe como un respaldo completo.

#### Scenario: Borrador sin emitir
- **WHEN** la empresa tiene un borrador de factura sin emitir y genera una exportación
- **THEN** el paquete no contiene el borrador, declara que los borradores están excluidos, y el borrador sigue disponible y editable en el sistema

### Requirement: Formato del paquete
El sistema SHALL entregar el paquete como un archivo ZIP llamado `datos-AAAAMMDD-HHMMSS.zip`, con `manifest.json`, `SHA256SUMS`, `LEEME.txt`, los libros XLSX de `data/`, una carpeta por comprobante en `documents/<produccion|pruebas>/<tipo>/<documento>/` y los logos en `assets/logos/`. El formato admite más de 65 535 archivos y más de 4 GiB, y no es un volcado de la base de datos.

#### Scenario: Estructura del paquete
- **WHEN** un usuario abre el paquete con una herramienta ZIP estándar
- **THEN** encuentra el manifiesto, el inventario, el `LEEME.txt`, los libros de `data/` y una carpeta por comprobante con su `snapshot.json` y sus artefactos disponibles

#### Scenario: Paquete grande
- **WHEN** la exportación tiene más de 65 535 archivos o más de 4 GiB
- **THEN** el paquete se genera completo y las herramientas estándar lo leen sin error

### Requirement: Rutas generadas por el servidor
Cada nombre y ruta del paquete SHALL salir solo de componentes que genera y valida el servidor: el ambiente, el tipo y el número del comprobante, el orden de un intento y nombres fijos. Ninguno contiene el RUC, el nombre de un tercero, un correo ni texto escrito por un usuario, ni rutas absolutas, `..`, barras invertidas o enlaces simbólicos, y dos archivos nunca comparten ruta.

#### Scenario: Razón social que parece una ruta
- **WHEN** un tercero tiene la razón social `../../etc/passwd`
- **THEN** ninguna ruta del paquete contiene ese texto y todos los archivos quedan dentro del paquete

#### Scenario: Mismo número en los dos ambientes
- **WHEN** una factura de Pruebas y otra de Producción tienen el número 001-001-000000001
- **THEN** cada una tiene su propia carpeta y ningún archivo se sobrescribe

#### Scenario: Nombre del paquete sin datos personales
- **WHEN** un administrador descarga el paquete
- **THEN** su nombre solo contiene la fecha y la hora de la generación, nunca el RUC ni el nombre de la empresa

### Requirement: Manifiesto del paquete
`manifest.json` SHALL contener `formatVersion` "1", `generatedAt`, `snapshotAt`, la identidad fiscal de la empresa, el alcance, los ambientes incluidos, los conteos, las versiones de los formatos y de los snapshots, las exclusiones y cada artefacto esperado pero ausente con su motivo. No contiene el inventario de los archivos, que está en `SHA256SUMS`.

#### Scenario: Versión del formato
- **WHEN** un lector abre el manifiesto
- **THEN** encuentra `formatVersion` "1" y la versión de cada formato de snapshot que contiene el paquete

#### Scenario: RIDE pendiente
- **WHEN** una factura autorizada todavía no tiene su RIDE
- **THEN** el manifiesto declara su RIDE como ausente por estar pendiente, y la exportación no lo genera

### Requirement: Inventario verificable del paquete
`SHA256SUMS` SHALL listar cada archivo interior del paquete, salvo él mismo, con su SHA-256, en el formato que verifican las herramientas estándar. El SHA-256 y el tamaño del paquete completo se calculan aparte y se muestran al administrador.

#### Scenario: Verificación independiente
- **WHEN** un administrador verifica el paquete descomprimido con una herramienta estándar de SHA-256
- **THEN** cada archivo listado coincide con su hash

#### Scenario: Archivo alterado después de descargar
- **WHEN** alguien altera un archivo del paquete después de descargarlo
- **THEN** la verificación con `SHA256SUMS` informa que ese archivo no coincide

#### Scenario: Hash del paquete
- **WHEN** un paquete queda listo
- **THEN** la pantalla muestra su SHA-256 y su tamaño, que coinciden con los del archivo descargado

### Requirement: Datos estructurados en XLSX
Los libros de `data/` SHALL escribir las identificaciones, los números, las claves y las autorizaciones como texto; los importes y las cantidades como números exactos cuando caben en la precisión segura de la hoja, y si no, como texto exacto; las fechas fiscales como fechas y los momentos con la hora de Ecuador; y el texto de los usuarios como texto, nunca como fórmula.

#### Scenario: Identificación con ceros a la izquierda
- **WHEN** se exporta un tercero con la cédula 0102030405
- **THEN** la celda contiene el texto 0102030405

#### Scenario: Importe como número
- **WHEN** se exporta una factura con un total de 106.00
- **THEN** la celda del total es un número con formato monetario que vale exactamente 106.00

#### Scenario: Valor que excede la precisión segura
- **WHEN** se exporta una cantidad con más dígitos significativos de los que la hoja conserva sin pérdida
- **THEN** la celda contiene el texto exacto del valor

#### Scenario: Texto que parece una fórmula
- **WHEN** se exporta un tercero cuya razón social es =HYPERLINK("http://ejemplo.invalid")
- **THEN** la celda contiene ese texto tal cual y la hoja no lo evalúa como fórmula

#### Scenario: Fecha de emisión
- **WHEN** se exporta un comprobante emitido el 2026-10-07
- **THEN** la celda es una fecha que vale el 7 de octubre de 2026, sin desplazarse por la zona horaria

### Requirement: Conjuntos que superan una hoja
Cuando un conjunto de datos supera las filas que admite una hoja de cálculo, el sistema SHALL continuarlo en hojas sucesivas del mismo libro, en el mismo orden y sin perder ni repetir filas, y el manifiesto SHALL indicar las hojas de cada conjunto.

#### Scenario: Kárdex de más de un millón de movimientos
- **WHEN** el kárdex de la empresa supera las filas de una hoja
- **THEN** los movimientos siguen en la hoja siguiente del mismo libro, en el mismo orden, y el manifiesto nombra las dos hojas

### Requirement: Datos históricos de los comprobantes
Cada comprobante del paquete SHALL mostrar los datos que congeló al reservar su número: su número, su fecha, su tercero, sus importes y sus líneas, con su `snapshot.json`. Una corrección posterior de un tercero, un producto o un catálogo no cambia lo que muestra; los terceros y los productos se exportan aparte con sus datos vigentes.

#### Scenario: Tercero corregido después de emitir
- **WHEN** el comprador de una factura emitida corrige su razón social
- **THEN** la factura del paquete muestra la razón social con que se emitió, y el libro de terceros muestra la vigente

### Requirement: Artefactos con sus bytes exactos
El paquete SHALL contener el XML firmado, el XML autorizado y el RIDE de cada comprobante que los tiene, y los logos de la configuración, con exactamente los bytes que el sistema conserva. Nunca los regenera ni consulta al SRI para obtenerlos.

#### Scenario: XML autorizado idéntico
- **WHEN** se compara el XML autorizado del paquete con el que descarga la bandeja
- **THEN** sus bytes son idénticos

#### Scenario: RIDE detenido
- **WHEN** la generación del RIDE de una factura autorizada está detenida
- **THEN** el paquete no contiene ese RIDE, no lo genera, y el manifiesto lo declara ausente por estar detenido

#### Scenario: Comprobante reservado
- **WHEN** un comprobante quedó reservado sin firmar
- **THEN** su carpeta contiene su `snapshot.json` y ningún XML, sin declararlo como ausente

### Requirement: Respuestas originales del SRI en el paquete
El paquete SHALL contener cada respuesta original del SRI que el sistema conserva, como un archivo separado con sus bytes exactos, identificada por el orden de su intento y por la operación (recepción, autorización o validez), con su SHA-256, su tamaño y si se truncó. Nunca va en una celda, nunca se vuelve a pedir al SRI, y el paquete no contiene la solicitud enviada.

#### Scenario: Intentos con respuesta
- **WHEN** un comprobante tuvo un intento de recepción y otro de autorización, ambos con respuesta
- **THEN** el paquete contiene las dos respuestas como archivos en el orden de sus intentos, y el libro de comprobantes lista cada intento con su operación, su SHA-256, su tamaño y el nombre de su archivo

#### Scenario: Respuesta truncada
- **WHEN** el sistema conservó una respuesta truncada por superar su límite
- **THEN** el paquete la contiene tal como se conservó, marcada como truncada

#### Scenario: Intento sin respuesta
- **WHEN** un intento terminó sin respuesta del SRI
- **THEN** el intento aparece en el libro de comprobantes sin archivo de respuesta

### Requirement: Integridad de los artefactos exportados
Antes de agregar un artefacto, una respuesta del SRI o un logo, el sistema SHALL comprobar que su tamaño y su SHA-256 coinciden con los que conserva. Si alguno no coincide, la exportación falla con un error de integridad y no entrega ningún paquete, ni siquiera parcial. Un artefacto legítimamente ausente no es una falla: se declara en el manifiesto con su motivo.

#### Scenario: Artefacto alterado
- **WHEN** el XML firmado de un comprobante no coincide con su SHA-256 conservado
- **THEN** la exportación queda fallida con un error de integridad, no hay paquete para descargar y el problema queda registrado sin los bytes del artefacto

#### Scenario: Logo alterado
- **WHEN** un logo de la configuración no coincide con su SHA-256 conservado
- **THEN** la exportación queda fallida con un error de integridad y no hay paquete para descargar

### Requirement: Momento consistente del paquete
El paquete SHALL representar un único momento, `snapshotAt`: sus datos y su inventario de artefactos corresponden a ese momento, y nada creado o cambiado después entra en el paquete.

#### Scenario: Comprobante emitido durante la generación
- **WHEN** se emite un comprobante después de `snapshotAt` y mientras se genera el paquete
- **THEN** el paquete no contiene ese comprobante

#### Scenario: Autorización durante la generación
- **WHEN** un comprobante firmado en `snapshotAt` se autoriza mientras se genera el paquete
- **THEN** el paquete lo contiene firmado, sin su XML autorizado, coherente con su estado en `snapshotAt`

#### Scenario: Tercero editado durante la generación
- **WHEN** un tercero cambia su correo después de `snapshotAt`
- **THEN** el paquete contiene el correo que tenía en `snapshotAt`

### Requirement: Los dos ambientes en el paquete
El paquete SHALL contener siempre los comprobantes de Pruebas y de Producción que existan, separados en sus rutas, con el ambiente en cada fila y los conteos de cada ambiente en el manifiesto. No aplica el ambiente vigente por defecto de los reportes ni ofrece filtrarlo.

#### Scenario: Empresa con los dos ambientes
- **WHEN** la empresa emitió comprobantes en Pruebas y en Producción
- **THEN** el paquete contiene los dos, cada uno bajo la carpeta de su ambiente y con su ambiente en cada fila

#### Scenario: Solo Pruebas
- **WHEN** la empresa solo emitió en Pruebas
- **THEN** el paquete contiene solo la carpeta de Pruebas y el manifiesto declara cero comprobantes de Producción

### Requirement: Generación asíncrona de la exportación
La exportación SHALL generarse fuera de la solicitud que la pide: queda en cola (`QUEUED`), se genera (`GENERATING`) y termina lista (`READY`) o fallida (`FAILED`) con un código seguro. Un paquete listo caduca (`EXPIRED`) solo por vencimiento o reemplazo. El administrador consulta su estado y su progreso por fase, y una generación interrumpida por un reinicio se retoma sin duplicarse.

#### Scenario: Solicitud aceptada
- **WHEN** un administrador solicita una exportación
- **THEN** el sistema responde de inmediato con la exportación en cola, sin esperar a generarla

#### Scenario: Progreso visible
- **WHEN** una exportación se está generando
- **THEN** el administrador ve su fase y, cuando se conoce, cuántos comprobantes lleva de su total, sin un porcentaje estimado

#### Scenario: Reinicio durante la generación
- **WHEN** el sistema se reinicia mientras genera una exportación
- **THEN** la generación se retoma desde el principio, termina con un solo paquete y no deja archivos parciales

#### Scenario: Falla con un código seguro
- **WHEN** una generación falla
- **THEN** la exportación queda fallida con un código y un mensaje que no contienen rutas, contenido del paquete ni datos personales

### Requirement: Una generación activa por empresa
El sistema SHALL permitir una sola generación activa, en cola o generándose, por empresa. Una nueva solicitud mientras otra está activa se rechaza indicando que ya hay una en curso, y las solicitudes simultáneas producen una sola generación.

#### Scenario: Segunda solicitud con una en curso
- **WHEN** un administrador solicita una exportación mientras otra de su empresa está en cola o generándose
- **THEN** el sistema rechaza la solicitud indicando que ya hay una en curso, y la primera continúa

#### Scenario: Solicitudes simultáneas
- **WHEN** dos administradores de la misma empresa solicitan una exportación al mismo tiempo
- **THEN** el sistema crea una sola generación y rechaza la otra solicitud

### Requirement: Un paquete vigente por empresa y su caducidad
Cada empresa SHALL tener a lo sumo un paquete listo vigente. Al generar de nuevo con uno vigente, el anterior sigue descargable hasta que el nuevo queda listo, y entonces caduca por reemplazo. Un paquete caduca 24 horas después de quedar listo, no de solicitarse; al caducar se borra el paquete, nunca los datos ni los artefactos de la empresa.

#### Scenario: Generar de nuevo
- **WHEN** un administrador genera de nuevo con un paquete listo vigente
- **THEN** el paquete anterior sigue descargable hasta que el nuevo queda listo, y entonces el anterior caduca

#### Scenario: Nueva generación fallida
- **WHEN** la nueva generación falla
- **THEN** el paquete anterior sigue listo y vigente hasta su caducidad

#### Scenario: Caducidad desde que quedó listo
- **WHEN** una exportación esperó dos horas en cola antes de quedar lista
- **THEN** su paquete caduca 24 horas después de quedar listo

#### Scenario: Paquete caducado
- **WHEN** un administrador intenta descargar un paquete caducado
- **THEN** el sistema responde que el paquete caducó, no entrega nada y ofrece generar uno nuevo

### Requirement: Paquete listo perdido o alterado
Si el archivo de un paquete listo falta, no tiene su tamaño o no coincide con su SHA-256 antes de caducar, el sistema SHALL dejar la exportación fallida con un código seguro de paquete faltante o de integridad, nunca caducada, y no entregar el archivo. El error no expone rutas internas. La caducidad queda solo para el vencimiento y el reemplazo por un paquete nuevo.

#### Scenario: Archivo perdido antes de caducar
- **WHEN** el archivo de un paquete listo desaparece antes de su caducidad
- **THEN** la exportación queda fallida con el código de paquete faltante y ofrece generar de nuevo

#### Scenario: Archivo alterado antes de caducar
- **WHEN** el archivo de un paquete listo no coincide con su tamaño o su SHA-256
- **THEN** la exportación queda fallida con el código de integridad y el archivo nunca se entrega

#### Scenario: Paquete vencido
- **WHEN** un paquete listo llega a su caducidad con su archivo intacto
- **THEN** la exportación queda caducada, no fallida

### Requirement: Descarga autenticada del paquete
El paquete SHALL descargarse solo por la ruta autenticada de la aplicación, nunca por un enlace público ni firmado. Antes del primer byte, el sistema comprueba la sesión, el permiso, la empresa, que el paquete está listo y vigente, y su tamaño y su SHA-256 completos; si algo no coincide, no entrega nada. Lo entrega como adjunto, con un nombre ASCII y sin caché.

#### Scenario: Descarga del paquete listo
- **WHEN** un administrador descarga un paquete listo y vigente
- **THEN** recibe el archivo como adjunto, sin caché, y su SHA-256 es el que muestra la pantalla

#### Scenario: Paquete alterado en el servidor
- **WHEN** el paquete guardado no coincide con su tamaño o su SHA-256
- **THEN** el sistema no envía ningún byte, responde con un error de integridad, deja la exportación fallida y registra el problema

#### Scenario: Paquete todavía en generación
- **WHEN** un administrador intenta descargar una exportación en cola o generándose
- **THEN** el sistema responde que todavía no está lista y no entrega nada

### Requirement: Defensa de recursos de la portabilidad
El sistema SHALL generar como máximo un número configurable de exportaciones a la vez por instancia, y las demás esperan en la cola. Antes de copiar los artefactos comprueba que el disco tiene la reserva configurada; si no, la exportación falla sin dejar un paquete parcial. No hay máximo de filas: el paquete está completo o falla. Son defensas de recursos del proyecto.

#### Scenario: Exportaciones de varias empresas
- **WHEN** dos empresas solicitan una exportación al mismo tiempo con una sola generación por instancia
- **THEN** una se genera y la otra espera en cola hasta que la primera termina

#### Scenario: Sin espacio en el disco
- **WHEN** el disco no tiene la reserva necesaria para el paquete
- **THEN** la exportación queda fallida con un código de espacio insuficiente, sin paquete parcial

#### Scenario: Sin máximo de filas
- **WHEN** la empresa tiene más comprobantes o movimientos que el máximo de filas de la exportación de un reporte
- **THEN** el paquete los contiene todos

### Requirement: Permisos de portabilidad
Solicitar, listar, consultar y descargar las exportaciones de portabilidad SHALL estar permitido solo al administrador, verificado en el servidor en cada solicitud. El operador no tiene acceso.

#### Scenario: Administrador exporta
- **WHEN** un administrador solicita, consulta y descarga una exportación
- **THEN** el sistema lo permite

#### Scenario: Operador sin acceso
- **WHEN** un operador solicita, lista, consulta o descarga una exportación
- **THEN** el sistema responde que no tiene acceso y no genera, lista ni entrega nada

#### Scenario: Sin sesión
- **WHEN** una solicitud sin sesión intenta cualquier operación de portabilidad
- **THEN** el sistema responde que se requiere iniciar sesión

### Requirement: Aislamiento de la portabilidad por empresa
Cada exportación SHALL contener solo datos de la empresa de la sesión, y solo un administrador de esa empresa puede verla y descargarla. La empresa nunca sale de la solicitud.

#### Scenario: Exportación de otra empresa
- **WHEN** un administrador consulta o descarga una exportación de otra empresa
- **THEN** el sistema responde como si no existiera, sin revelar nada de ella

#### Scenario: Paquete con solo su empresa
- **WHEN** un administrador genera la exportación de su empresa
- **THEN** el paquete no contiene ni permite inferir ningún comprobante, artefacto, tercero, producto, movimiento, usuario ni evento de otra empresa

#### Scenario: Empresa en la solicitud
- **WHEN** una solicitud de exportación incluye un identificador de empresa
- **THEN** el sistema la rechaza por contener datos no permitidos

### Requirement: Pantalla de portabilidad de datos
La pantalla Portabilidad de datos, en Configuración y solo para el administrador, SHALL explicar qué incluye y qué excluye el paquete, que no es un respaldo, que no contiene la firma y que trae Pruebas y Producción, y mostrar de cada exportación su estado, su progreso, el momento del snapshot, su caducidad, su tamaño y su SHA-256, con las acciones de descargar y de generar de nuevo.

#### Scenario: Explicación del paquete
- **WHEN** un administrador abre Portabilidad de datos
- **THEN** ve qué incluye y qué excluye el paquete, que no es un respaldo, que no contiene la firma y que trae Pruebas y Producción

#### Scenario: Paquete listo
- **WHEN** una exportación está lista
- **THEN** la pantalla muestra el momento del snapshot, la caducidad, el tamaño y el SHA-256, con la acción de descargar

#### Scenario: Exportación fallida
- **WHEN** una exportación falló
- **THEN** la pantalla explica la falla sin detalles internos y ofrece generar de nuevo

#### Scenario: Operador sin la pantalla
- **WHEN** un operador navega por la aplicación
- **THEN** no ve Portabilidad de datos y, si abre su ruta, la pantalla explica que no tiene acceso
