// Revisión de los catálogos de retención y de sustento (add-withholding-receipts, design D6 a D11):
// cada dataset contra su extracto versionado en docs/product/sri-catalogs/fuentes/. La clasificación
// se reproduce desde los valores RAW con las reglas de design D7 y D10; ninguna cantidad soportada
// está fijada aquí.
import { readFileSync } from "node:fs";
import { canonicalDecimal } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { validateDatasets } from "../../src/modules/catalogs/domain/datasets.ts";

const FUENTES = new URL("../../../docs/product/sri-catalogs/fuentes/", import.meta.url);
const ATS = readFileSync(new URL("catalogo-ats-2026-08-06.txt", FUENTES), "utf8");
const FICHA = readFileSync(new URL("ficha-v2.34-tablas-19-20.txt", FUENTES), "utf8");
const ATS_SHA256 = "bd3f7834f2cd31187af39cd2f4c685a646d7e49316e92ee493da5f2dd9776e3e";
const FICHA_SHA256 = "7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9";

type Section = { comments: string[]; rows: string[][] };
const sections = new Map<string, Section>();
{
  let current: Section | null = null;
  for (const line of ATS.split("\n")) {
    if (line.startsWith("## ")) {
      current = { comments: [], rows: [] };
      sections.set(line.slice(3), current);
    } else if (current && line.startsWith("#")) current.comments.push(line);
    else if (current && line !== "") current.rows.push(line.split("\t"));
  }
}
const section = (name: string) => sections.get(name)!;
/** Columnas de una sección, por el encabezado `# fila\t...` del extracto. */
const records = (name: string) => {
  const { comments, rows } = section(name);
  const header = comments
    .find((line) => line.startsWith("# fila\t"))!
    .slice(2)
    .split("\t");
  return rows.map((row) => Object.fromEntries(header.map((column, i) => [column, row[i]!])));
};
/** Cantidades que el extracto declara en su línea `# Salida:`. */
const declaredOutput = (name: string) =>
  Object.fromEntries(
    section(name)
      .comments.find((line) => line.startsWith("# Salida: "))!
      .slice("# Salida: ".length, -1)
      .split("; ")
      .map((part) => {
        const [classification, count] = part.split(" ");
        return [classification!, Number(count)];
      }),
  );
const declaredInput = (name: string) =>
  Number(
    /^# Entrada: (\d+) filas/.exec(
      section(name).comments.find((l) => l.startsWith("# Entrada: "))!,
    )![1],
  );

/** Valor RAW del extracto: un texto entre comillas (JSON) o un número como lo guarda la hoja. */
const rawText = (raw: string) => JSON.parse(raw) as string;
const rawNumber = (raw: string) => {
  if (!/^[0-9]+\.[0-9]+$/.test(raw)) throw new Error(`no es un número de la hoja: ${raw}`);
  return raw;
};
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const tally = (values: string[]) =>
  values.reduce<Record<string, number>>(
    (acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }),
    {},
  );

type Entry = Record<string, unknown> & { entryKey: string; code: string };
const datasets = validateDatasets(DATASET_FILES);
const dataset = (type: string) => datasets.find((file) => file.catalogType === type)!;
const entries = (type: string) => (dataset(type) as unknown as { entries: Entry[] }).entries;

