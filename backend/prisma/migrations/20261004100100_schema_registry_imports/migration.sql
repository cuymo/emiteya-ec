-- Registro de esquemas completo (add-invoice-emission, design D11): incluye cada archivo necesario
-- para resolver una validación, también los esquemas importados como `xmldsig-core-schema.xsd`, con
-- su ruta lógica dentro del paquete empaquetado, su fuente, su revisión y su hash.
--
-- Las filas de la versión 1 se rellenan con la ruta lógica `sri-xsd/<archivo>`. El registro es
-- inmutable: el trigger se desactiva solo durante el relleno, dentro de esta migración.

ALTER TABLE "schema_registry_entry"
  ADD COLUMN "path" TEXT,
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
  ADD COLUMN "revision" TEXT,
  ADD COLUMN "imports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "schema_registry_entry" DISABLE TRIGGER "schema_registry_entry_immutable";
UPDATE "schema_registry_entry" SET "path" = 'sri-xsd/' || "file";
ALTER TABLE "schema_registry_entry" ENABLE TRIGGER "schema_registry_entry_immutable";

ALTER TABLE "schema_registry_entry"
  DROP CONSTRAINT "schema_registry_entry_pkey",
  ALTER COLUMN "path" SET NOT NULL,
  ADD CONSTRAINT "schema_registry_entry_pkey" PRIMARY KEY ("path", "dataset_version");

ALTER TABLE "schema_registry_entry"
  ALTER COLUMN "document_type" DROP NOT NULL,
  ALTER COLUMN "version" DROP NOT NULL,
  ALTER COLUMN "root" DROP NOT NULL,
  DROP CONSTRAINT "schema_registry_entry_values_check",
  -- Un documento tiene tipo, versión y raíz, y declara sus imports; un import tiene revisión y no
  -- importa otros. La ruta termina en el nombre del archivo.
  ADD CONSTRAINT "schema_registry_entry_values_check" CHECK (
    "sha256" ~ '^[0-9a-f]{64}$'
    AND "path" ~ '^[a-z0-9-]+/[A-Za-z0-9_.-]+\.xsd$'
    AND right("path", length("file") + 1) = '/' || "file"
    AND CASE "kind"
      WHEN 'DOCUMENT' THEN "document_type" IN ('01', '03', '04', '05', '06', '07')
        AND "version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$' AND "root" IS NOT NULL AND "revision" IS NULL
      WHEN 'IMPORT' THEN "document_type" IS NULL AND "version" IS NULL AND "root" IS NULL
        AND "revision" IS NOT NULL AND cardinality("imports") = 0
      ELSE FALSE
    END);
