import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DECIMAL_SPECS,
  canonicalDecimal,
  compareDecimalStrings,
  decimalString,
  decimalStringSchema,
  type DecimalSpec,
} from "../src/decimal.ts";

// Los seis XSD soportados (ADR 0008), por código de comprobante.
const XSD_DIR = fileURLToPath(new URL("../../../docs/product/sri-xsd/", import.meta.url));
const XSD_FILES: Record<string, string> = {
  "01": "factura_V1.1.0.xsd",
  "03": "LiquidacionCompra_V1.1.0.xsd",
  "04": "NotaCredito_V1.1.0.xsd",
  "05": "NotaDebito_V1.0.0.xsd",
  "06": "GuiaRemision_V1.1.0.xsd",
  "07": "ComprobanteRetencion_V2.0.0.xsd",
};

type XsdDecimal = { totalDigits: number; fractionDigits: number; min: string | null };

/** `xsd:decimal` con nombre de un XSD: dígitos, decimales y mínimo. */
function xsdDecimals(document: string): Map<string, XsdDecimal> {
  const xsd = readFileSync(`${XSD_DIR}${XSD_FILES[document]}`, "utf8");
  const types = new Map<string, XsdDecimal>();
  for (const [, name, body] of xsd.matchAll(
    /<xsd:simpleType name="([^"]+)">\s*<xsd:restriction base="xsd:decimal">([\s\S]*?)<\/xsd:restriction>/g,
  )) {
    types.set(name!, {
      totalDigits: Number(/totalDigits value="(\d+)"/.exec(body!)?.[1]),
      fractionDigits: Number(/fractionDigits value="(\d+)"/.exec(body!)?.[1]),
      min: /minInclusive value="([^"]+)"/.exec(body!)?.[1] ?? null,
    });
  }
  return types;
}

const ALL = Object.fromEntries(Object.keys(XSD_FILES).map((doc) => [doc, xsdDecimals(doc)]));

describe("escalas decimales derivadas de los XSD soportados (design D10)", () => {
  for (const [name, spec] of Object.entries(DECIMAL_SPECS) as [string, DecimalSpec][]) {
    it(`${name} coincide con su tipo en cada documento que lo define`, () => {
      for (const document of spec.xsd.documents) {
        for (const type of spec.xsd.types) {
          expect(ALL[document]!.get(type), `${type} en ${document}`).toEqual({
            totalDigits: spec.totalDigits,
            fractionDigits: spec.fractionDigits,
            min: spec.min,
          });
        }
      }
    });

    it(`${name}: ningún otro documento define su tipo con otra escala, salvo la excepción conocida`, () => {
      for (const [document, types] of Object.entries(ALL)) {
        for (const type of spec.xsd.types) {
          const found = types.get(type);
          if (!found || spec.xsd.documents.includes(document)) continue;
          if (name === "tarifa" && document === "07") {
            // Excepción documentada: la retención 2.0.0 usa 3/2, escala propia de su cambio.
            expect(found).toEqual({ totalDigits: 3, fractionDigits: 2, min: "0" });
            continue;
          }
          expect([found.totalDigits, found.fractionDigits], `${type} en ${document}`).toEqual([
            spec.totalDigits,
            spec.fractionDigits,
          ]);
        }
      }
    });
  }

  it("todo importe de los seis XSD es 14/2; el mínimo depende del campo", () => {
    const money = ["importeTotal", "valor", "baseImponible", "totalSinImpuestos", "total"];
    const withoutMinimum: string[] = [];
    for (const [document, types] of Object.entries(ALL)) {
      for (const type of money) {
        const found = types.get(type);
        if (!found) continue;
        expect([found.totalDigits, found.fractionDigits], `${type} en ${document}`).toEqual([
          14, 2,
        ]);
        if (found.min === null) withoutMinimum.push(`${document}:${type}`);
      }
    }
    // Campos sin mínimo: por eso "sin signo" es de los tipos no negativos, no del universal.
    expect(withoutMinimum.sort()).toEqual([
      "05:totalSinImpuestos",
      "06:baseImponible",
      "06:totalSinImpuestos",
      "06:valor",
      "07:totalSinImpuestos",
      "07:valor",
    ]);
  });
});

