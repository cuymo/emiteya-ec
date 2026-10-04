// Los WSDL oficiales de docs/product/sri-wsdl/ son material fuente (add-sri-transmission, design
// D10): cada archivo tiene el SHA-256 que registra su README.md.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL("../../../docs/product/sri-wsdl/", import.meta.url));

describe("manifiesto de los WSDL oficiales del SRI", () => {
  it("cada WSDL tiene el SHA-256 de su manifiesto y no sobra ni falta ninguno", () => {
    const manifest = readFileSync(join(DIR, "README.md"), "utf8");
    const expected: Record<string, string> = {};
    for (const [, file, hash] of manifest.matchAll(
      /\| `([\w]+\.wsdl)` \|[^\n]*\| `([0-9a-f]{64})` \|/g,
    )) {
      expected[file!] = hash!;
    }
    const actual = Object.fromEntries(
      readdirSync(DIR)
        .filter((file) => file.endsWith(".wsdl"))
        .map((file) => [
          file,
          createHash("sha256")
            .update(readFileSync(join(DIR, file)))
            .digest("hex"),
        ]),
    );
    expect(Object.keys(actual)).toHaveLength(3);
    expect(actual).toEqual(expected);
  });

  it("los espacios de nombres son los de la ficha v2.34", () => {
    const namespace = (file: string) =>
      /targetNamespace="([^"]+)"/.exec(readFileSync(join(DIR, file), "utf8"))?.[1];
    expect(namespace("RecepcionComprobantesOffline.wsdl")).toBe("http://ec.gob.sri.ws.recepcion");
    expect(namespace("AutorizacionComprobantesOffline.wsdl")).toBe(
      "http://ec.gob.sri.ws.autorizacion",
    );
    expect(namespace("ConsultaComprobante.wsdl")).toBe("http://ec.gob.sri.ws.consultas");
  });
});
