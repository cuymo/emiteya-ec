// Contratos de los reportes (add-reports-export, tarea 2.1, design D3, D4 y D12).
import { describe, expect, it } from "vitest";
import {
  REPORT_CONTRACTS,
  REPORT_DEFAULT_STATES,
  REPORT_ERROR_CODES,
  REPORT_IDS,
  REPORT_LABELS,
  invoicesQueries,
  issuedDocumentRowSchema,
  issuedDocumentsQueries,
  partiesQueries,
  withholdingsQueries,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("reportes", () => {
  it("son exactamente cinco, con el inventario en dos vistas", () => {
    expect(REPORT_IDS).toEqual([
      "issued-documents",
      "invoices",
      "withholdings",
      "inventory-balances",
      "inventory-movements",
      "parties",
    ]);
    expect(Object.values(REPORT_LABELS)).toEqual([
      "Documentos emitidos",
      "Facturas",
      "Retenciones",
      "Existencias",
      "Movimientos",
      "Terceros",
    ]);
    expect(REPORT_ERROR_CODES).toEqual(["REPORT_EXPORT_ROW_LIMIT", "REPORT_EXPORT_BUSY"]);
  });
});

describe("valores por defecto", () => {
  it("aplica todos los estados en Documentos emitidos y los autorizados en Facturas y Retenciones", () => {
    expect(REPORT_DEFAULT_STATES).toEqual({
      "issued-documents": "ALL",
      invoices: "AUTHORIZED",
      withholdings: "AUTHORIZED",
    });
    for (const kind of ["list", "export"] as const) {
      expect(issuedDocumentsQueries[kind].parse({}).state).toBe("ALL");
      expect(invoicesQueries[kind].parse({}).state).toBe("AUTHORIZED");
      expect(withholdingsQueries[kind].parse({}).state).toBe("AUTHORIZED");
      expect(partiesQueries[kind].parse({}).status).toBe("ACTIVE");
    }
    expect(invoicesQueries.list.parse({ state: "ALL" }).state).toBe("ALL");
    expect(invoicesQueries.list.parse({ state: "NOT_AUTHORIZED" }).state).toBe("NOT_AUTHORIZED");
  });

  it("deja el ambiente sin valor para que lo resuelva el servidor, y admite los dos solo explícitos", () => {
    expect(issuedDocumentsQueries.list.parse({}).environment).toBeUndefined();
    for (const environment of ["TEST", "PRODUCTION", "ALL"]) {
      expect(invoicesQueries.export.parse({ environment }).environment).toBe(environment);
    }
    expect(messages(invoicesQueries.list.safeParse({ environment: "BOTH" }))).toContain(
      "El ambiente no es válido.",
    );
  });

  it("pagina la lista con los valores comunes y no la exportación", () => {
    expect(issuedDocumentsQueries.list.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(issuedDocumentsQueries.list.parse({ page: "3", pageSize: "100" })).toMatchObject({
      page: 3,
      pageSize: 100,
    });
    expect(issuedDocumentsQueries.export.safeParse({ page: "1" }).success).toBe(false);
  });
});

describe("validación", () => {
  it("rechaza un rango con la fecha final anterior a la inicial, en la lista y en la exportación", () => {
    for (const kind of ["list", "export"] as const) {
      const result = REPORT_CONTRACTS["inventory-movements"].queries[kind].safeParse({
        from: "2026-09-30",
        to: "2026-09-01",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({
        path: ["to"],
        message: "La fecha final no puede ser anterior a la inicial.",
      });
    }
    expect(
      issuedDocumentsQueries.list.parse({ from: "2026-09-01", to: "2026-09-30" }),
    ).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("rechaza el filtro de otro reporte", () => {
    expect(messages(partiesQueries.list.safeParse({ state: "AUTHORIZED" }))).toContain(
      "La consulta contiene filtros que este reporte no tiene.",
    );
    expect(invoicesQueries.list.safeParse({ documentType: "04" }).success).toBe(false);
    expect(
      REPORT_CONTRACTS["inventory-balances"].queries.list.safeParse({ from: "2026-09-01" }).success,
    ).toBe(false);
  });

  it("rechaza un companyId en cada reporte, en la lista y en la exportación", () => {
    for (const report of REPORT_IDS) {
      for (const kind of ["list", "export"] as const) {
        const result = REPORT_CONTRACTS[report].queries[kind].safeParse({ companyId: "otra" });
        expect(result.success, `${report} ${kind}`).toBe(false);
      }
    }
  });

  it("valida el período fiscal AAAA-MM y las identificaciones", () => {
    expect(withholdingsQueries.list.parse({ fiscalPeriod: "2026-09" }).fiscalPeriod).toBe(
      "2026-09",
    );
    for (const fiscalPeriod of ["09/2026", "2026-13", "2026-9"]) {
      expect(messages(withholdingsQueries.list.safeParse({ fiscalPeriod }))).toContain(
        "El período fiscal debe tener la forma AAAA-MM.",
      );
    }
    expect(invoicesQueries.list.parse({ customerIdentification: " 0102030405 " })).toMatchObject({
      customerIdentification: "0102030405",
    });
    expect(invoicesQueries.list.safeParse({ customerIdentification: "01-02" }).success).toBe(false);
  });
});

describe("filas de Documentos emitidos", () => {
  const row = {
    id: "d",
    issueDate: "2026-09-30",
    documentType: "01",
    number: "001-001-000000001",
    counterpart: { identification: "0102030405", name: "Cliente" },
    recipientCount: null,
    subtotal: "100.00",
    taxes: "15.00",
    total: "115.00",
    state: "AUTHORIZED",
    environment: "PRODUCTION",
  };

  it("exige importes por tipo: la guía sin ninguno y la retención con solo su total", () => {
    expect(issuedDocumentRowSchema.safeParse(row).success).toBe(true);
    const guide = { ...row, documentType: "06", subtotal: null, taxes: null, total: null };
    expect(issuedDocumentRowSchema.safeParse({ ...guide, recipientCount: 1 }).success).toBe(true);
    expect(
      issuedDocumentRowSchema.safeParse({ ...guide, recipientCount: 3, counterpart: null }).success,
    ).toBe(true);
    expect(issuedDocumentRowSchema.safeParse({ ...guide, recipientCount: 3 }).success).toBe(false);
    expect(
      issuedDocumentRowSchema.safeParse({ ...guide, total: "0.00", recipientCount: 1 }).success,
    ).toBe(false);
    const withholding = { ...row, documentType: "07", subtotal: null, taxes: null, total: "30.00" };
    expect(issuedDocumentRowSchema.safeParse(withholding).success).toBe(true);
    expect(issuedDocumentRowSchema.safeParse({ ...withholding, subtotal: "1.00" }).success).toBe(
      false,
    );
    expect(issuedDocumentRowSchema.safeParse({ ...row, total: null }).success).toBe(false);
  });
});
