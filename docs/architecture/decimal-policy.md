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

| Especificación | Tipo del dominio | Dígitos totales | Decimales | Enteros como máximo | Mínimo | Uso |
| --- | --- | --- | --- | --- | --- | --- |
| `tarifa` | `Percentage` | 4 | 2 | 2 | 0 | Porcentaje de IVA |
| `importe` | `Money` | 14 | 2 | 12 | 0 | Monto de la política de consumidor final; importes de la emisión |
| `precioUnitario` | `UnitPrice` | 18 | 6 | 18, sin decimales | 0 | Precio unitario de productos, sin impuestos |
| `cantidad` | `Quantity` | 18 | 6 | 12 | 0 | Cantidades de la emisión |

- **Excepción conocida:** la retención 2.0.0 define `tarifa` y `porcentajeRetener` con 3 dígitos y 2 decimales. Esa escala llegará con su cambio.

## Validación al recibir

1. Se valida primero el `DecimalString` universal.
2. Después, la especificación (`decimalSpecViolation`):
   - **Decimales:** como máximo `fractionDigits`, contados como se escriben. `1.1234560` tiene 7 decimales y se rechaza.
   - **Enteros:** por defecto, como máximo `totalDigits - fractionDigits`, la semántica de `NUMERIC(p, s)` de PostgreSQL. Así funcionan `tarifa`, `importe` y `cantidad`.
   - **Regla del XSD:** una especificación puede declarar `maxIntegerDigits`.
     - `precioUnitario` declara 18: la parte entera usa los dígitos que no ocupan los decimales.
     - `999999999999999999` y `999999999999.999999` son válidos; nunca 18 enteros más 6 decimales.
   - **Total:** como máximo `totalDigits`, contados como se escriben y sin el cero entero de `0.5`.
     - `1234567890123.123456` (19 dígitos) se rechaza.
     - `1234567890123.123450` también se rechaza, porque su cero final cuenta.
   - **Rango:** el mínimo, y el máximo de dominio si lo hay.
3. Nunca se redondea al recibir: un valor fuera de la especificación es un error de validación con el mensaje de su límite.

## Dominio y base de datos

- **Dominio:** `decimal.js` 10.6.0, envuelto en `platform/decimal` con una instancia propia (precisión 40), detrás de `FiscalDecimal(spec)` y sus tipos.
- **Base de datos:**
  - Por defecto, cada campo es `NUMERIC(totalDigits, fractionDigits)` de su especificación, con un `CHECK` de su mínimo.
  - **Regla del XSD:** un campo con `maxIntegerDigits` usa `NUMERIC` sin escala fija, porque `NUMERIC(p, s)` limitaría su parte entera a `p - s` dígitos.
    - Un `CHECK` de dominio fija el mínimo, la escala y el total.
    - El repositorio guarda la forma canónica, así que la escala guardada es la del valor.
    - Es el caso de `product.unit_price`: `unit_price >= 0`, `scale(unit_price) <= 6` y `unit_price < 10^(18 - scale(unit_price))`.
- **Conversión:** con el `Decimal` de Prisma siempre por texto.
- **Redondeo:** solo el de la emisión (Q-14), con `roundHalfUp` y la escala del campo.

## Salida y frontend

- **Salida:** la API devuelve la forma exacta más corta, sin exponente ni ceros finales (`15`, `12.5`).
- **Frontend:**
  - formatea las cadenas con la convención es-EC (`formatDecimal`, `formatPercentage`, `formatUsd`), sin convertir a `number`;
  - las entradas usan `inputMode="decimal"` y envían texto.
