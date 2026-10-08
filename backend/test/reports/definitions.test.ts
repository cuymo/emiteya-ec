// Dominio de los reportes (add-reports-export, tarea 4.1, design D2, D3, D4, D6 y D13): la definición
// de cada reporte, sus valores por defecto, la misma definición para la lista y la exportación, las
// celdas de cada columna, el nombre del archivo, la hoja "Filtros" y los datos de la auditoría.
import { describe, expect, it } from "vitest";
import {
  REPORT_CONTRACTS,
  REPORT_IDS,
  type IssuedDocumentRow,
  type PartyRow,
} from "@facturador/contracts";
import { REPORT_DEFINITIONS } from "../../src/modules/reports/domain/definitions.ts";
import {
  exportAuditChanges,
  exportFileName,
  filterSheetRows,
} from "../../src/modules/reports/domain/export.ts";

const MOMENT = new Date("2026-10-08T15:30:05.000Z");

describe("definiciones de los reportes", () => {
  it("hay una por reporte, con columnas únicas y ambiente solo en los de comprobantes", () => {
    expect(Object.keys(REPORT_DEFINITIONS)).toEqual([...REPORT_IDS]);
    for (const id of REPORT_IDS) {
      const definition = REPORT_DEFINITIONS[id];
      expect(definition.id).toBe(id);
      const headers = definition.columns.map((column) => column.header);
      expect(new Set(headers).size, id).toBe(headers.length);
      expect(definition.fileSlug).toMatch(/^[a-z-]+$/);
    }
    expect(REPORT_IDS.filter((id) => REPORT_DEFINITIONS[id].hasEnvironment)).toEqual([
      "issued-documents",
      "invoices",
      "withholdings",
    ]);
  });

  it("la lista y la exportación aplican los mismos filtros con los mismos valores por defecto", () => {
    for (const id of REPORT_IDS) {
      const { list, export: exported } = REPORT_CONTRACTS[id].queries;
      const listKeys = Object.keys(list.shape).filter(
        (key) => key !== "page" && key !== "pageSize",
      );
      expect(Object.keys(exported.shape), id).toEqual(listKeys);
      const {
        page: _page,
        pageSize: _size,
        ...listDefaults
      } = list.parse({}) as Record<string, unknown>;
      expect(exported.parse({}), id).toEqual(listDefaults);
    }
    expect(REPORT_CONTRACTS["issued-documents"].queries.export.parse({})).toEqual({ state: "ALL" });
    expect(REPORT_CONTRACTS.invoices.queries.export.parse({})).toEqual({ state: "AUTHORIZED" });
    expect(REPORT_CONTRACTS.withholdings.queries.export.parse({})).toEqual({ state: "AUTHORIZED" });
    expect(REPORT_CONTRACTS.parties.queries.export.parse({})).toEqual({ status: "ACTIVE" });
    expect(REPORT_CONTRACTS["inventory-movements"].queries.export.parse({})).toEqual({});
  });

  it("convierte cada fila en celdas del tipo de su columna, sin inventar importes", () => {
    const columns = REPORT_DEFINITIONS["issued-documents"].columns;
    const guide: IssuedDocumentRow = {
      id: "g",
      issueDate: "2026-09-30",
      documentType: "06",
      number: "001-001-000000007",
      counterpart: null,
      recipientCount: 3,
      subtotal: null,
      taxes: null,
      total: null,
      state: "AUTHORIZED",
      environment: "PRODUCTION",
    };
    expect(columns.map((column) => [column.header, column.kind, column.value(guide)])).toEqual([
      ["Fecha", "date", "2026-09-30"],
      ["Tipo", "text", "Guía de remisión"],
      ["Número", "text", "001-001-000000007"],
      ["Identificación", "text", null],
      ["Tercero", "text", "3 destinatarios"],
      ["Subtotal", "money", null],
      ["Impuestos", "money", null],
      ["Total", "money", null],
      ["Estado", "text", "Autorizado"],
      ["Ambiente", "text", "Producción"],
    ]);
    const party: PartyRow = {
      id: "p",
      identification: "0102030405",
      legalName: '=HYPERLINK("http://ejemplo.invalid")',
      email: null,
      phone: null,
      roles: ["CUSTOMER", "SUPPLIER"],
      status: "ACTIVE",
    };
    expect(REPORT_DEFINITIONS.parties.columns.map((column) => column.value(party))).toEqual([
      "0102030405",
      '=HYPERLINK("http://ejemplo.invalid")',
      null,
      null,
      "Cliente, Proveedor",
      "Activo",
    ]);
    const movement = REPORT_DEFINITIONS["inventory-movements"].columns[0]!;
    expect(movement.kind).toBe("dateTime");
    expect(
      movement.value({
        id: "m",
        occurredAt: "2026-09-01T04:59:59.999Z",
        productId: "x",
        code: "",
        name: "",
        movementType: "AJUSTE",
        quantity: "1",
        balanceAfter: "1",
        documentNumber: null,
      }),
    ).toEqual(new Date("2026-09-01T04:59:59.999Z"));
  });
});

