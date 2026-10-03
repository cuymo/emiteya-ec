// Verificación del paquete de XSD al arrancar (add-invoice-emission, design D11): cada archivo del
// registro de esquemas vigente, documentos e imports, presente bajo la raíz del paquete y con su
// SHA-256. Si falla, el backend no se declara listo: el resultado entra en `/health/ready` y en la
// métrica `xsd_registry_available`. Sin descargas ni sustitutos.
import { Gauge, type Registry } from "@prometheus-io/client";
import type { Logger } from "pino";
import type { XsdValidator } from "../application/ports.ts";
import { registryFiles, type SchemaRegistryEntry } from "../application/schemas.ts";

export async function verifySchemaBundle({
  validator,
  registry,
  metrics,
  logger,
}: {
  validator: Pick<XsdValidator, "verifyBundle">;
  registry: () => Promise<readonly SchemaRegistryEntry[]>;
  metrics: Registry;
  logger: Logger;
}): Promise<boolean> {
  const gauge = new Gauge({
    name: "xsd_registry_available",
    help: "1 si el paquete de XSD del registro de esquemas está completo y con sus hashes, 0 si no.",
    registers: [metrics],
  });
  let available = false;
  try {
    const files = registryFiles(await registry());
    const failures = files.length === 0 ? [] : await validator.verifyBundle(files);
    if (files.length === 0) {
      logger.error("el registro de esquemas está vacío");
    } else if (failures.length > 0) {
      logger.error({ failures }, "el paquete de XSD del registro está incompleto o alterado");
    } else {
      available = true;
      logger.info({ schemas: files.length }, "paquete de XSD verificado");
    }
  } catch (error) {
    logger.error({ err: error }, "no se pudo verificar el paquete de XSD del registro");
  }
  gauge.set(available ? 1 : 0);
  return available;
}
