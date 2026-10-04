# Política decimal

Regla vigente para importes, precios, cantidades y tarifas en contratos, backend, base de datos y
frontend. Origen: design D10 de `add-fiscal-catalogs` y D9 de `add-parties-and-products`. Ningún
importe ni tarifa pasa por un `number` de JavaScript.

## Representación universal

`DecimalString` es el texto decimal del producto: `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`.

- **No admite:** exponente, coma decimal, separadores de miles, ceros a la izquierda, espacios, signo `+` ni `-0`.
- **Signo:** admite negativos, porque algunos campos del XSD no tienen mínimo. "Sin signo" es una propiedad de cada tipo, no del texto universal.
- **JSON:** un número JSON se rechaza siempre, porque ya pasó por coma flotante.

## Especificaciones

Viven en `packages/contracts/src/decimal.ts` (`DECIMAL_SPECS`), las comparten backend y frontend,
y cada una nombra el tipo XSD de origen. Una prueba compara cada especificación con los
`simpleType` de los seis XSD soportados. La excepción es `existencia`, un dominio interno del
inventario que no sale de ningún XSD.

| Especificación | Tipo del dominio | Dígitos totales | Decimales | Mínimo | Ejemplos válidos en el límite | Uso |
| --- | --- | --- | --- | --- | --- | --- |
| `tarifa` | `Percentage` | 4 | 2 | 0 | `9999`, `99.99`, `100`, `300` | Porcentaje de una tarifa |
| `importe` | `Money` | 14 | 2 | 0 | `99999999999999`, `999999999999.99` | Monto de la política de consumidor final; importes de la emisión |
| `precioUnitario` | `UnitPrice` | 18 | 6 | 0 | `999999999999999999`, `999999999999.999999` | Precio unitario de productos, sin impuestos |
| `cantidad` | `Quantity` | 18 | 6 | 0 | `999999999999999999`, `999999999999.999999` | Cantidades de la emisión |
| `existencia` | `StockQuantity` | 30 | 6 | Sin mínimo (con signo) | `999999999999999999999999.999999`, `-999999999999999999999999.999999` | Variaciones y saldos del inventario (design D3 de `add-minimal-inventory`): los decimales de `cantidad` y una parte entera que admite la salida de una factura de 1 000 líneas de cantidad máxima. Un saldo puede ser negativo (Q-19). |

- **Regla del XSD (Q-43):** la parte entera usa los dígitos que no ocupan los decimales; nunca `totalDigits` enteros más `fractionDigits` decimales. La semántica de `NUMERIC(p, s)`, que limitaría la parte entera a `p - s`, no es la regla.
- **Primitivos compartidos:** una especificación no lleva límites normativos de un impuesto o de un código.
  - `tarifa` no tiene un máximo de 100: la ficha v2.34 publica tarifas de ICE superiores.
  - Un límite así pertenece al catálogo del impuesto, con su fuente.
- **Excepción conocida:** la retención 2.0.0 define `tarifa` y `porcentajeRetener` con 3 dígitos y 2 decimales. Esa escala llegará con su cambio.

## Validación al recibir

1. Se valida primero el `DecimalString` universal.
2. Después, la especificación (`decimalSpecViolation`):
   - **Decimales:** como máximo `fractionDigits`, contados como se escriben. `1.1234560` tiene 7 decimales y se rechaza.
   - **Total:** como máximo `totalDigits`, contados como se escriben y sin el cero entero de `0.5`.
     - `1234567890123.123456` (19 dígitos) se rechaza como precio unitario.
     - `1234567890123.123450` también se rechaza, porque su cero final cuenta.
   - **Mínimo:** el de la especificación.
3. Nunca se redondea al recibir: un valor fuera de la especificación es un error de validación con el mensaje de su límite.

## Dominio y base de datos

