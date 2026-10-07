# Revisión del RIDE de la guía de remisión contra la ficha v2.34, anexo 2, página 64

Tarea 10.1 de `add-shipping-guides`. Fecha: 2026-10-06.

## Cómo se comparó

- **Referencia:** los rótulos de la página 64 transcritos de la página renderizada del PDF oficial
  (SHA-256 `7333aebf…13c9`) en `docs/product/sri-catalogs/fuentes/ficha-v2.34-guia-de-remision.txt`.
  La página es una imagen sin texto extraíble salvo el título. En esta sesión no se volvió a
  descargar el PDF; la comparación usa esa transcripción archivada.
- **Resultado comparado:** el PDF del renderer `guia-remision-1` para la guía de tres destinatarios
  de `test/sri-engine/ride/ride-shipping-guide.test.ts` (golden
  `backend/test/fixtures/shipping-guide-ride/tres-destinatarios.txt`) y la guía con los máximos
  absolutos (50 destinatarios, 300 detalles), rasterizados con `pdftoppm` y revisados a ojo.

## Rótulo por rótulo

| Página 64 | RIDE del sistema | Resultado |
| --- | --- | --- |
| Recuadro derecho: "R.U.C.:", "GUIA DE REMISIÓN", "No.", "NÚMERO DE AUTORIZACIÓN", "FECHA Y HORA DE AUTORIZACIÓN", "AMBIENTE:", "EMISIÓN:", "CLAVE DE ACCESO" y el código de barras | Los mismos rótulos, en el mismo orden, con el Code128 de la clave de la guía | Igual. El título lleva la tilde de "GUÍA", como en el título extraíble de la página |
| Recuadro izquierdo: razón social, nombre comercial, "Dirección Matriz:", "Dirección Sucursal:", "Contribuyente Especial Nro", "OBLIGADO A LLEVAR CONTABILIDAD" | El emisor compartido de los demás RIDE, con las leyendas de agente de retención y RIMPE solo cuando el XML las trae | Igual |
| Transporte: "Identificación (Transportista)", "Razón Social / Nombres y Apellidos:", "Placa:", "Punto de Partida:", "Fecha inicio Transporte", "Fecha fin Transporte" | Los mismos seis rótulos, en el mismo orden | Igual |
| Destinatario: "Comprobante de Venta:" (denominación y número), "Fecha de Emisión:", "Número de Autorización:", "Motivo Traslado:", "Destino(Punto de llegada)", "Identificación (Destinatario)", "Razón Social/Nombres Apellidos", "Documento Aduanero", "Código Establecimiento Destino", "Ruta:" | Los mismos diez rótulos en el mismo orden. "FACTURA" y el número del comprobante de venta; los rótulos sin dato quedan vacíos (una excepción declarada no tiene comprobante de venta; el documento aduanero no se emite) | Igual en contenido. Se normalizan los espacios de "Destino (Punto de llegada):" y la razón social se rotula "Razón Social / Nombres y Apellidos:", como en el bloque del transporte |
| Tabla: "Cantidad", "Descripcion", "Código Principal", "Código Auxiliar" | Las mismas cuatro columnas en el mismo orden, con la cantidad como el texto del XML | Igual; "Descripción" con tilde |
| Sin importes ni fila de fecha de emisión de la guía | Sin importes, subtotales, formas de pago ni fecha de emisión de la guía | Igual |

## Lo que el sistema agrega

- La paginación vigente de los RIDE: "Página N de M" y, desde la segunda página, la línea con el
  título, el número, el RUC y la clave.
- Cuando el detalle de un destinatario continúa en otra página, el bloque del destinatario y el
  encabezado de su tabla se repiten arriba. Ninguna fila se parte y un bloque que no cabe con su
  primera fila pasa entero a la página siguiente.

## Hallazgos abiertos

Ninguno.
