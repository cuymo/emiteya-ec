// Los XSD oficiales de docs/product/sri-xsd/ son material fuente (ERS RF-104): cada archivo debe
// tener el SHA-256 que registra su README.md, para que un cambio accidental o malicioso de un
// esquema no pase desapercibido (docs/security/threat-model.md).
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const XSD_DIR = fileURLToPath(new URL("../../../docs/product/sri-xsd/", import.meta.url));

type Mismatch = { file: string; reason: string };

/** Compara cada XSD del directorio con la tabla de su manifiesto. */
function checkManifest(dir: string): { files: string[]; mismatches: Mismatch[] } {
  const manifest = readFileSync(join(dir, "README.md"), "utf8");
  const expected = new Map(
    [...manifest.matchAll(/\| `([\w.]+\.xsd)` \| `([0-9a-f]{64})` \|/g)].map(([, file, hash]) => [
      file as string,
      hash as string,
    ]),
  );
  const files = readdirSync(dir).filter((file) => file.endsWith(".xsd"));
  const mismatches: Mismatch[] = [];
  for (const file of files) {
    const hash = createHash("sha256")
      .update(readFileSync(join(dir, file)))
      .digest("hex");
    if (!expected.has(file)) mismatches.push({ file, reason: "no está en el manifiesto" });
    else if (expected.get(file) !== hash) mismatches.push({ file, reason: "SHA-256 distinto" });
  }
  for (const file of expected.keys()) {
    if (!files.includes(file)) mismatches.push({ file, reason: "falta el archivo" });
  }
  return { files, mismatches };
}

describe("manifiesto de los XSD oficiales del SRI", () => {
  const scratch = mkdtempSync(join(tmpdir(), "facturador-xsd-"));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("cada XSD tiene el SHA-256 de su manifiesto", () => {
    const { files, mismatches } = checkManifest(XSD_DIR);
    expect(files).toHaveLength(6);
    expect(mismatches).toEqual([]);
  });

  it("detecta un byte alterado en una copia", () => {
    const copy = join(scratch, "sri-xsd");
    cpSync(XSD_DIR, copy, { recursive: true });
    const target = join(copy, "factura_V1.1.0.xsd");
    const bytes = readFileSync(target);
    bytes[100] = (bytes[100] ?? 0) ^ 0x01;
    writeFileSync(target, bytes);
    expect(checkManifest(copy).mismatches).toEqual([
      { file: "factura_V1.1.0.xsd", reason: "SHA-256 distinto" },
    ]);
  });
});