describe("procedencia de los extractos", () => {
  it("el extracto del Catálogo ATS cita su URL, su fecha, su SHA-256 y su método", () => {
    expect(ATS).toContain(
      "https://www.sri.gob.ec/o/sri-portlet-biblioteca-alfresco-internet/descargar/e6a826af-b22c-40bb-8752-d711f293b8f9/Catalogo_ATS.xls",
    );
    expect(ATS).toContain("fecha actualización: 06 de agosto de 2026");
    expect(ATS).toContain(`# SHA-256 del archivo: ${ATS_SHA256}`);
    expect(ATS).toContain("# ---- extraer.py ----");
    expect([...sections.keys()]).toEqual([
      "TABLA 3.10",
      "TABLA 4",
      "TABLA 5",
      "TABLA 11",
      "TABLA 13",
    ]);
  });

  it("el extracto de la ficha cita su SHA-256 y su método", () => {
    expect(FICHA).toContain(`# SHA-256 del PDF: ${FICHA_SHA256}`);
    expect(FICHA).toContain("pdftotext -layout");
  });

  it("los datasets del ATS citan el catálogo; los de las tablas 19 y 20, la ficha", () => {
    for (const type of ["withholding-income-concept", "support-document-type", "support-code"]) {
      expect(dataset(type).source).toMatchObject({ sha256: ATS_SHA256, publishedOn: "2026-08-06" });
    }
    for (const type of ["withholding-tax", "withholding-iva-code"]) {
      expect(dataset(type).source).toMatchObject({ sha256: FICHA_SHA256, version: "2.34" });
    }
  });
});

