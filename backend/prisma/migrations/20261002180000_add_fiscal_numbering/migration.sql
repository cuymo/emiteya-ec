-- add-fiscal-numbering: contadores de secuenciales por empresa, ambiente, establecimiento, punto y
-- tipo, y registro de los números reservados (design D2 y D13).

-- CreateTable
CREATE TABLE "fiscal_sequence" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "emission_point_id" TEXT NOT NULL,
    "document_type" CHAR(2) NOT NULL,
    "next_number" INTEGER NOT NULL,
    "last_reserved" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_sequence_reservation" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "emission_point_id" TEXT NOT NULL,
    "document_type" CHAR(2) NOT NULL,
    "sequential" INTEGER NOT NULL,
    "reserved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reserved_by" TEXT,
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "fiscal_sequence_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_sequence_company_id_environment_establishment_id_emi_key" ON "fiscal_sequence"("company_id", "environment", "establishment_id", "emission_point_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_sequence_reservation_company_id_environment_establis_key" ON "fiscal_sequence_reservation"("company_id", "environment", "establishment_id", "emission_point_id", "document_type", "sequential");

-- CreateIndex
CREATE UNIQUE INDEX "emission_point_company_id_establishment_id_id_key" ON "emission_point"("company_id", "establishment_id", "id");

-- AddForeignKey
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_company_id_establishment_id_emission_point_fkey" FOREIGN KEY ("company_id", "establishment_id", "emission_point_id") REFERENCES "emission_point"("company_id", "establishment_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_sequence_reservation" ADD CONSTRAINT "fiscal_sequence_reservation_company_id_environment_establi_fkey" FOREIGN KEY ("company_id", "environment", "establishment_id", "emission_point_id", "document_type") REFERENCES "fiscal_sequence"("company_id", "environment", "establishment_id", "emission_point_id", "document_type") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_sequence_reservation" ADD CONSTRAINT "fiscal_sequence_reservation_reserved_by_fkey" FOREIGN KEY ("reserved_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Restricciones propias que Prisma no expresa (design D2 y D6; docs/architecture/database.md).

-- Contador: rango con el valor interno de agotado (1000000000) y el siguiente siempre por encima
-- del último reservado, de modo que ningún ajuste ni reserva vuelve a un número reservado.
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_environment_check" CHECK ("environment" IN ('TEST', 'PRODUCTION'));
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_document_type_check" CHECK ("document_type" IN ('01', '03', '04', '05', '06', '07'));
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_next_number_check" CHECK ("next_number" BETWEEN 1 AND 1000000000);
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_last_reserved_check" CHECK ("last_reserved" IS NULL OR "last_reserved" BETWEEN 1 AND 999999999);
ALTER TABLE "fiscal_sequence" ADD CONSTRAINT "fiscal_sequence_next_above_reserved_check" CHECK ("next_number" > COALESCE("last_reserved", 0));

-- Reserva: secuencial de nueve dígitos.
ALTER TABLE "fiscal_sequence_reservation" ADD CONSTRAINT "fiscal_sequence_reservation_sequential_check" CHECK ("sequential" BETWEEN 1 AND 999999999);

-- Operaciones no permitidas sobre contadores y reservas.
CREATE FUNCTION "fiscal_reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Los contadores no se borran.
CREATE TRIGGER "fiscal_sequence_no_delete"
  BEFORE DELETE ON "fiscal_sequence"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_reject_change"();
CREATE TRIGGER "fiscal_sequence_no_truncate"
  BEFORE TRUNCATE ON "fiscal_sequence"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_reject_change"();

-- Las reservas son de solo agregado.
CREATE TRIGGER "fiscal_sequence_reservation_append_only"
  BEFORE UPDATE OR DELETE ON "fiscal_sequence_reservation"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_reject_change"();
CREATE TRIGGER "fiscal_sequence_reservation_no_truncate"
  BEFORE TRUNCATE ON "fiscal_sequence_reservation"
  FOR EACH STATEMENT EXECUTE FUNCTION "fiscal_reject_change"();

-- La clave del contador no cambia y el último reservado solo crece.
CREATE FUNCTION "fiscal_sequence_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."company_id" <> OLD."company_id" OR NEW."environment" <> OLD."environment"
     OR NEW."establishment_id" <> OLD."establishment_id"
     OR NEW."emission_point_id" <> OLD."emission_point_id"
     OR NEW."document_type" <> OLD."document_type" THEN
    RAISE EXCEPTION 'fiscal_sequence: la clave del contador no cambia' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."last_reserved" IS NOT NULL
     AND (NEW."last_reserved" IS NULL OR NEW."last_reserved" < OLD."last_reserved") THEN
    RAISE EXCEPTION 'fiscal_sequence: el último secuencial reservado no disminuye' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "fiscal_sequence_guard"
  BEFORE UPDATE ON "fiscal_sequence"
  FOR EACH ROW EXECUTE FUNCTION "fiscal_sequence_guard"();
