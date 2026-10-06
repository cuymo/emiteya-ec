-- add-withholding-receipts (design D11 y D28): catálogos de retención y de sustento en las tablas de
-- catálogos fiscales. Impuestos a retener y retención del IVA (tablas 19 y 20 de la ficha v2.34),
-- conceptos de la renta, tipos de documento sustento y códigos de sustento (Catálogo ATS).
-- Aditiva: los catálogos existentes y sus filas no cambian.

-- AlterTable
ALTER TABLE "fiscal_catalog_entry" ADD COLUMN     "allowed_support_codes" TEXT[],
ADD COLUMN     "rate_text" TEXT,
ADD COLUMN     "scope_classification" TEXT;

-- Restricciones propias que Prisma no expresa.

-- Tipos admitidos en el registro de datasets, en las claves y en la habilitación por empresa.
ALTER TABLE "fiscal_catalog_dataset" DROP CONSTRAINT "fiscal_catalog_dataset_catalog_type_check";
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_catalog_type_check" CHECK ("catalog_type" IN (
  'identification-type', 'tax', 'iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method',
  'withholding-tax', 'withholding-iva-code', 'withholding-income-concept', 'support-document-type',
  'support-code',
  'consumer-final-policy', 'schema-registry', 'special-case-matrix', 'sri-transmission-policy'));
-- Los códigos de retención del IVA y los conceptos de la renta se habilitan por empresa (design D11).
ALTER TABLE "fiscal_catalog_dataset" DROP CONSTRAINT "fiscal_catalog_dataset_enablement_policy_check";
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_enablement_policy_check" CHECK (
  ("catalog_type" IN ('iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method', 'withholding-iva-code',
    'withholding-income-concept')
   AND "enablement_policy" IN ('DEFAULT_ENABLED', 'DEFAULT_DISABLED'))
  OR ("catalog_type" NOT IN ('iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method',
    'withholding-iva-code', 'withholding-income-concept')
   AND "enablement_policy" = 'NOT_ENABLEABLE'));

ALTER TABLE "fiscal_catalog_key" DROP CONSTRAINT "fiscal_catalog_key_catalog_type_check";
ALTER TABLE "fiscal_catalog_key" ADD CONSTRAINT "fiscal_catalog_key_catalog_type_check" CHECK ("catalog_type" IN (
  'identification-type', 'tax', 'iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method',
  'withholding-tax', 'withholding-iva-code', 'withholding-income-concept', 'support-document-type',
  'support-code'));

-- El código fiscal depende del catálogo. La renta conserva el código literal del Catálogo ATS: 3 o 4
-- dígitos con un sufijo opcional (303A, 323B1) o con un espacio y una letra (323 M), de 3 a 5
-- caracteres como codigoRetencion. Los tipos de documento sustento tienen 2 o 3 dígitos y los
-- sustentos 2. Los demás siguen con 1 a 4 dígitos.
ALTER TABLE "fiscal_catalog_key" DROP CONSTRAINT "fiscal_catalog_key_code_check";
ALTER TABLE "fiscal_catalog_key" ADD CONSTRAINT "fiscal_catalog_key_code_check" CHECK (
  CASE "catalog_type"
    WHEN 'withholding-income-concept' THEN char_length("code") BETWEEN 3 AND 5
      AND "code" ~ '^([0-9]{3,4}([A-Z][0-9]?)?|[0-9]{3} [A-Z])$'
    WHEN 'support-document-type' THEN "code" ~ '^[0-9]{2,3}$'
    WHEN 'support-code' THEN "code" ~ '^[0-9]{2}$'
    ELSE "code" ~ '^[0-9]{1,4}$'
  END);

ALTER TABLE "company_fiscal_catalog_setting" DROP CONSTRAINT "company_fiscal_catalog_setting_catalog_type_check";
ALTER TABLE "company_fiscal_catalog_setting" ADD CONSTRAINT "company_fiscal_catalog_setting_catalog_type_check" CHECK (
  "catalog_type" IN ('iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method', 'withholding-iva-code',
    'withholding-income-concept'));

