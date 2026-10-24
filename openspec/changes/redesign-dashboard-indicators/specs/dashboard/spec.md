## MODIFIED Requirements

### Requirement: Resumen de la actividad de la empresa
El sistema SHALL calcular en el servidor un resumen de la empresa de la sesión en su ambiente vigente, con la fecha de hoy en Ecuador: lo facturado y autorizado en el mes en curso y en el mes anterior, con la variación entre ambos en porcentaje; las facturas emitidas en el mes; lo facturado y autorizado en cada uno de los seis últimos meses; los comprobantes del mes por tipo, emitidos y autorizados, con su total autorizado salvo la guía de remisión, que no tiene total; los comprobantes que requieren atención, por un resultado incierto, una revisión manual o una transmisión detenida; los devueltos o no autorizados en los últimos 30 días; los comprobantes con su último envío por correo fallido y los que lo tienen en cola; los borradores de factura pendientes; los productos con inventario inicializado y saldo agotado; los cinco clientes y los cinco productos con más facturado y autorizado en el mes; los últimos comprobantes emitidos; si la transmisión al SRI está encendida en el despliegue; y la última comunicación guardada con el SRI en el ambiente vigente, con su fecha y si recibió respuesta. Las ventas SHALL ser solo las facturas autorizadas. Los importes SHALL salir de lo que cada comprobante congeló al reservar su número, nunca del tercero, el producto ni el catálogo vigentes. El resumen no SHALL contactar al SRI ni a ningún servidor de correo. Lo consulta quien puede consultar facturas.

#### Scenario: Una factura reservada no es una venta
- **WHEN** una empresa emite una factura que todavía no está autorizada
- **THEN** el resumen la cuenta entre las facturas emitidas del mes y entre los últimos comprobantes, pero no en las ventas autorizadas

#### Scenario: Ambiente vigente
- **WHEN** una empresa en Pruebas consulta el resumen
- **THEN** el resumen solo cuenta los comprobantes de Pruebas

#### Scenario: Aislamiento por empresa
- **WHEN** dos empresas consultan su resumen
- **THEN** ninguna ve comprobantes, clientes ni productos de la otra

#### Scenario: Variación de las ventas
- **WHEN** una empresa autorizó $1.000,00 el mes anterior y $1.095,00 en el mes en curso
- **THEN** el resumen da una variación de 9,5 %
- **AND** sin ventas el mes anterior, no da variación

#### Scenario: Conexión con el SRI sin contactarlo
- **WHEN** una empresa consulta el resumen y su último intento guardado con el SRI recibió respuesta
- **THEN** el resumen da la fecha de ese intento y que recibió respuesta, sin abrir ninguna conexión al SRI

### Requirement: Tablero de Inicio
Inicio SHALL mostrar el tablero a quien puede consultar facturas, y solo la preparación para emitir a cualquier otro rol. Los requisitos pendientes para emitir no SHALL ir en el tablero: tienen su propia página, «Primeros pasos». El tablero SHALL mostrar cuatro indicadores (ventas autorizadas del mes con su variación frente al mes anterior, facturas autorizadas sobre las emitidas en el mes con su porcentaje, problemas de autorización de los últimos 30 días y facturas en borrador), cada uno con su icono, un enlace a su lista y un degradado azul suave, las ventas autorizadas de los seis últimos meses en una línea con área y una tabla equivalente para las tecnologías de asistencia, los comprobantes del mes por tipo en barras apiladas de lo autorizado sobre lo emitido, con su total autorizado, su leyenda y una tabla equivalente, los mejores clientes en una dona con su leyenda de nombres e importes y los productos más vendidos en columnas con su código, cada uno con una tabla equivalente, el estado de facturación electrónica (firma electrónica, conexión con el SRI y entrega de comprobantes), cada fila con un estado en texto y un enlace a su sección cuando el rol puede abrirla, y los últimos comprobantes enlazados a su detalle. Sin comprobantes, SHALL invitar a emitir el primero. Un error al cargar SHALL poder reintentarse. El tablero no SHALL calcular importes en el navegador.

#### Scenario: Empresa con actividad
- **WHEN** un operador abre Inicio en una empresa que ya emite
- **THEN** ve las ventas autorizadas del mes, las facturas autorizadas, los problemas de autorización, los borradores, las ventas de los seis meses y los últimos comprobantes, cada uno enlazado a su detalle

#### Scenario: Indicadores comerciales
- **WHEN** un operador abre Inicio en un mes con 18 facturas emitidas, 15 autorizadas y ventas 9,5 % mayores que el mes anterior
- **THEN** ve «15 / 18» con «83,3 % de las facturas del mes» y la variación «+9,5 %» junto a las ventas, con una flecha hacia arriba

#### Scenario: Empresa que no puede emitir
- **WHEN** un administrador abre Inicio en una empresa sin firma electrónica
- **THEN** el tablero no muestra los requisitos pendientes, y la barra superior ofrece «Falta configurar», que lleva a «Primeros pasos» con el requisito pendiente y la forma de resolverlo

#### Scenario: Sin comprobantes
- **WHEN** un usuario abre Inicio en una empresa que todavía no emite
- **THEN** el tablero dice que aún no hay comprobantes en su ambiente y ofrece crear una factura

#### Scenario: Comprobantes del mes por tipo
- **WHEN** un operador abre Inicio en un mes con 18 facturas emitidas, 15 de ellas autorizadas
- **THEN** la barra de Factura mide 18, con 15 en azul y 3 en gris, dice «15 de 18» en su extremo y «Factura» con su total autorizado encima, y la leyenda nombra «Autorizados» y «Sin autorizar»

#### Scenario: Mejores clientes en una dona
- **WHEN** un operador abre Inicio en un mes con cinco clientes con facturas autorizadas
- **THEN** ve una dona con una porción por cliente, cada una con su color en un orden fijo, y una leyenda en el mismo orden con el nombre y lo facturado de cada uno

#### Scenario: Estado de facturación electrónica
- **WHEN** un administrador abre Inicio con la firma vigente por 85 días, una última comunicación correcta con el SRI y dos comprobantes con el correo fallido
- **THEN** ve «Firma electrónica» con «Vigente · Vence en 85 días» y «Activa», «Conexión con SRI» con su última comunicación correcta y «Disponible», y «Entrega de comprobantes» con «2 correos sin enviar» y «Revisar»

#### Scenario: Accesos rápidos del estado del sistema
- **WHEN** un administrador ve en el estado de facturación electrónica que la firma vence en 21 días y que hay correos sin enviar
- **THEN** la fila de la firma lo lleva a Firma electrónica y la de la entrega, a Todos los comprobantes con «Correo: No enviado»
- **AND** un operador ve el estado de la firma sin su enlace, porque no abre Configuración

#### Scenario: Gráficos accesibles
- **WHEN** un usuario de lector de pantalla llega a las ventas de los seis meses, a los comprobantes del mes o a los mejores clientes
- **THEN** encuentra una tabla con cada mes, sus facturas autorizadas y su total; con cada tipo, sus emitidos, sus autorizados y su total autorizado; o con cada cliente, su identificación, sus facturas y lo facturado
