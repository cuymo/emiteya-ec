# web-security-policy Specification

## Purpose

Define la política de seguridad que el navegador aplica a la interfaz web del facturador: qué
puede ejecutar, cargar y enmarcar cada documento, quién es su única autoridad y qué cambia entre
desarrollo y producción, sin romper los flujos legítimos del operador.

## Requirements

### Requirement: Cabeceras de seguridad del documento
Cada documento HTML que sirve la interfaz web SHALL llevar:
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: same-origin`;
- `Cross-Origin-Opener-Policy: same-origin`;
- una `Permissions-Policy` que niega las capacidades del navegador que la interfaz no usa.

#### Scenario: Documento de una ruta pública
- **WHEN** un navegador pide la página de inicio de sesión
- **THEN** la respuesta lleva `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` y
  `Cross-Origin-Opener-Policy: same-origin`
- **AND** lleva una `Permissions-Policy` que niega cámara, micrófono, geolocalización y pago

#### Scenario: Documento de una ruta autenticada
- **WHEN** un navegador pide la página de un comprobante
- **THEN** la respuesta lleva las mismas cuatro cabeceras con los mismos valores

### Requirement: Política de contenido aplicada en producción
En producción, cada documento HTML de la interfaz SHALL llevar una `Content-Security-Policy` que
el navegador aplica y bloquea, no solo una `Content-Security-Policy-Report-Only`.

#### Scenario: Política aplicada
- **WHEN** un navegador pide cualquier página de la interfaz en producción
- **THEN** la respuesta lleva la cabecera `Content-Security-Policy`
- **AND** un recurso que la política no admite se bloquea, no solo se informa

### Requirement: Una sola autoridad de la política
La interfaz web SHALL ser la única fuente de la política de contenido de sus documentos. Cada
documento lleva exactamente una política efectiva, sin otra en una etiqueta `meta` ni en una
segunda cabecera.

#### Scenario: Exactamente una política
- **WHEN** un navegador pide cualquier página de la interfaz
- **THEN** la respuesta lleva una sola cabecera `Content-Security-Policy`
- **AND** el documento no declara otra política en una etiqueta `meta`

#### Scenario: Respuestas de la API
- **WHEN** el navegador llama a la API en el mismo origen
- **THEN** la respuesta de la API conserva sus propias cabeceras de seguridad
- **AND** la política de los documentos de la interfaz no cambia

### Requirement: Scripts autorizados por petición
En producción, la política SHALL admitir solo los scripts que la interfaz autoriza en esa misma
respuesta. No SHALL admitir `'unsafe-inline'` ni `'unsafe-eval'` para scripts ni ningún manejador
de eventos escrito como atributo. Un script inyectado sin autorización no se ejecuta.

#### Scenario: Sin ejecución de scripts inyectados
- **WHEN** una página de producción contiene un script en línea que la interfaz no autorizó
- **THEN** el navegador no lo ejecuta y registra la violación de la política

#### Scenario: Sin manejadores de eventos en atributos
- **WHEN** una página de producción contiene un elemento con un manejador como `onclick` escrito en
  un atributo
- **THEN** el navegador no ejecuta ese manejador
- **AND** la política declara `script-src-attr 'none'`

#### Scenario: Sin evaluación dinámica de código
- **WHEN** se lee la política de un documento de producción
- **THEN** no contiene `'unsafe-eval'` ni `'unsafe-inline'` en `script-src`

### Requirement: Nonce de un solo uso
El nonce que autoriza los scripts SHALL generarse con una fuente aleatoria criptográficamente segura,
con al menos 128 bits de entropía, de forma independiente para cada documento. No SHALL derivarse de
datos de la petición, del usuario ni de la sesión, ni guardarse ni escribirse en los registros. En
cada respuesta, el mismo nonce va en la política y en todos los scripts legítimos.

#### Scenario: Nonce distinto en cada documento
- **WHEN** un navegador pide dos veces la misma página de producción
- **THEN** cada respuesta lleva un nonce distinto, con una codificación válida en la sintaxis de la
  política y de al menos 128 bits

#### Scenario: Un mismo nonce por respuesta
- **WHEN** se lee un documento de producción
- **THEN** los scripts del framework y el script del tema llevan el mismo nonce que declara su
  política
- **AND** se ejecutan sin violaciones

#### Scenario: Nonce fuera de los registros
- **WHEN** la interfaz sirve documentos de producción
- **THEN** ningún nonce de esas respuestas aparece en la salida del servidor de la interfaz

### Requirement: Documentos fuera de las cachés compartidas
Un documento HTML que lleva nonce SHALL responder con una política de caché que impide guardarlo en
una caché compartida y reutilizarlo en otra petición. Los recursos estáticos del build SHALL
conservar su caché habitual de larga duración.

#### Scenario: Documento con nonce
- **WHEN** un navegador pide cualquier página de producción
- **THEN** la respuesta declara una caché privada y sin almacenamiento compartido
- **AND** no declara `public` ni `s-maxage`

#### Scenario: Recurso estático
- **WHEN** un navegador pide un recurso de `/_next/static`
- **THEN** la respuesta conserva su caché pública, larga e inmutable

### Requirement: Prohibición de enmarcado
La interfaz web SHALL impedir que cualquier sitio, incluido el propio, la muestre dentro de un marco.

#### Scenario: Intento de enmarcar la aplicación
- **WHEN** una página de otro origen intenta cargar la interfaz dentro de un `iframe`
- **THEN** el navegador se niega a mostrarla
- **AND** la política del documento declara `frame-ancestors 'none'`

### Requirement: Sin plugins, cambio de base ni envíos nativos de formularios
La política SHALL prohibir plugins y objetos incrustados, impedir que el documento cambie su
dirección base a otro origen y bloquear el envío nativo de formularios: la interfaz envía todos sus
formularios con JavaScript.

#### Scenario: Objetos incrustados
- **WHEN** se lee la política de un documento
- **THEN** declara `object-src 'none'`

#### Scenario: Base y formularios
- **WHEN** se lee la política de un documento
- **THEN** declara `base-uri 'self'` y `form-action 'none'`

#### Scenario: Envío nativo antes de la hidratación
- **WHEN** un formulario intenta enviarse de forma nativa, sin el JavaScript de la interfaz
- **THEN** el navegador bloquea el envío, y sus campos no viajan en la dirección

### Requirement: Orígenes limitados a la propia aplicación
La política SHALL limitar los scripts, estilos, imágenes, fuentes, conexiones y marcos al propio
origen. La única excepción es la dirección local que el navegador crea para imprimir un archivo
descargado, y solo en los marcos. No SHALL admitir comodines ni esquemas completos como origen.

#### Scenario: Recurso de otro origen
- **WHEN** una página intenta cargar un script, una hoja de estilos, una imagen o una conexión de
  otro origen
- **THEN** el navegador lo bloquea

#### Scenario: Sin comodines
- **WHEN** se lee la política de un documento de producción
- **THEN** ninguna directiva contiene `*`, ni `https:` o `http:` como origen completo
- **AND** `blob:` aparece solo en `frame-src`

### Requirement: Excepción de estilos acotada
La política SHALL admitir estilos en línea solo en las directivas de estilo que la interfaz
necesita, según la medición en un navegador real (elementos `<style>`, atributos `style` o ambos).
La excepción no SHALL alcanzar ninguna directiva de scripts y queda declarada como deuda con su
salida.

#### Scenario: Excepción solo donde se necesita
- **WHEN** se lee la política de un documento de producción
- **THEN** `'unsafe-inline'` aparece solo en las directivas de estilo que la medición exige
- **AND** nunca en `script-src`, `script-src-elem` ni `script-src-attr`

#### Scenario: Excepción declarada
- **WHEN** la política conserva `'unsafe-inline'` en alguna directiva de estilo
- **THEN** la deuda técnica registra su razón, su alcance, su riesgo y su salida

### Requirement: Flujos legítimos del navegador sin violaciones
Con la política y las cabeceras activas, incluida `Cross-Origin-Opener-Policy`, la interfaz SHALL
funcionar sin violaciones de la política en sus flujos legítimos:
- carga e hidratación de las páginas;
- inicio de sesión, sesión y cierre de sesión;
- llamadas a la API en el mismo origen;
- el logo de la empresa, las descargas, la impresión del RIDE, los avisos y el cambio de tema.

#### Scenario: Inicio y cierre de sesión
- **WHEN** un operador inicia sesión, navega a una pantalla autenticada y cierra la sesión
- **THEN** cada paso funciona como antes del cambio
- **AND** el navegador no registra ninguna violación de la política

#### Scenario: Páginas e interacciones
- **WHEN** un operador abre una lista, un detalle, un diálogo y un aviso, y cambia el tema
- **THEN** las páginas cargan su JavaScript y su CSS, se hidratan y responden
- **AND** el navegador no registra ninguna violación de la política

#### Scenario: Logo, descarga e impresión
- **WHEN** un operador ve el logo de la empresa, descarga un RIDE y lo manda a imprimir
- **THEN** el logo se muestra, el archivo se descarga y el diálogo de impresión se abre
- **AND** el navegador no registra ninguna violación de la política

### Requirement: Concesiones de desarrollo ausentes en producción
Las concesiones que la política necesita solo en desarrollo, como la evaluación de código para
depurar o la conexión de recarga en caliente, SHALL existir únicamente en el servidor de desarrollo
y nunca en un build de producción.

#### Scenario: Política de producción
- **WHEN** se sirve un build de producción
- **THEN** la política no contiene ninguna concesión exclusiva de desarrollo

#### Scenario: Política de desarrollo
- **WHEN** se sirve la interfaz con el servidor de desarrollo
- **THEN** la política puede añadir esas concesiones
- **AND** conserva `object-src 'none'`, `base-uri 'self'`, `script-src-attr 'none'` y
  `frame-ancestors 'none'`

### Requirement: HSTS en el borde TLS
La interfaz web SHALL dejar HSTS (`Strict-Transport-Security`) al proxy que termina TLS. No SHALL
enviar esa cabecera, porque solo el borde sabe si la conexión llegó por HTTPS.

#### Scenario: Documento servido sin el proxy
- **WHEN** se pide una página directamente al servidor de la interfaz
- **THEN** la respuesta no lleva `Strict-Transport-Security`

#### Scenario: Responsabilidad documentada
- **WHEN** un operador prepara el despliegue con su proxy TLS
- **THEN** la documentación de despliegue le indica que configure HSTS en ese proxy
- **AND** que no añada otra `Content-Security-Policy` ni guarde los documentos en una caché
  compartida