describe("tabla 3.10: conceptos de retención de la renta (design D7)", () => {
  const rows = records("TABLA 3.10");
  const concepts = entries("withholding-income-concept");
  // Estructuras especiales: las declara el extracto con su razón; son exclusiones, no soportados.
  const special = new Map(
    section("TABLA 3.10").comments.flatMap((line) => {
      const match = /^#\s{6}([0-9A-Z]+): (.+)\.$/.exec(line);
      return match ? [[match[1]!, match[2]!] as const] : [];
    }),
  );

  /** Reglas de design D7 sobre los valores RAW, en su orden. */
  let module = "";
  const derived = rows.map((row) => {
    if (row["módulo RAW"] !== "-") module = rawText(row["módulo RAW"]!);
    const nonResident = module.includes("NO RESIDENTE");
    const code =
      row["tipo celda código"] === "NUMBER"
        ? String(Number(rawNumber(row["código RAW"]!)))
        : rawText(row["código RAW"]!).trim();
    const numeric = row["tipo celda porcentaje"] === "NUMBER";
    const classification = nonResident
      ? "OUT_OF_SCOPE_NON_RESIDENT"
      : !numeric
        ? "OUT_OF_SCOPE_VARIABLE"
        : special.has(code)
          ? "OUT_OF_SCOPE_SPECIAL_STRUCTURE"
          : code.includes(" ")
            ? "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION"
            : "SUPPORTED_FIXED_RESIDENT";
    return {
      row: row.fila!,
      module: nonResident ? "NON_RESIDENT" : "RESIDENT",
      code,
      entryKey: code.replace(" ", "-"),
      percentage: numeric ? canonicalDecimal(rawNumber(row["porcentaje RAW"]!)) : null,
      rateText: numeric ? null : normalize(rawText(row["porcentaje RAW"]!)),
      classification,
      label: row["denominación"]!,
    };
  });

  it("el bloque vigente tiene las filas que el extracto declara, y el dataset una entrada por fila", () => {
    expect(rows).toHaveLength(declaredInput("TABLA 3.10"));
    expect(concepts).toHaveLength(rows.length);
    expect(section("TABLA 3.10").comments).toContain(
      '# Hoja "TABLAS RETENCIONES", celdas B1 a E2: "Tabla 3.10: CONCEPTOS DE RETENCIÓN EN LA FUENTE DE IMPUESTO A LA RENTA (AIR)" / "DESDE 06/AGOSTO/2026".',
    );
  });

  it("las estructuras especiales son códigos de la fuente cuya denominación las nombra", () => {
    for (const [code, reason] of special) {
      const row = derived.find((concept) => concept.code === code);
      expect(row, code).toBeDefined();
      const theme = reason.startsWith("dividendos")
        ? /dividendo/i
        : reason.startsWith("banano")
          ? /banano/i
          : /exterior/i;
      expect(row!.label, code).toMatch(theme);
    }
  });

  it("reproduce la clasificación de cada fila desde los valores RAW y coincide con el dataset", () => {
    expect(rows.map((row) => row["clasificación"])).toEqual(derived.map((d) => d.classification));
    expect(
      concepts.map((entry) => ({
        row: /fila (\d+)$/.exec(String(entry.sourceRef))![1],
        module: entry.module,
        code: entry.code,
        entryKey: entry.entryKey,
        percentage: entry.percentage,
        rateText: entry.rateText,
        classification: entry.scopeClassification,
        label: entry.officialLabel,
      })),
    ).toEqual(derived);
  });

  it("las cantidades por clasificación salen de las reglas y coinciden con las del extracto", () => {
    const counts = tally(derived.map((d) => d.classification));
    expect(counts).toEqual(declaredOutput("TABLA 3.10"));
    expect(tally(concepts.map((entry) => String(entry.scopeClassification)))).toEqual(counts);
    const supported = concepts.filter((e) => e.scopeClassification === "SUPPORTED_FIXED_RESIDENT");
    expect(supported).toHaveLength(
      rows.length -
        counts.OUT_OF_SCOPE_NON_RESIDENT! -
        counts.OUT_OF_SCOPE_VARIABLE! -
        counts.OUT_OF_SCOPE_SPECIAL_STRUCTURE! -
        counts.OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION!,
    );
  });

  it("los soportados son de residentes, con porcentaje numérico y código sin espacios", () => {
    for (const entry of concepts.filter(
      (e) => e.scopeClassification === "SUPPORTED_FIXED_RESIDENT",
    )) {
      expect(entry.module).toBe("RESIDENT");
      expect(entry.percentage).toMatch(/^[0-9]+(\.[0-9]{1,2})?$/);
      expect(entry.rateText).toBeNull();
      expect(entry.code).toMatch(/^[0-9]{3,4}([A-Z][0-9]?)?$/);
      expect(entry.code.length).toBeLessThanOrEqual(5);
    }
    expect(concepts.find((entry) => entry.code === "312C")).toMatchObject({
      percentage: "1.75",
      scopeClassification: "SUPPORTED_FIXED_RESIDENT",
    });
  });

  it("los códigos con un espacio conservan el código RAW y quedan pendientes de evidencia", () => {
    const ambiguous = rows.filter(
      (row) =>
        row["tipo celda código"] === "TEXT" && rawText(row["código RAW"]!).trim().includes(" "),
    );
    expect(ambiguous.map((row) => row["código RAW"])).toEqual([
      '"323 M"',
      '"323 N"',
      '"323 O"',
      '"323 P"',
    ]);
    for (const row of ambiguous) {
      const code = rawText(row["código RAW"]!);
      expect(concepts.find((entry) => entry.code === code)).toMatchObject({
        entryKey: code.replace(" ", "-"),
        scopeClassification: "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION",
      });
    }
  });

  it("los números de la hoja pierden el decimal y los textos variables se conservan literales", () => {
    expect(rows.find((row) => row["código RAW"] === "303.0")?.["código"]).toBe("303");
    expect(concepts.find((entry) => entry.code === "346")).toMatchObject({
      percentage: null,
      rateText: "varios porcentajes",
      scopeClassification: "OUT_OF_SCOPE_VARIABLE",
    });
  });

  it("todas las entradas rigen desde el bloque declarado, sin historia anterior", () => {
    for (const entry of concepts) {
      expect(entry).toMatchObject({
        effectiveFrom: "2026-08-06",
        effectiveFromBasis: "SOURCE_STATED",
        effectiveTo: null,
        normativeStatus: "OFFICIAL",
      });
    }
  });
});

