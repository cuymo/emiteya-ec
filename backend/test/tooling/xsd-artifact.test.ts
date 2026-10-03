// Empaquetado de los XSD del registro (add-invoice-emission, tarea 2.3, design D11): el build copia
// cada archivo del registro vigente a `dist/xsd/<ruta lógica>` y `check:xsd-artifact` falla si
// alguno falta o no coincide con su SHA-256.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { bundleFiles, checkBundle, copyBundle } from "../../scripts/xsd-bundle.ts";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));

function checkArtifact(root: string) {
  return spawnSync(
    process.execPath,
    ["--conditions=development", "scripts/check-xsd-artifact.ts", root],
    { cwd: backendRoot, encoding: "utf8", timeout: 30_000 },
  );
}

describe("paquete de XSD del build", () => {
  const scratch = mkdtempSync(join(tmpdir(), "facturador-xsd-artifact-"));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("toma los siete archivos del registro vigente por su ruta lógica", () => {
    expect(bundleFiles().map((file) => file.path)).toEqual([
      "sri-xsd/factura_V1.1.0.xsd",
      "sri-xsd/LiquidacionCompra_V1.1.0.xsd",
      "sri-xsd/NotaCredito_V1.1.0.xsd",
      "sri-xsd/NotaDebito_V1.0.0.xsd",
      "sri-xsd/GuiaRemision_V1.1.0.xsd",
      "sri-xsd/ComprobanteRetencion_V2.0.0.xsd",
      "w3c-xsd/xmldsig-core-schema.xsd",
    ]);
  });

  it("la copia lleva cada archivo con su hash y la comprobación pasa", () => {
    const root = join(scratch, "intact");
    copyBundle(bundleFiles(), undefined, root);
    expect(checkBundle(bundleFiles(), root)).toEqual([]);
    const result = checkArtifact(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("7 XSD con su hash");
  });

  it("falla con un archivo alterado o ausente", () => {
    const root = join(scratch, "broken");
    copyBundle(bundleFiles(), undefined, root);
    const target = join(root, "sri-xsd", "factura_V1.1.0.xsd");
    const bytes = readFileSync(target);
    bytes[100] = (bytes[100] ?? 0) ^ 0x01;
    writeFileSync(target, bytes);
    rmSync(join(root, "w3c-xsd", "xmldsig-core-schema.xsd"));
    expect(checkBundle(bundleFiles(), root)).toEqual([
      { path: "sri-xsd/factura_V1.1.0.xsd", reason: "HASH_MISMATCH" },
      { path: "w3c-xsd/xmldsig-core-schema.xsd", reason: "MISSING" },
    ]);
    const result = checkArtifact(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sri-xsd/factura_V1.1.0.xsd: HASH_MISMATCH");
    expect(result.stderr).toContain("w3c-xsd/xmldsig-core-schema.xsd: MISSING");
  });
});
