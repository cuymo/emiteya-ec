-- Dominios decimales según el XSD (Q-43, docs/architecture/decimal-policy.md). Como el precio
-- unitario, el porcentaje (`tarifa`, 4 dígitos y 2 decimales) y el importe (`importe`, 14 y 2)
-- siguen la regla del XSD, no la de `NUMERIC(p, s)`: `NUMERIC(4,2)` no admitía 100 y
-- `NUMERIC(14,2)` limitaba la parte entera a 12 dígitos. Las columnas pasan a `NUMERIC` sin escala
-- fija, que guarda el valor exacto sin redondear, y un `CHECK` de dominio fija la regla.
--
-- `trim_scale` lleva los valores guardados a su forma canónica (`15.00` pasa a `15`) al reescribir
-- la columna, sin `UPDATE` y sin disparar los triggers de inmutabilidad de las tablas.
--
-- El porcentaje de una tarifa de IVA deja de tener un máximo de 100: no lo fija ninguna fuente, y
-- la ficha v2.34 publica tarifas de ICE superiores. Los límites normativos de un impuesto
-- pertenecen a su catálogo, no al tipo decimal compartido.

ALTER TABLE "fiscal_catalog_entry"
  DROP CONSTRAINT "fiscal_catalog_entry_attributes_check",
  ALTER COLUMN "percentage" TYPE DECIMAL USING trim_scale("percentage"),
  ADD CONSTRAINT "fiscal_catalog_entry_percentage_check" CHECK (
    "percentage" >= 0
    AND scale("percentage") <= 2
    AND "percentage" < power(10::numeric, 4 - scale("percentage"))
  ),
  -- Columnas tipadas por catálogo (design D8 de add-fiscal-catalogs), sin el máximo de 100.
  ADD CONSTRAINT "fiscal_catalog_entry_attributes_check" CHECK (
  CASE "catalog_type"
    WHEN 'iva-rate' THEN "tax_kind" = 'IVA' AND "sri_tax_code" = '2'
      AND "rate_kind" IN ('PERCENTAGE', 'NOT_SUBJECT', 'EXEMPT', 'DIFFERENTIATED')
      AND ("percentage" IS NOT NULL) = ("rate_kind" = 'PERCENTAGE')
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'ice-rate' THEN "tax_kind" = 'ICE' AND "sri_tax_code" = '3' AND "rate_kind" = 'PER_NORMATIVE'
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'irbpnr-rate' THEN "tax_kind" = 'IRBPNR' AND "sri_tax_code" = '5' AND "rate_kind" = 'PER_UNIT'
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'tax' THEN "tax_kind" IN ('IVA', 'ICE', 'IRBPNR') AND "sri_tax_code" IS NULL
      AND "rate_kind" IS NULL AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'identification-type' THEN "identification_rule" IS NOT NULL
      AND ("reserved_for" IS NULL OR "reserved_for" = 'CONSUMER_FINAL')
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL AND "percentage" IS NULL
    WHEN 'payment-method' THEN "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    ELSE FALSE
  END);

ALTER TABLE "consumer_final_policy"
  ALTER COLUMN "max_amount" TYPE DECIMAL USING trim_scale("max_amount"),
  ADD CONSTRAINT "consumer_final_policy_max_amount_check" CHECK (
    scale("max_amount") <= 2
    AND "max_amount" < power(10::numeric, 14 - scale("max_amount"))
  );