- **Dominio:** `decimal.js` 10.6.0, envuelto en `platform/decimal` con una instancia propia (precisión 40), detrás de `FiscalDecimal(spec)` y sus tipos.
- **Base de datos:**
  - Cada campo es `NUMERIC` sin precisión ni escala fijas, que guarda el valor exacto sin redondear. `NUMERIC(p, s)` no se usa: limitaría la parte entera a `p - s` dígitos y redondearía en silencio los decimales de más.
  - Un `CHECK` de dominio fija la especificación: mínimo, `scale(valor) <= fractionDigits` y `valor < 10^(totalDigits - scale(valor))`.
  - Se guarda la forma canónica (`toDatabase`), así que la escala guardada es la del valor.
  - Columnas: `product.unit_price` (`precioUnitario`), `fiscal_catalog_entry.percentage` (`tarifa`), `consumer_final_policy.max_amount` (`importe`) y, desde `add-invoice-emission`, `invoice_draft_line.quantity` (`cantidad`), `invoice_draft_line.discount`, `invoice_draft_payment.amount` y `electronic_document.total` (`importe`); desde `add-minimal-inventory`, `stock_balance.balance`, `stock_movement.delta` y `stock_movement.balance_after` (`existencia`), sin mínimo.
- **Conversión:** con el `Decimal` de Prisma siempre por texto.
- **Aritmética fiscal** (design D5 de `add-invoice-emission`):
  - **Primitivas exactas** de `platform/decimal`: `sumExact`, `subtractExact`, `multiplyExact` y `percentageOfExact`, sobre `DecimalString` y sin redondeo. La precisión de 40 dígitos cubre el producto de dos valores de 18 dígitos. Una operación que necesitara más dígitos lanza `InexactOperationError` en vez de redondear en silencio.
  - **`roundHalfUp(valor, escala)`** es el único redondeo.
  - **Funciones de dominio** en `invoices/domain/amounts.ts`, una por concepto: `lineSubtotal`, `lineDiscount`, `taxableBase`, `taxAmount`, `materializeMoney` e `invoiceTotals`. Validan cada entrada con su especificación y nunca usan `number` ni `decimal.js` directamente.
  - **Puntos de materialización HALF_UP**, a la escala de `importe`: la base de la línea (subtotal exacto menos descuento), el impuesto de la línea (porcentaje de la base ya materializada) y los totales, que solo fijan la escala de sumas ya exactas.
  - **Límite del esquema:** cada importe materializado se comprueba con `importe` (14/2). Un valor que no cabe es `AMOUNT_OUT_OF_RANGE`, antes de reservar.
  - **Descuento:** importe de 2 decimales entre 0 y el subtotal exacto de la línea (`DISCOUNT_EXCEEDS_SUBTOTAL`), sin redondear.
  - Ningún handler ni builder opera con `decimal.js`; el builder XML no calcula.
  - Una tabla dorada (`backend/test/invoices/amounts.test.ts`) fija los casos de la spec y de S-3: empates, totales desde valores materializados, varias líneas con descuento, consumidor final y regresiones de 17 y 18 dígitos. Una prueba de fuente impide `number` y `decimal.js` en el dominio.
- **Redondeo (Q-14):** política del producto, no regla textual del SRI.
  - Los cálculos internos son exactos, sin redondeos intermedios.
  - Un campo fiscal se redondea HALF_UP solo al materializarlo a la escala de su XSD.
  - Los totales se construyen con los valores ya materializados.
  - La validó la parte offline de S-3. La autorización en Pruebas del SRI (parte online) es la compuerta de go-live, y una contradicción abre `/opsx:update`.

## Salida y frontend

- **Salida:** la API devuelve la forma exacta más corta, sin exponente ni ceros finales (`15`, `12.5`).
- **Frontend:**
  - formatea las cadenas con la convención es-EC (`formatDecimal`, `formatPercentage`, `formatUsd`), sin convertir a `number`;
  - las entradas usan `inputMode="decimal"` y envían texto.