describe("lo que acompaña al XLSX", () => {
  it("nombra el archivo en ASCII con el rango o con la fecha de Ecuador, sin datos personales", () => {
    const invoices = REPORT_DEFINITIONS.invoices;
    expect(
      exportFileName(
        invoices,
        { from: "2026-09-01", to: "2026-09-30", customerIdentification: "0102030405" },
        MOMENT,
      ),
    ).toBe("facturas-2026-09-01-2026-09-30.xlsx");
    // 00:30 UTC del 9 de octubre es todavía el 8 en Ecuador.
    expect(
      exportFileName(
        REPORT_DEFINITIONS.parties,
        { status: "ACTIVE" },
        new Date("2026-10-09T00:30:00Z"),
      ),
    ).toBe("terceros-2026-10-08.xlsx");
  });

  it("muestra en Filtros el reporte, el momento en Ecuador, los filtros efectivos y los avisos", () => {
    const rows = filterSheetRows(
      REPORT_DEFINITIONS["issued-documents"],
      {
        from: "2026-09-01",
        to: "2026-09-30",
        documentType: "04",
        state: "ALL",
        establishmentId: "est-1",
        environment: "ALL",
      },
      { establishment: "002" },
      MOMENT,
      42,
    );
    expect(rows).toEqual([
      ["Reporte", "Documentos emitidos"],
      ["Generado", "08/10/2026 10:30:05 (hora de Ecuador)"],
      ["Desde", "01/09/2026"],
      ["Hasta", "30/09/2026"],
      ["Tipo de comprobante", "Nota de crédito"],
      ["Estado", "Todos"],
      ["Establecimiento", "002"],
      ["Ambiente", "Pruebas y Producción"],
      ["Filas", "42"],
      ["Aviso", "Los reportes no reemplazan obligaciones contables ni anexos tributarios."],
      [
        "Precisión",
        "Los importes y las cantidades con más de 15 dígitos significativos van como texto exacto.",
      ],
    ]);
    const withholdings = filterSheetRows(
      REPORT_DEFINITIONS.withholdings,
      {
        fiscalPeriod: "2026-09",
        state: "AUTHORIZED",
        environment: "TEST",
        supplierIdentification: "1791234567001",
      },
      {},
      MOMENT,
      0,
    );
    expect(withholdings).toContainEqual(["Período fiscal", "09/2026"]);
    expect(withholdings).toContainEqual(["Estado", "Autorizado"]);
    expect(withholdings).toContainEqual(["Identificación del sujeto retenido", "1791234567001"]);
  });

  it("audita los filtros sin datos personales y solo la presencia de los que los tienen", () => {
    expect(
      exportAuditChanges("invoices", 120, {
        from: "2026-09-01",
        to: "2026-09-30",
        state: "AUTHORIZED",
        environment: "PRODUCTION",
        customerIdentification: "0102030405",
      }),
    ).toEqual({
      report: "invoices",
      rows: 120,
      from: "2026-09-01",
      to: "2026-09-30",
      state: "AUTHORIZED",
      environment: "PRODUCTION",
      customerIdentificationPresent: true,
    });
    const parties = exportAuditChanges("parties", 3, {
      identification: "0102030405",
      role: "SUPPLIER",
      status: "ACTIVE",
    });
    expect(parties).toEqual({
      report: "parties",
      rows: 3,
      role: "SUPPLIER",
      status: "ACTIVE",
      identificationPresent: true,
    });
    expect(JSON.stringify(parties)).not.toContain("0102030405");
  });
});
