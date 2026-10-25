// Genera docs/generated/openapi.json desde el registro de rutas. Con --check, falla si difiere.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { apiRoutes, buildOpenApiDocument } from "@facturador/contracts";

const target = fileURLToPath(new URL("../../../docs/generated/openapi.json", import.meta.url));
// La versión del documento es la del paquete de contratos, que sigue la del producto.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};
// Regla de origen de la API (enforce-api-origin-and-body-limits), sin el origen configurado.
const description = [
  "API de la aplicación, autenticada con la cookie de sesión y sin CORS.",
  "Toda mutación (POST, PUT, PATCH y DELETE) exige una cabecera Origin igual al origen público de la aplicación.",
  "Una petición con Sec-Fetch-Site same-site o cross-site recibe 403 en cualquier método salvo OPTIONS.",
  "Los dos rechazos responden 403 REQUEST_ORIGIN_REJECTED antes de leer el cuerpo y de autenticar.",
].join(" ");
const document = buildOpenApiDocument(apiRoutes, {
  title: "EmiteYa API",
  version,
  description,
});
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
