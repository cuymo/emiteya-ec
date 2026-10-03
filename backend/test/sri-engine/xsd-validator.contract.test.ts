// Contrato del adaptador XsdValidator sobre xmllint-wasm (spike S-2, ADR 0021): valida sin red
// contra los XSD versionados del producto, con sus hashes, y nunca cae a los XSD de una librería.
// Debe pasar antes de aceptar cualquier actualización de xmllint-wasm.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { DocumentType } from "@facturador/contracts";
import {
  XsdValidatorError,
  type RegisteredSchema,
  type XsdValidation,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  XMLDSIG_SCHEMA,
  createXmllintXsdValidator,
} from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const SCHEMA_DIR = path("../../../docs/product/sri-xsd/");
const IMPORT_DIR = path("../../../docs/product/w3c-xsd/");
const FIXTURES = path("../fixtures/xsd/");

// Los esquemas tal como los registra el dataset del registro de esquemas de fiscal-catalogs.
const registry = (
  JSON.parse(
    readFileSync(path("../../src/modules/catalogs/datasets/schema-registry/1.json"), "utf8"),
  ) as { entries: RegisteredSchema[] }
).entries.map(({ documentType, version, file, sha256 }) => ({
  documentType,
  version,
  file,
  sha256,
}));
const schemaOf = (documentType: DocumentType) =>
  registry.find((entry) => entry.documentType === documentType)!;
const fixture = (documentType: DocumentType) =>
  readFileSync(join(FIXTURES, `${documentType}.xml`), "utf8");
const factura = fixture("01");

const validator = createXmllintXsdValidator({
  schemaDirectory: SCHEMA_DIR,
  importDirectory: IMPORT_DIR,
});
const validate = (xml: string, schema = schemaOf("01")) => validator.validate(xml, schema);
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof XsdValidatorError ? error.code : `otro: ${String(error)}`,
  );
const violations = (result: XsdValidation) => (result.valid ? [] : result.violations);

