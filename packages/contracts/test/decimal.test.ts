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

describe("tipos no negativos con su especificación", () => {
  const tarifa = decimalString(DECIMAL_SPECS.tarifa);
  const importe = decimalString(DECIMAL_SPECS.importe);
  const precio = decimalString(DECIMAL_SPECS.precioUnitario);

  it("aceptan valores dentro de sus dígitos, su escala y su rango", () => {
    expect(tarifa.safeParse("15").success).toBe(true);
    expect(tarifa.safeParse("99.99").success).toBe(true);
    expect(importe.safeParse("50.00").success).toBe(true);
    expect(importe.safeParse("999999999999.99").success).toBe(true);
    expect(precio.safeParse("123456789012.123456").success).toBe(true);
  });

  it("rechazan negativos, escala de más sin redondear y dígitos de más", () => {
    expect(tarifa.safeParse("-1").error?.issues[0]?.message).toBe("Debe ser mayor o igual que 0.");
    expect(tarifa.safeParse("12.345").error?.issues[0]?.message).toBe(
      "Admite como máximo 2 decimales.",
    );
    expect(tarifa.safeParse("100.5").error?.issues[0]?.message).toBe(
      "Admite como máximo 2 dígitos enteros.",
    );
    expect(importe.safeParse("1000000000000").success).toBe(false);
    expect(precio.safeParse("1.0000001").error?.issues[0]?.message).toBe(
      "Admite como máximo 6 decimales.",
    );
  });
});
