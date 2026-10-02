// Genera docs/generated/openapi.json desde el registro de rutas. Con --check, falla si difiere.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiRoutes, buildOpenApiDocument } from "@facturador/contracts";

const target = fileURLToPath(new URL("../../../docs/generated/openapi.json", import.meta.url));
const document = buildOpenApiDocument(apiRoutes, { title: "Facturador SRI API", version: "0.0.0" });
const content = JSON.stringify(document, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== content) {
    console.error(
      "openapi:check falló: docs/generated/openapi.json no coincide con el registro de rutas.",
    );
    console.error("Ejecuta `corepack pnpm openapi:generate` y versiona el resultado.");
    process.exit(1);
  }
  console.log("openapi:check: docs/generated/openapi.json está al día.");
} else {
  writeFileSync(target, content);
  console.log(`OpenAPI generado en ${target}`);
}
