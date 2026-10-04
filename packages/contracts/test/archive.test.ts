// Contratos de la bandeja de comprobantes (add-document-archive, tarea 6.1, design D2, D8 a D10).
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_ERROR_CODES,
  DELIVERY_EVENTS,
  DELIVERY_EVENT_LABELS,
  DOCUMENT_STATES,
  INVOICE_STATES,
  RIDE_STATUSES,
  listDocumentsQuerySchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("filtros de la bandeja", () => {
  it("acepta todos los filtros combinados, con el rango de fechas inclusivo", () => {
    const parsed = listDocumentsQuerySchema.parse({
      from: "2026-10-01",
      to: "2026-10-15",
      documentType: "01",
      state: "AUTHORIZED",
      identification: "0992877878001",
      search: " 001-001 ",
      establishmentId: "est-1",
      emissionPointId: "pto-1",
      page: "2",
      pageSize: "50",
    });
    expect(parsed).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-15",
      search: "001-001",
      page: 2,
      pageSize: 50,
    });
    expect(listDocumentsQuerySchema.parse({ from: "2026-10-01", to: "2026-10-01" })).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });

  it("rechaza una fecha mal formada o inexistente, un rango invertido y un estado desconocido", () => {
    for (const from of ["2026/10/01", "01-10-2026", "2026-02-30", "2026-13-01"]) {
      expect(messages(listDocumentsQuerySchema.safeParse({ from }))).toContain(
        "La fecha no es válida.",
      );
    }
    expect(
      messages(listDocumentsQuerySchema.safeParse({ from: "2026-10-15", to: "2026-10-01" })),
    ).toEqual(["La fecha final no puede ser anterior a la inicial."]);
    expect(messages(listDocumentsQuerySchema.safeParse({ state: "DRAFT" }))).toEqual([
      "El estado no es válido.",
    ]);
    expect(messages(listDocumentsQuerySchema.safeParse({ documentType: "99" }))).toEqual([
      "El tipo de comprobante no es válido.",
    ]);
    expect(messages(listDocumentsQuerySchema.safeParse({ identification: "1' OR 1=1" }))).toEqual([
      "La identificación no es válida.",
    ]);
  });

  it("ignora un companyId en la consulta: la empresa sale de la sesión", () => {
    expect(listDocumentsQuerySchema.parse({ companyId: "otra" })).not.toHaveProperty("companyId");
  });
});

describe("vocabulario de la bandeja", () => {
  it("los estados son los del comprobante desde que se reserva, sin borradores", () => {
    expect(DOCUMENT_STATES).toEqual(INVOICE_STATES);
    expect(DOCUMENT_STATES).not.toContain("DRAFT");
    expect(RIDE_STATUSES).toEqual(["AVAILABLE", "PENDING", "STOPPED", "NOT_APPLICABLE"]);
  });

  it("las entregas son solo descargas y solicitudes de impresión, nunca entregas confirmadas", () => {
    expect(DELIVERY_EVENTS).toEqual(["DOWNLOAD", "PRINT_REQUESTED"]);
    expect(Object.values(DELIVERY_EVENT_LABELS).join(" ")).not.toMatch(
      /impreso|entregad|recibid|correo/i,
    );
  });

  it("declara los códigos de error de la bandeja", () => {
    expect(ARCHIVE_ERROR_CODES).toEqual([
      "DOCUMENT_NOT_FOUND",
      "DOCUMENT_NOT_AVAILABLE",
      "ARTIFACT_INTEGRITY_FAILED",
      "RIDE_ALREADY_AVAILABLE",
      "RIDE_GENERATION_IN_PROGRESS",
      "DOCUMENT_NOT_AUTHORIZED",
    ]);
  });
});
