-- add-email-delivery (design D8; spec parties, «Catálogo único de terceros»): un tercero pasa de un
-- correo opcional a hasta tres, en su propia tabla. El correo existente queda como el primero.
-- CreateTable
CREATE TABLE "party_email" (
    "party_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,
    "address" VARCHAR(300) NOT NULL,

    CONSTRAINT "party_email_pkey" PRIMARY KEY ("party_id","position")
);

-- AddForeignKey
ALTER TABLE "party_email" ADD CONSTRAINT "party_email_company_id_party_id_fkey" FOREIGN KEY ("company_id", "party_id") REFERENCES "party"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hasta tres por tercero, con forma de correo, sin espacios ni saltos de línea, y sin repetirse sin
-- distinguir mayúsculas. La validación completa es la del contrato; esto es la última defensa.
ALTER TABLE "party_email" ADD CONSTRAINT "party_email_values_check" CHECK (
  "position" BETWEEN 1 AND 3
  AND "address" ~ '^[^\s@]+@[^\s@]+$'
);
CREATE UNIQUE INDEX "party_email_party_id_address_key" ON "party_email"("party_id", lower("address"));

-- El correo de cada tercero existente pasa a ser el primero de su lista.
INSERT INTO "party_email" ("party_id", "company_id", "position", "address")
  SELECT "id", "company_id", 1, "email" FROM "party" WHERE "email" IS NOT NULL;

ALTER TABLE "party" DROP CONSTRAINT "party_text_check";
ALTER TABLE "party" ADD CONSTRAINT "party_text_check" CHECK (
  "legal_name" <> '' AND "legal_name" !~ '[\r\n]'
  AND ("address" IS NULL OR ("address" <> '' AND "address" !~ '[\r\n]'))
  AND ("phone" IS NULL OR ("phone" <> '' AND "phone" !~ '[\r\n]'))
);
ALTER TABLE "party" DROP COLUMN "email";