describe("tabla 4: tipos de documento sustento (design D10)", () => {
  const rows = records("TABLA 4");
  const types = entries("support-document-type");

  it("una entrada por fila, con el código de dos caracteres, sus sustentos y su clasificación", () => {
    expect(rows).toHaveLength(declaredInput("TABLA 4"));
    expect(types).toHaveLength(rows.length);
    const derived = rows.map((row) => {
      const code = String(Number(rawNumber(row["código RAW"]!))).padStart(2, "0");
      const supports = rawText(row["sustento RAW"]!).trim();
      return {
        code,
        allowedSupportCodes:
          supports === "ninguno"
            ? []
            : supports
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean),
        scopeClassification: ["01", "02", "03"].includes(code) ? "SUPPORTED" : "OUT_OF_SCOPE_MVP",
        officialLabel: row["denominación"],
      };
    });
    expect(
      types.map(({ code, allowedSupportCodes, scopeClassification, officialLabel }) => ({
        code,
        allowedSupportCodes,
        scopeClassification,
        officialLabel,
      })),
    ).toEqual(derived);
    expect(tally(derived.map((d) => d.scopeClassification))).toEqual(declaredOutput("TABLA 4"));
  });

  it("los tipos del MVP son los textos 01, 02 y 03, que la hoja guarda como números", () => {
    const supported = types.filter((entry) => entry.scopeClassification === "SUPPORTED");
    expect(supported.map((entry) => entry.code)).toEqual(["01", "02", "03"]);
    for (const entry of supported) {
      expect(typeof entry.code).toBe("string");
      expect(entry.code).toHaveLength(2);
      expect(entry.entryKey).toBe(entry.code);
    }
    expect(rows.slice(0, 3).map((row) => row["código RAW"])).toEqual(["1.0", "2.0", "3.0"]);
  });

  it("la vigencia de 364 y 375 sale de sus notas; las demás no la declaran", () => {
    const notes = section("TABLA 4").comments.filter((line) => line.startsWith("# Nota"));
    expect(notes.some((line) => line.includes("Código 364 vigente desde 01/04/2017"))).toBe(true);
    expect(
      notes.some((line) =>
        line.includes("Código 375 vigente desde 01/12/2020 hasta el 31/12/2021"),
      ),
    ).toBe(true);
    for (const entry of types) {
      if (entry.code === "364") {
        expect(entry).toMatchObject({
          effectiveFrom: "2017-04-01",
          effectiveFromBasis: "SOURCE_STATED",
          effectiveTo: null,
        });
      } else if (entry.code === "375") {
        expect(entry).toMatchObject({
          effectiveFrom: "2020-12-01",
          effectiveFromBasis: "SOURCE_STATED",
          effectiveTo: "2021-12-31",
        });
      } else {
        expect(entry).toMatchObject({
          effectiveFrom: "2026-08-06",
          effectiveFromBasis: "PROJECT_BASELINE",
          effectiveTo: null,
        });
      }
    }
  });
});