describe("contrato de XsdValidator sobre xmllint-wasm (spike S-2, ADR 0021)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "facturador-xsd-validator-"));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("el registro tiene los seis esquemas versionados", () => {
    expect(registry.map((entry) => `${entry.documentType}@${entry.version}`)).toEqual([
      "01@1.1.0",
      "03@1.1.0",
      "04@1.1.0",
      "05@1.0.0",
      "06@1.1.0",
      "07@2.0.0",
    ]);
  });

  for (const documentType of ["01", "03", "04", "05", "06", "07"] as const) {
    it(`un XML válido de ${documentType} pasa contra su XSD registrado, con el import de la firma`, async () => {
      expect(await validate(fixture(documentType), schemaOf(documentType))).toEqual({
        valid: true,
      });
    });
  }

  it("un XML válido para un tipo no lo es para otro", async () => {
    const result = await validate(factura, schemaOf("04"));
    expect(result.valid).toBe(false);
    expect(violations(result)[0]?.message).toContain("No matching global declaration");
  });

  describe("XML inválido por estructura", () => {
    it("falta un elemento obligatorio", async () => {
      const result = await validate(factura.replace(/<ruc>\d{13}<\/ruc>/, ""));
      expect(violations(result)).toEqual([
        {
          line: expect.any(Number) as number,
          message: "Element 'claveAcceso': This element is not expected. Expected is ( ruc ).",
        },
      ]);
    });

    it("sobra un elemento desconocido", async () => {
      const result = await validate(
        factura.replace("</infoFactura>", "<extra>x</extra></infoFactura>"),
      );
      expect(violations(result)[0]?.message).toContain(
        "Element 'extra': This element is not expected.",
      );
    });

    it("un XML mal formado es inválido, no un fallo del validador", async () => {
      const result = await validate(factura.replace("</factura>", ""));
      expect(result.valid).toBe(false);
      expect(violations(result)[0]?.message).toContain("Premature end of data in tag factura");
    });
  });

  describe("XML inválido por escala o formato", () => {
    for (const [label, from, to, cause] of [
      [
        "importe con 3 decimales",
        /<importeTotal>[^<]+</,
        "<importeTotal>20.135<",
        "fractionDigits",
      ],
      ["cantidad con 7 decimales", /<cantidad>[^<]+</, "<cantidad>2.0000001<", "fractionDigits"],
      [
        "precio con 7 decimales",
        /<precioUnitario>[^<]+</,
        "<precioUnitario>8.7500001<",
        "fractionDigits",
      ],
      ["tarifa con 5 dígitos", /<tarifa>[^<]+</, "<tarifa>100.55<", "totalDigits"],
      ["fecha ISO", /<fechaEmision>[^<]+</, "<fechaEmision>2026-10-03<", "pattern"],
      ["RUC con letras", /<ruc>[^<]+</, "<ruc>17900123450A1<", "pattern"],
      ["importe con exponente", /<importeTotal>[^<]+</, "<importeTotal>2.013E1<", "importeTotal"],
    ] as const) {
      it(label, async () => {
        const result = await validate(factura.replace(from, to));
        expect(result.valid, label).toBe(false);
        expect(
          violations(result)
            .map((v) => v.message)
            .join(" "),
          label,
        ).toContain(`'${cause}'`);
      });
    }

    it("el límite exacto de la escala pasa: 6 decimales en cantidad y precio", async () => {
      const result = await validate(
        factura
          .replace(/<cantidad>[^<]+</, "<cantidad>999999999999.999999<")
          .replace(/<precioUnitario>[^<]+</, "<precioUnitario>999999999999999999<"),
      );
      expect(result).toEqual({ valid: true });
    });
  });

  describe("esquemas del registro e imports", () => {
    it("sin el import de la firma falla cerrada: no lo busca en la red ni en la librería", async () => {
      const noImport = createXmllintXsdValidator({
        schemaDirectory: SCHEMA_DIR,
        importDirectory: IMPORT_DIR,
        imports: [],
      });
      expect(await codeOf(noImport.validate(factura, schemaOf("01")))).toBe("VALIDATOR_FAILED");
    });

    it("un archivo del registro que no existe o sale de su directorio no está disponible", async () => {
      for (const file of [
        "factura_V9.9.9.xsd",
        "../w3c-xsd/xmldsig-core-schema.xsd",
        "factura.xml",
      ]) {
        expect(await codeOf(validate(factura, { ...schemaOf("01"), file })), file).toBe(
          "SCHEMA_UNAVAILABLE",
        );
      }
    });

    it("un esquema o un import alterado falla cerrada por su hash, en cada intento", async () => {
      const dir = join(scratch, "sri-xsd");
      cpSync(SCHEMA_DIR, dir, { recursive: true });
      const target = join(dir, "factura_V1.1.0.xsd");
      const bytes = readFileSync(target);
      bytes[200] = (bytes[200] ?? 0) ^ 0x01;
      writeFileSync(target, bytes);
      const tampered = createXmllintXsdValidator({
        schemaDirectory: dir,
        importDirectory: IMPORT_DIR,
      });
      expect(await codeOf(tampered.validate(factura, schemaOf("01")))).toBe("SCHEMA_HASH_MISMATCH");
      expect(await codeOf(tampered.validate(factura, schemaOf("01")))).toBe("SCHEMA_HASH_MISMATCH");
      const wrongImport = createXmllintXsdValidator({
        schemaDirectory: SCHEMA_DIR,
        importDirectory: IMPORT_DIR,
        imports: [{ ...XMLDSIG_SCHEMA, sha256: "0".repeat(64) }],
      });
      expect(await codeOf(wrongImport.validate(factura, schemaOf("01")))).toBe(
        "SCHEMA_HASH_MISMATCH",
      );
    });
  });

  describe("caché e inicialización", () => {
    it("lee y comprueba cada XSD una vez por instancia, sin estado global", async () => {
      const reads: string[] = [];
      const counting = (dir: string) =>
        createXmllintXsdValidator({
          schemaDirectory: SCHEMA_DIR,
          importDirectory: IMPORT_DIR,
          readFile: (file) => {
            reads.push(file.slice(dir.length));
            return readFile(file);
          },
        });
      const first = counting("");
      await Promise.all([
        first.validate(factura, schemaOf("01")),
        first.validate(factura, schemaOf("01")),
      ]);
      await first.validate(fixture("04"), schemaOf("04"));
      expect(reads.map((file) => file.split("/").pop()).sort()).toEqual([
        "NotaCredito_V1.1.0.xsd",
        "factura_V1.1.0.xsd",
        "xmldsig-core-schema.xsd",
      ]);
      const second = counting("");
      await second.validate(factura, schemaOf("01"));
      expect(reads).toHaveLength(5);
    });

    it("un fallo de lectura no se recuerda: el siguiente intento vuelve a leer", async () => {
      let attempts = 0;
      const flaky = createXmllintXsdValidator({
        schemaDirectory: SCHEMA_DIR,
        importDirectory: IMPORT_DIR,
        readFile: (file) => {
          if (file.endsWith("factura_V1.1.0.xsd") && attempts++ === 0) {
            return Promise.reject(new Error("EIO /ruta/interna"));
          }
          return readFile(file);
        },
      });
      expect(await codeOf(flaky.validate(factura, schemaOf("01")))).toBe("SCHEMA_UNAVAILABLE");
      expect(await flaky.validate(factura, schemaOf("01"))).toEqual({ valid: true });
    });
  });

  it("los errores son códigos, sin rutas, salida de xmllint ni contenido del XML", async () => {
    const error = await validate(factura, { ...schemaOf("01"), file: "factura_V9.9.9.xsd" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(XsdValidatorError);
    expect((error as Error).message).toBe("SCHEMA_UNAVAILABLE");
    const result = await validate(factura.replace(/<importeTotal>[^<]+</, "<importeTotal>20.135<"));
    for (const violation of violations(result)) {
      expect(violation.message).not.toMatch(/docs\/product|comprobante\.xml|\.xsd:/);
    }
  });
});
