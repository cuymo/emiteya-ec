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
`simpleType` de los seis XSD soportados.

| Especificación | Tipo del dominio | Dígitos totales | Decimales | Mínimo | Ejemplos válidos en el límite | Uso |
| --- | --- | --- | --- | --- | --- | --- |
| `tarifa` | `Percentage` | 4 | 2 | 0 | `9999`, `99.99`, `100`, `300` | Porcentaje de una tarifa |
| `importe` | `Money` | 14 | 2 | 0 | `99999999999999`, `999999999999.99` | Monto de la política de consumidor final; importes de la emisión |
| `precioUnitario` | `UnitPrice` | 18 | 6 | 0 | `999999999999999999`, `999999999999.999999` | Precio unitario de productos, sin impuestos |
| `cantidad` | `Quantity` | 18 | 6 | 0 | `999999999999999999`, `999999999999.999999` | Cantidades de la emisión |

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
  - Columnas: `product.unit_price` (`precioUnitario`), `fiscal_catalog_entry.percentage` (`tarifa`) y `consumer_final_policy.max_amount` (`importe`).
- **Conversión:** con el `Decimal` de Prisma siempre por texto.
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
