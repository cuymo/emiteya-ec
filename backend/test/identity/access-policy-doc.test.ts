// La tabla de permisos implementados de docs/security/access-control.md coincide con el mapa central.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, can } from "../../src/modules/identity/domain/access-policy.ts";

const doc = readFileSync(
  new URL("../../../docs/security/access-control.md", import.meta.url),
  "utf8",
);

function documentedRows() {
  return doc
    .split("\n")
    .map((line) => /^\| `([a-zA-Z.]+)` \| [^|]+ \| (Sí|No) \| (Sí|No) \|$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, permission, admin, operator]) => ({
      permission,
      ADMIN: admin === "Sí",
      OPERATOR: operator === "Sí",
    }));
}

describe("documentación de los permisos", () => {
  it("documenta exactamente los permisos implementados con sus celdas", () => {
    const rows = documentedRows();
    expect(rows.map((row) => row.permission).sort()).toEqual([...PERMISSIONS].sort());
    for (const row of rows) {
      expect(can("ADMIN", row.permission), `${row.permission} ADMIN`).toBe(row.ADMIN);
      expect(can("OPERATOR", row.permission), `${row.permission} OPERATOR`).toBe(row.OPERATOR);
    }
  });
});
