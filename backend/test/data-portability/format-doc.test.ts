// El documento del formato cita cada hoja y cada columna que generan los libros (add-data-portability,
// tarea 4.7): el formato publicado y el código no pueden divergir.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sheets from "../../src/modules/data-portability/domain/sheets.ts";
import { EXCLUSIONS } from "../../src/modules/data-portability/domain/manifest.ts";

const DOC = readFileSync(
  fileURLToPath(new URL("../../../docs/architecture/data-portability-format.md", import.meta.url)),
  "utf8",
);
const MODULE_DOC = readFileSync(
  fileURLToPath(new URL("../../../docs/architecture/data-portability.md", import.meta.url)),
  "utf8",
);

type Definition = { name: string; columns: readonly { header: string; kind: string }[] };
function isDefinition(value: unknown): value is Definition {
  return typeof value === "object" && value !== null && "columns" in value && "name" in value;
}
const definitions: Definition[] = (Object.values(sheets) as unknown[]).filter(isDefinition);

describe("documento del formato de portabilidad", () => {
  it("cita cada hoja y cada columna con el tipo de su celda", () => {
    expect(definitions.length).toBe(19);
    const kinds: Record<string, string> = {
      text: "Texto",
      money: "Importe",
      decimal: "Decimal",
      date: "Fecha",
      dateTime: "Momento (hora de Ecuador)",
    };
    for (const definition of definitions) {
      const start = DOC.indexOf(`**${definition.name}**`);
      expect(start, definition.name).toBeGreaterThan(-1);
      const section = DOC.slice(start, DOC.indexOf("\n\n**", start + 1) >>> 0 || undefined);
      for (const column of definition.columns) {
        expect(section, `${definition.name}: ${column.header}`).toContain(
          `| ${column.header} | ${kinds[column.kind]} |`,
        );
      }
    }
  });

  it("documenta la estructura, el manifiesto, SHA256SUMS, los ausentes y las exclusiones", () => {
    for (const text of [
      "datos-AAAAMMDD-HHMMSS.zip",
      "manifest.json",
      "SHA256SUMS",
      "LEEME.txt",
      "RIDE_PENDING",
      "RIDE_STOPPED",
      "DATA_EXPORT_ARTIFACT_MISSING",
      "snapshotVersion",
      "sha256sum -c SHA256SUMS",
      "No es",
    ])
      expect(DOC).toContain(text);
    expect(EXCLUSIONS.length).toBeGreaterThan(0);
    expect(DOC).toMatch(/firma electrónica/);
    expect(DOC).toMatch(/borradores/);
  });

  it("el documento del módulo describe las fases, el fencing y el barrido", () => {
    for (const text of [
      "REPEATABLE READ, READ ONLY",
      "JobStore.renew",
      "JobStore.fence",
      "DATA_EXPORT_PACKAGE_MISSING",
      "DATA_EXPORT_DIRECTORY",
      "DATA_EXPORT_TTL_HOURS",
    ])
      expect(MODULE_DOC).toContain(text);
  });
});