describe("tabla 5: códigos de sustento (design D10)", () => {
  const rows = records("TABLA 5");
  const codes = entries("support-code");
  const SUPPORT_CLASSES: Record<string, string> = {
    "08": "OUT_OF_SCOPE_SPECIAL_STRUCTURE",
    "09": "OUT_OF_SCOPE_SPECIAL_STRUCTURE",
    "10": "OUT_OF_SCOPE_SPECIAL_STRUCTURE",
    "11": "OUT_OF_SCOPE_MVP",
    "12": "OUT_OF_SCOPE_MVP",
    "13": "OUT_OF_SCOPE_MVP",
    "00": "OUT_OF_SCOPE_EXPIRED",
  };

  it("una entrada por fila, con sus fechas declaradas y su clasificación", () => {
    expect(rows).toHaveLength(declaredInput("TABLA 5"));
    const derived = rows.map((row) => {
      const code =
        row["tipo celda código"] === "NUMBER"
          ? String(Number(rawNumber(row["código RAW"]!))).padStart(2, "0")
          : rawText(row["código RAW"]!);
      return {
        code,
        effectiveFrom: row.inicio,
        effectiveTo: row.fin === "-" ? null : row.fin,
        effectiveFromBasis: "SOURCE_STATED",
        scopeClassification: SUPPORT_CLASSES[code] ?? "SUPPORTED",
        officialLabel: row["denominación"],
      };
    });
    expect(
      codes.map(
        ({
          code,
          effectiveFrom,
          effectiveTo,
          effectiveFromBasis,
          scopeClassification,
          officialLabel,
        }) => ({
          code,
          effectiveFrom,
          effectiveTo,
          effectiveFromBasis,
          scopeClassification,
          officialLabel,
        }),
      ),
    ).toEqual(derived);
    expect(tally(derived.map((d) => d.scopeClassification))).toEqual(declaredOutput("TABLA 5"));
  });

  it("el sustento 00 cerró el 28/02/2015", () => {
    expect(codes.find((entry) => entry.code === "00")).toMatchObject({
      effectiveTo: "2015-02-28",
      scopeClassification: "OUT_OF_SCOPE_EXPIRED",
    });
  });

  it("la tabla 4 y la tabla 5 asignan los mismos sustentos a cada tipo del MVP", () => {
    const types = entries("support-document-type");
    for (const type of ["01", "02", "03"]) {
      const fromTable5 = rows
        .filter((row) => {
          const raw = row["tipos de comprobante RAW"]!;
          const list = raw.startsWith('"') ? rawText(raw) : String(Number(raw));
          return list
            .split(",")
            .map((part) => Number(part.trim()))
            .includes(Number(type));
        })
        .map((row) => row["código"]);
      const fromTable4 = types.find((entry) => entry.code === type)!
        .allowedSupportCodes as string[];
      expect([...fromTable4].sort(), type).toEqual([...fromTable5].sort());
    }
    const saleNote = types.find((entry) => entry.code === "02")!.allowedSupportCodes as string[];
    expect(saleNote).not.toContain("01");
    expect(saleNote).toEqual(["02", "04", "05", "07", "08", "14", "15", "00"]);
  });
});

describe("tablas 19 y 20 de la ficha v2.34 (design D8 y D9)", () => {
  const lines = FICHA.split("\n").filter((line) => !line.startsWith("#"));
  const table19 = lines
    .slice(lines.findIndex((line) => line.startsWith("TABLA 19")))
    .flatMap((line) => {
      const match = /^\s+(RENTA|IVA|ISD)\s+(\d)$/.exec(line);
      return match ? [match[1]!, match[2]!] : [];
    });
  const ivaBlock = lines.slice(
    lines.findIndex((line) => line.startsWith("RETENCIÓN DEL IVA")),
    lines.findIndex((line) => line.startsWith("RETENCIÓN DEL ISD")),
  );
  const ivaRows = ivaBlock.flatMap((line) => {
    const match = /^\s+([0-9.]+)%\s+(\d+)$/.exec(line);
    return match ? [{ percentage: canonicalDecimal(match[1]!), code: match[2]! }] : [];
  });

  it("los impuestos a retener coinciden con la tabla 19; el ISD queda pendiente de evidencia", () => {
    expect(table19).toEqual(["RENTA", "1", "IVA", "2", "ISD", "6"]);
    expect(
      entries("withholding-tax").map((e) => [e.officialLabel, e.code, e.scopeClassification]),
    ).toEqual([
      ["RENTA", "1", "SUPPORTED"],
      ["IVA", "2", "SUPPORTED"],
      ["ISD", "6", "OUT_OF_SCOPE_PENDING_EVIDENCE"],
    ]);
  });

  it("los códigos del IVA coinciden con la tabla 20 en su orden, con el 7 y el 8", () => {
    const iva = entries("withholding-iva-code");
    expect(iva.map((e) => ({ code: e.code, percentage: e.percentage }))).toEqual(ivaRows);
    expect(iva.map((e) => e.code)).toEqual(["9", "10", "1", "11", "2", "3", "7", "8"]);
  });

  it("el código 7 es una retención en cero soportada, con su nota; el 8 se conserva fuera de alcance", () => {
    const iva = entries("withholding-iva-code");
    expect(FICHA).toContain("Retención en cero:");
    expect(FICHA).toContain("No procede retención:");
    expect(iva.find((e) => e.code === "7")).toMatchObject({
      officialLabel: "Retención en cero 0.00%",
      percentage: "0",
      scopeClassification: "SUPPORTED_FIXED",
    });
    expect(String(iva.find((e) => e.code === "7")!.sourceRef)).toContain(
      "Disposición Transitoria Única de la Resolución NAC-DGERCGC15-00000284",
    );
    expect(iva.find((e) => e.code === "8")).toMatchObject({
      officialLabel: "No procede retención 0.00%",
      percentage: "0",
      scopeClassification: "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION",
    });
    expect(
      iva.filter((e) => e.scopeClassification === "SUPPORTED_FIXED").map((e) => e.code),
    ).not.toContain("8");
  });

  it("el ISD de la tabla 20 no se transcribe", () => {
    const codes = entries("withholding-iva-code").map((e) => e.code);
    expect(FICHA).toContain("4580");
    expect(codes).not.toContain("4580");
    expect(codes).not.toContain("4586");
  });

  it("la tabla 11 del ATS publica los mismos porcentajes, sin los códigos 7 ni 8", () => {
    const table11 = records("TABLA 11").map((row) => ({
      code: row["código"],
      percentage: row.porcentaje,
    }));
    expect(table11).toEqual(ivaRows.filter((row) => row.code !== "7" && row.code !== "8"));
  });
});

