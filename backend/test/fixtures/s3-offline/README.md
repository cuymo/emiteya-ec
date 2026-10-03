# XML de referencia de S-3 offline

XML sin firmar de la factura 1.1.0, revisados a mano en el spike S-3 (Q-44) y usados por
`backend/test/integration/s3-offline.test.ts`, que reproduce S-3 con la implementación real de
`add-invoice-emission` (tarea 9.4). Datos comunes: RUC `1790012345001`, ambiente de Pruebas,
establecimiento y punto `001`, secuencial `000000001`, fecha 3 de octubre de 2026 en Ecuador y
código numérico `12345678`.

| Archivo | Caso |
| --- | --- |
| `consumidor-final-49.99.xml`, `consumidor-final-50.00.xml` | Consumidor final por debajo del monto y exactamente en él |
| `varias-lineas.xml` | Seis líneas con descuento, IVA 15 %, 5 % y 0 %, y fronteras de cantidad por precio |
| `valores-grandes.xml` | 999999.999999 × 1.000001 |
| `regresion-precioUnitario.xml`, `regresion-cantidad.xml` | `123456789012.123456` y `99999999999.999999` como precio y como cantidad |
| `emisor-agente-rimpe.xml` | Emisor con resolución de agente de retención y categoría RIMPE |

Único cambio respecto del spike: en `varias-lineas.xml`, el precio unitario de la línea `CLAVO` se
escribe `0.1`. El spike escribía el texto de entrada `0.10`; la implementación real escribe el
precio del producto en la forma canónica con que se guarda. Ambos son el mismo valor
`xsd:decimal` del tipo `precioUnitario` (18 dígitos, 6 decimales) y validan contra el XSD.
