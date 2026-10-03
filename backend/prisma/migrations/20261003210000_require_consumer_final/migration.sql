-- Consumidor final obligatorio por empresa (add-parties-and-products, design D5 y D15). Llega con
-- su iniciador de empresa: el aprovisionamiento crea la empresa y su consumidor final en la misma
-- transacción, y el arranque repone el de las empresas anteriores antes de atender peticiones.
-- Después de esta migración, un downgrade binario a una versión anterior no es compatible: la
-- estrategia es avanzar (docs/architecture/deployment.md).

-- Toda empresa confirma con su consumidor final (design D5). Diferido: el iniciador de empresa lo
-- crea en la misma transacción, después de la empresa. Las empresas anteriores a esta migración no
-- se comprueban aquí; las repone el arranque antes de atender peticiones.
CREATE FUNCTION organization_requires_consumer_final() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "party" WHERE "company_id" = NEW."id" AND "system_record" = 'CONSUMER_FINAL'
  ) THEN
    RAISE EXCEPTION 'la empresa % no tiene consumidor final', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "organization_requires_consumer_final" AFTER INSERT ON "organization"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION organization_requires_consumer_final();