describe("DecimalString universal", () => {
  it("acepta decimales con signo y rechaza otras representaciones", () => {
    for (const ok of ["0", "12", "12.5", "-3.25", "0.000001", "1000000"]) {
      expect(decimalStringSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      "",
      " 1",
      "1 ",
      "+1",
      "-0",
      "-0.00",
      "01",
      "1.",
      ".5",
      "1e3",
      "1E-2",
      "1,5",
      "1.000,5",
      "1_000",
      "NaN",
      "Infinity",
    ]) {
      expect(decimalStringSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("rechaza un número JSON: ya pasó por coma flotante", () => {
    expect(decimalStringSchema.safeParse(12.5).success).toBe(false);
    expect(decimalString(DECIMAL_SPECS.tarifa).safeParse(15).success).toBe(false);
  });

  it("forma canónica más corta y exacta", () => {
    expect(canonicalDecimal("12.50")).toBe("12.5");
    expect(canonicalDecimal("15.00")).toBe("15");
    expect(canonicalDecimal("0.000001")).toBe("0.000001");
    expect(canonicalDecimal("-2.10")).toBe("-2.1");
    expect(canonicalDecimal("0.0")).toBe("0");
  });

  it("compara sin convertir a número", () => {
    expect(compareDecimalStrings("100", "99.99")).toBe(1);
    expect(compareDecimalStrings("0.10", "0.1")).toBe(0);
    expect(compareDecimalStrings("-1", "0")).toBe(-1);
    expect(compareDecimalStrings("-2", "-10")).toBe(1);
    expect(compareDecimalStrings("12345678901234567.890001", "12345678901234567.89")).toBe(1);
  });
});

describe("tipos no negativos con su especificación (regla del XSD, Q-43)", () => {
  const specs = {
    tarifa: decimalString(DECIMAL_SPECS.tarifa),
    importe: decimalString(DECIMAL_SPECS.importe),
    precioUnitario: decimalString(DECIMAL_SPECS.precioUnitario),
    cantidad: decimalString(DECIMAL_SPECS.cantidad),
  };
  const message = (name: keyof typeof specs, text: string) =>
    specs[name].safeParse(text).error?.issues[0]?.message;

  it("la parte entera usa los dígitos que no ocupan los decimales", () => {
    for (const [name, values] of [
      ["tarifa", ["0", "15", "99.99", "100", "100.5", "300", "9999"]],
      ["importe", ["0", "50.00", "999999999999.99", "99999999999999", "1234567890123.4"]],
      ["precioUnitario", ["0", "0.000001", "999999999999999999", "999999999999.999999"]],
      ["cantidad", ["0", "0.000001", "999999999999999999", "999999999999.999999"]],
    ] as const) {
      for (const text of values) expect(message(name, text), `${name} ${text}`).toBeUndefined();
    }
  });

  it("rechazan el total de más, los decimales de más y los negativos, sin redondear", () => {
    for (const [name, text, expected] of [
      ["tarifa", "10000", "Admite como máximo 4 dígitos en total."],
      ["tarifa", "100.55", "Admite como máximo 4 dígitos en total."],
      ["tarifa", "12.345", "Admite como máximo 2 decimales."],
      ["tarifa", "-1", "Debe ser mayor o igual que 0."],
      ["importe", "100000000000000", "Admite como máximo 14 dígitos en total."],
      ["importe", "1234567890123.45", "Admite como máximo 14 dígitos en total."],
      ["importe", "1.005", "Admite como máximo 2 decimales."],
      ["precioUnitario", "1234567890123.123456", "Admite como máximo 18 dígitos en total."],
      ["precioUnitario", "1.0000001", "Admite como máximo 6 decimales."],
      ["cantidad", "1000000000000000000", "Admite como máximo 18 dígitos en total."],
      ["cantidad", "-0.5", "Debe ser mayor o igual que 0."],
    ] as const) {
      expect(message(name, text), `${name} ${text}`).toBe(expected);
    }
  });

  it("los decimales y el total se cuentan como se escriben", () => {
    expect(message("tarifa", "15.000")).toBe("Admite como máximo 2 decimales.");
    expect(message("tarifa", "100.50")).toBe("Admite como máximo 4 dígitos en total.");
    expect(message("importe", "0.50")).toBeUndefined();
  });
});
