-- Retiro de la política oficial de tamaño del envío al SRI
-- (adopt-conservative-sri-transmission-size-policy-v1, design D6). Q-47 quedó resuelta por política
-- de producto: el límite de la transmisión es una constante conservadora del código, no un catálogo
-- oficial versionado. Solo se retira la infraestructura de `sri-transmission-policy`; los demás
-- catálogos fiscales no cambian.

-- La tabla con sus restricciones y triggers. Un DROP TABLE no dispara los triggers de DELETE ni de
-- TRUNCATE. Sus dos funciones propias sobreviven a la tabla y se borran aparte; la función compartida
-- fiscal_catalog_reject_change() se conserva.
DROP TABLE "sri_transmission_policy";
DROP FUNCTION "sri_transmission_policy_guard"();
DROP FUNCTION "sri_transmission_policy_no_overlap"();

-- El registro de datasets aplicados es inmutable. Ningún dataset de este tipo se distribuyó nunca, así
-- que una fila solo pudo existir en un esquema de pruebas o en el sandbox manual. Se borra con el
-- trigger desactivado solo para esta sentencia, para que no siga apareciendo en los snapshots de
-- emisión. Ninguna entrada de catálogo la referencia: las entradas solo existen en los catálogos de
-- entradas.
ALTER TABLE "fiscal_catalog_dataset" DISABLE TRIGGER "fiscal_catalog_dataset_immutable";
DELETE FROM "fiscal_catalog_dataset" WHERE "catalog_type" = 'sri-transmission-policy';
ALTER TABLE "fiscal_catalog_dataset" ENABLE TRIGGER "fiscal_catalog_dataset_immutable";

-- Los catorce tipos de dataset restantes.
ALTER TABLE "fiscal_catalog_dataset" DROP CONSTRAINT "fiscal_catalog_dataset_catalog_type_check";
ALTER TABLE "fiscal_catalog_dataset" ADD CONSTRAINT "fiscal_catalog_dataset_catalog_type_check" CHECK ("catalog_type" IN (
  'identification-type', 'tax', 'iva-rate', 'ice-rate', 'irbpnr-rate', 'payment-method',
  'withholding-tax', 'withholding-iva-code', 'withholding-income-concept', 'support-document-type',
  'support-code',
  'consumer-final-policy', 'schema-registry', 'special-case-matrix'));
