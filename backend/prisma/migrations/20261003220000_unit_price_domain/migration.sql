-- Dominio del precio unitario (add-parties-and-products, design D9 y D15). El precio sigue la regla
-- del XSD (`precioUnitario`: 18 dígitos en total, de los cuales 6 decimales como máximo), no la de
-- `NUMERIC(18,6)`, que limita la parte entera a 12 dígitos. La columna pasa a `NUMERIC` sin escala
-- fija, que guarda el valor exacto sin redondear, y un `CHECK` de dominio fija la regla.

-- La aplicación guarda la forma canónica, así que la escala guardada es la del valor. `trim_scale`
-- lleva a esa forma los precios guardados con la escala fija anterior (`8.750000` pasa a `8.75`)
-- al reescribir la columna, sin `UPDATE` y sin disparar los triggers de la tabla.
ALTER TABLE "product"
  DROP CONSTRAINT "product_unit_price_check",
  ALTER COLUMN "unit_price" TYPE DECIMAL USING trim_scale("unit_price"),
  ADD CONSTRAINT "product_unit_price_check" CHECK (
    "unit_price" >= 0
    AND scale("unit_price") <= 6
    AND "unit_price" < power(10::numeric, 18 - scale("unit_price"))
  );