describe("equivalencia de la tabla 13 del ATS con payment-method (design D6)", () => {
  const ats = records("TABLA 13").map((row) => ({
    code: row["código"]!,
    label: row["denominación"]!,
    effectiveFrom: row.inicio!,
    effectiveTo: row.fin === "-" ? null : row.fin!,
  }));
  const ficha = entries("payment-method").map((entry) => ({
    code: entry.code,
    label: String(entry.officialLabel),
    effectiveFrom: String(entry.effectiveFrom),
    effectiveTo: entry.effectiveTo as string | null,
  }));
  /** Denominación normalizada: sin tildes, en mayúsculas y con un espacio entre palabras. */
  const label = (text: string) =>
    normalize(text.normalize("NFD").replace(/\p{Diacritic}/gu, "")).toUpperCase();
  const active = (rows: typeof ats, date: string) =>
    rows
      .filter(
        (row) => row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date),
      )
      .map((row) => `${row.code} ${label(row.label)}`)
      .sort();

  it("desde el 01/09/2016 los dos catálogos tienen los mismos códigos vigentes y denominaciones", () => {
    const boundaries = [...ats, ...ficha]
      .flatMap((row) => [row.effectiveFrom, row.effectiveTo ?? ""])
      .filter((date) => date >= "2016-09-01");
    for (const date of ["2016-09-01", ...boundaries, "2026-08-06", "2026-10-06", "2099-12-31"]) {
      expect(active(ats, date), date).toEqual(active(ficha, date));
    }
    expect(active(ficha, "2026-10-06").map((row) => row.slice(0, 2))).toEqual([
      "01",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
      "21",
    ]);
  });

  it("las diferencias son históricas, como documenta design D6", () => {
    const closed = ats.filter((row) => row.effectiveTo === "2016-08-31").map((row) => row.code);
    expect(closed).toEqual([
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
    ]);
    for (const code of ["16", "17", "18"]) {
      expect(ats.find((row) => row.code === code)?.effectiveFrom).toBe("2016-05-01");
      expect(ficha.find((row) => row.code === code)?.effectiveFrom).toBe("2016-06-01");
    }
    expect(ats.find((row) => row.code === "20")?.label).toBe(
      "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
    );
    expect(ficha.find((row) => row.code === "20")?.label).toBe(
      "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
    );
  });
});
