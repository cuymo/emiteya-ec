# dashboard Specification

## Purpose

Dar a quien abre el sistema un resumen de solo lectura de la actividad de su empresa en el ambiente vigente: cómo van las ventas autorizadas, qué comprobantes se emitieron, qué requiere atención y qué falta para seguir emitiendo, sin convertirlo en contabilidad ni en un reporte exportable.

## Requirements

### Requirement: Resumen de la actividad de la empresa
El sistema SHALL calcular en el servidor un resumen de la empresa de la sesión en su ambiente vigente, con la fecha de hoy en Ecuador: lo facturado y autorizado en el mes en curso y en el mes anterior; las facturas emitidas en el mes; lo facturado y autorizado en cada uno de los seis últimos meses; los comprobantes del mes por tipo, emitidos y autorizados, con su total autorizado salvo la guía de remisión, que no tiene total; los comprobantes que requieren atención, por un resultado incierto, una revisión manual o una transmisión detenida; los devueltos o no autorizados en los últimos 30 días; los borradores de factura pendientes; los productos con inventario inicializado y saldo agotado; los cinco clientes y los cinco productos con más facturado y autorizado en el mes; y los últimos comprobantes emitidos. Las ventas SHALL ser solo las facturas autorizadas. Los importes SHALL salir de lo que cada comprobante congeló al reservar su número, nunca del tercero, el producto ni el catálogo vigentes. Lo consulta quien puede consultar facturas.

#### Scenario: Una factura reservada no es una venta
- **WHEN** una empresa emite una factura que todavía no está autorizada
- **THEN** el resumen la cuenta entre las facturas emitidas del mes y entre los últimos comprobantes, pero no en las ventas autorizadas

#### Scenario: Ambiente vigente
- **WHEN** una empresa en Pruebas consulta el resumen
- **THEN** el resumen solo cuenta los comprobantes de Pruebas

#### Scenario: Aislamiento por empresa
- **WHEN** dos empresas consultan su resumen
- **THEN** ninguna ve comprobantes, clientes ni productos de la otra

### Requirement: Tablero de Inicio
Inicio SHALL mostrar el tablero a quien puede consultar facturas, y solo la preparación para emitir a cualquier otro rol. Mientras la empresa no pueda emitir, el tablero SHALL mostrar primero sus requisitos pendientes. Después SHALL mostrar cuatro indicadores (ventas autorizadas del mes con lo del mes anterior, facturas del mes, lo que requiere atención y borradores pendientes), las ventas autorizadas de los seis últimos meses en barras con una tabla equivalente para las tecnologías de asistencia, los comprobantes del mes por tipo, los mejores clientes y los productos más vendidos en barras horizontales con su importe y una tabla equivalente, el estado del sistema (firma electrónica, ambiente, productos agotados y comprobantes con atención) y los últimos comprobantes enlazados a su detalle. Sin comprobantes, SHALL invitar a emitir el primero. Un error al cargar SHALL poder reintentarse. El tablero no SHALL calcular importes en el navegador.

#### Scenario: Empresa con actividad
- **WHEN** un operador abre Inicio en una empresa que ya emite
- **THEN** ve las ventas autorizadas del mes, las facturas del mes, lo que requiere atención, los borradores, las ventas de los seis meses y los últimos comprobantes, cada uno enlazado a su detalle

#### Scenario: Empresa que no puede emitir
- **WHEN** un administrador abre Inicio en una empresa sin firma electrónica
- **THEN** ve primero que su empresa todavía no puede emitir, con el requisito pendiente y la forma de resolverlo

#### Scenario: Sin comprobantes
- **WHEN** un usuario abre Inicio en una empresa que todavía no emite
- **THEN** el tablero dice que aún no hay comprobantes en su ambiente y ofrece crear una factura

#### Scenario: Gráficos accesibles
- **WHEN** un usuario de lector de pantalla llega a las ventas de los seis meses o a los mejores clientes
- **THEN** encuentra una tabla con cada mes, sus facturas autorizadas y su total, o con cada cliente, su identificación, sus facturas y lo facturado
