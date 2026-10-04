-- add-minimal-inventory (design D2, D3 y Migration Plan): el saldo materializado de cada producto
-- con inventario, cuya existencia es la inicialización, y los movimientos de solo agregado. Aditiva:
-- los productos ya marcados quedan sin inicializar y ningún dato existente cambia.

-- CreateTable
CREATE TABLE "stock_balance" (
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "balance" DECIMAL NOT NULL,
    "last_position" INTEGER NOT NULL,
    "initialized_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initialized_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balance_pkey" PRIMARY KEY ("company_id","product_id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "movement_type" TEXT NOT NULL,
    "delta" DECIMAL NOT NULL,
    "balance_after" DECIMAL NOT NULL,
    "document_id" TEXT,
    "document_number" CHAR(17),
    "origin" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "reason" TEXT,
    "idempotency_operation" TEXT,
    "idempotency_key" VARCHAR(100),
    "request_hash" CHAR(64),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_balance_company_id_balance_idx" ON "stock_balance"("company_id", "balance");

-- CreateIndex
CREATE INDEX "stock_movement_company_id_product_id_occurred_at_idx" ON "stock_movement"("company_id", "product_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_company_id_product_id_position_key" ON "stock_movement"("company_id", "product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_document_product_type_key" ON "stock_movement"("company_id", "document_id", "product_id", "movement_type");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_idempotency_key" ON "stock_movement"("company_id", "idempotency_operation", "idempotency_key");

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "product"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_initialized_by_fkey" FOREIGN KEY ("initialized_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "stock_balance"("company_id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_company_id_document_id_fkey" FOREIGN KEY ("company_id", "document_id") REFERENCES "electronic_document"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dominio `existencia` (design D3): 30 dígitos en total y hasta 6 decimales, con signo; con 6
-- decimales, menos de 10^24. La misma regla que el resto de la política decimal (Q-43).
ALTER TABLE "stock_balance" ADD CONSTRAINT "stock_balance_values_check" CHECK (
  scale("balance") <= 6
  AND abs("balance") < power(10::numeric, 30 - scale("balance"))
  AND "last_position" >= 1);

-- Movimientos (design D2): tipo, signo por tipo, coherencia de comprobante, origen, actor, motivo e
-- idempotencia. El INICIAL es exactamente la posición 1, y la posición es única por producto: a lo
-- sumo un INICIAL en toda la vida del inventario (Q-21).
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_values_check" CHECK (
  "movement_type" IN ('INICIAL', 'ENTRADA_MANUAL', 'SALIDA_FACTURA', 'DEVOLUCION_NC', 'AJUSTE')
  AND "origin" IN ('USER', 'SYSTEM')
  AND "position" >= 1
  AND ("movement_type" = 'INICIAL') = ("position" = 1)
  AND scale("delta") <= 6
  AND abs("delta") < power(10::numeric, 30 - scale("delta"))
  AND scale("balance_after") <= 6
  AND abs("balance_after") < power(10::numeric, 30 - scale("balance_after"))
  AND CASE "movement_type"
    WHEN 'INICIAL' THEN "delta" >= 0 AND "balance_after" = "delta"
    WHEN 'ENTRADA_MANUAL' THEN "delta" > 0
    WHEN 'SALIDA_FACTURA' THEN "delta" < 0
    WHEN 'DEVOLUCION_NC' THEN "delta" > 0
    ELSE "delta" <> 0
  END
  AND ("document_id" IS NOT NULL) = ("movement_type" IN ('SALIDA_FACTURA', 'DEVOLUCION_NC'))
  AND ("document_number" IS NOT NULL) = ("document_id" IS NOT NULL)
  AND ("document_number" IS NULL OR "document_number" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$')
  AND ("movement_type" <> 'SALIDA_FACTURA' OR "origin" = 'SYSTEM')
  AND ("movement_type" NOT IN ('INICIAL', 'ENTRADA_MANUAL', 'AJUSTE') OR "origin" = 'USER')
  AND ("actor_user_id" IS NOT NULL) = ("origin" = 'USER')
  AND ("movement_type" <> 'AJUSTE' OR ("reason" IS NOT NULL AND btrim("reason") <> ''))
  AND ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500)
  AND ("idempotency_operation" IS NULL) = ("idempotency_key" IS NULL)
  AND ("idempotency_key" IS NULL) = ("request_hash" IS NULL)
  AND CASE "movement_type"
    WHEN 'ENTRADA_MANUAL' THEN "idempotency_operation" IS NOT DISTINCT FROM 'inventory.entry'
    WHEN 'AJUSTE' THEN "idempotency_operation" IS NOT DISTINCT FROM 'inventory.adjust'
    ELSE "idempotency_operation" IS NULL
  END
  AND ("idempotency_key" IS NULL OR "idempotency_key" ~ '^[!-~]{1,100}$')
  AND ("request_hash" IS NULL OR "request_hash" ~ '^[0-9a-f]{64}$'));

CREATE FUNCTION inventory_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% no admite %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Los movimientos son de solo agregado (ERS RF-313) y no se truncan.
CREATE TRIGGER "stock_movement_append_only" BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION inventory_reject_change();
CREATE TRIGGER "stock_movement_no_truncate" BEFORE TRUNCATE ON "stock_movement"
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_change();

-- Cada movimiento encadena con el anterior: sin huecos y con el saldo anterior más su variación.
CREATE FUNCTION stock_movement_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  previous numeric;
BEGIN
  IF NEW."position" = 1 THEN
    RETURN NEW;
  END IF;
  SELECT "balance_after" INTO previous FROM "stock_movement"
    WHERE "company_id" = NEW."company_id" AND "product_id" = NEW."product_id"
      AND "position" = NEW."position" - 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'el movimiento % del producto % no sigue a otro', NEW."position", NEW."product_id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."balance_after" <> previous + NEW."delta" THEN
    RAISE EXCEPTION 'el saldo después del movimiento no es el anterior más su variación'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_movement_chain" BEFORE INSERT ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION stock_movement_chain();

-- El saldo no se borra ni se trunca; su empresa, su producto y su inicialización no cambian, y su
-- posición solo avanza.
CREATE FUNCTION stock_balance_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."company_id" IS DISTINCT FROM OLD."company_id"
    OR NEW."product_id" IS DISTINCT FROM OLD."product_id"
    OR NEW."initialized_at" IS DISTINCT FROM OLD."initialized_at"
    OR NEW."initialized_by" IS DISTINCT FROM OLD."initialized_by" THEN
    RAISE EXCEPTION 'la empresa, el producto y la inicialización de un inventario no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."last_position" < OLD."last_position" THEN
    RAISE EXCEPTION 'la posición del kárdex no retrocede' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_balance_guard" BEFORE UPDATE ON "stock_balance"
  FOR EACH ROW EXECUTE FUNCTION stock_balance_guard();
CREATE TRIGGER "stock_balance_no_delete" BEFORE DELETE ON "stock_balance"
  FOR EACH ROW EXECUTE FUNCTION inventory_reject_change();
CREATE TRIGGER "stock_balance_no_truncate" BEFORE TRUNCATE ON "stock_balance"
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_reject_change();

-- Al confirmar, cada saldo tiene su INICIAL y es el saldo después de su último movimiento: con la
-- cadena de movimientos, el saldo es la suma de las variaciones del kárdex (design D2).
CREATE FUNCTION stock_balance_matches_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  latest numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "stock_movement"
      WHERE "company_id" = NEW."company_id" AND "product_id" = NEW."product_id"
        AND "position" = 1 AND "movement_type" = 'INICIAL'
  ) THEN
    RAISE EXCEPTION 'el inventario del producto % no tiene su INICIAL', NEW."product_id"
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "balance_after" INTO latest FROM "stock_movement"
    WHERE "company_id" = NEW."company_id" AND "product_id" = NEW."product_id"
      AND "position" = NEW."last_position";
  IF NOT FOUND OR latest <> NEW."balance" OR EXISTS (
    SELECT 1 FROM "stock_movement"
      WHERE "company_id" = NEW."company_id" AND "product_id" = NEW."product_id"
        AND "position" > NEW."last_position"
  ) THEN
    RAISE EXCEPTION 'el saldo del producto % no coincide con su kárdex', NEW."product_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "stock_balance_matches_ledger"
  AFTER INSERT OR UPDATE ON "stock_balance"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stock_balance_matches_ledger();

-- Un movimiento confirmado siempre está reflejado en su saldo: un movimiento insertado sin avanzar
-- el saldo falla al confirmar.
CREATE FUNCTION stock_movement_in_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "stock_balance"
      WHERE "company_id" = NEW."company_id" AND "product_id" = NEW."product_id"
        AND "last_position" >= NEW."position"
  ) THEN
    RAISE EXCEPTION 'el movimiento % del producto % no está en su saldo', NEW."position", NEW."product_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "stock_movement_in_balance"
  AFTER INSERT ON "stock_movement"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION stock_movement_in_balance();