-- Columnas tipadas por catálogo (design D8 de add-fiscal-catalogs y D11 de add-withholding-receipts).
-- La clasificación de alcance, el texto del porcentaje y los sustentos admitidos existen solo en sus
-- catálogos. El porcentaje de una retención tiene 3 dígitos totales (porcentajeRetener del XSD).
-- La clasificación se exige explícitamente: un CHECK con NULL no la rechazaría.
ALTER TABLE "fiscal_catalog_entry" DROP CONSTRAINT "fiscal_catalog_entry_attributes_check";
ALTER TABLE "fiscal_catalog_entry" ADD CONSTRAINT "fiscal_catalog_entry_attributes_check" CHECK (
  CASE "catalog_type"
    WHEN 'iva-rate' THEN "tax_kind" = 'IVA' AND "sri_tax_code" = '2'
      AND "rate_kind" IN ('PERCENTAGE', 'NOT_SUBJECT', 'EXEMPT', 'DIFFERENTIATED')
      AND ("percentage" IS NOT NULL) = ("rate_kind" = 'PERCENTAGE')
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
      AND "scope_classification" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
    WHEN 'ice-rate' THEN "tax_kind" = 'ICE' AND "sri_tax_code" = '3' AND "rate_kind" = 'PER_NORMATIVE'
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
      AND "scope_classification" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
    WHEN 'irbpnr-rate' THEN "tax_kind" = 'IRBPNR' AND "sri_tax_code" = '5' AND "rate_kind" = 'PER_UNIT'
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
      AND "scope_classification" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
    WHEN 'tax' THEN "tax_kind" IN ('IVA', 'ICE', 'IRBPNR') AND "sri_tax_code" IS NULL
      AND "rate_kind" IS NULL AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
      AND "scope_classification" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
    WHEN 'identification-type' THEN "identification_rule" IS NOT NULL
      AND ("reserved_for" IS NULL OR "reserved_for" = 'CONSUMER_FINAL')
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL AND "percentage" IS NULL
      AND "scope_classification" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
    WHEN 'payment-method' THEN "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "percentage" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
      AND "scope_classification" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
    WHEN 'withholding-tax' THEN "scope_classification" IS NOT NULL AND "scope_classification" IN ('SUPPORTED', 'OUT_OF_SCOPE_PENDING_EVIDENCE')
      AND "percentage" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'withholding-iva-code' THEN "scope_classification" IS NOT NULL AND "scope_classification" IN ('SUPPORTED_FIXED',
        'OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION')
      AND "percentage" IS NOT NULL AND "percentage" < power(10::numeric, 3 - scale("percentage"))
      AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'withholding-income-concept' THEN "scope_classification" IS NOT NULL AND "scope_classification" IN ('SUPPORTED_FIXED_RESIDENT',
        'OUT_OF_SCOPE_NON_RESIDENT', 'OUT_OF_SCOPE_VARIABLE', 'OUT_OF_SCOPE_SPECIAL_STRUCTURE',
        'OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION')
      AND ("percentage" IS NULL) <> ("rate_text" IS NULL)
      AND ("percentage" IS NULL OR "percentage" < power(10::numeric, 3 - scale("percentage")))
      AND ("rate_text" IS NULL OR btrim("rate_text") <> '')
      AND ("scope_classification" <> 'SUPPORTED_FIXED_RESIDENT' OR "percentage" IS NOT NULL)
      AND ("scope_classification" <> 'OUT_OF_SCOPE_VARIABLE' OR "rate_text" IS NOT NULL)
      AND "allowed_support_codes" IS NULL
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'support-document-type' THEN "scope_classification" IS NOT NULL AND "scope_classification" IN ('SUPPORTED', 'OUT_OF_SCOPE_MVP')
      AND "allowed_support_codes" IS NOT NULL
      AND array_to_string("allowed_support_codes", ',') ~ '^([0-9]{2}(,[0-9]{2})*)?$'
      AND "percentage" IS NULL AND "rate_text" IS NULL
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    WHEN 'support-code' THEN "scope_classification" IS NOT NULL AND "scope_classification" IN ('SUPPORTED', 'OUT_OF_SCOPE_SPECIAL_STRUCTURE',
        'OUT_OF_SCOPE_MVP', 'OUT_OF_SCOPE_EXPIRED')
      AND "percentage" IS NULL AND "rate_text" IS NULL AND "allowed_support_codes" IS NULL
      AND "tax_kind" IS NULL AND "sri_tax_code" IS NULL AND "rate_kind" IS NULL
      AND "identification_pattern" IS NULL AND "identification_rule" IS NULL AND "reserved_for" IS NULL
    ELSE FALSE
  END);
