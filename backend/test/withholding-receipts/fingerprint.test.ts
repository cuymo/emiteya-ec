// Huella de la emisión de un comprobante de retención (add-withholding-receipts, design D16): cubre el
// borrador, su versión y los datos funcionales de esa versión. Con la misma clave, otro borrador,
// otra versión, otro período, otro proveedor u otras retenciones dan otra huella y el servicio
// responde `409 IDEMPOTENCY_KEY_REUSED` sin reservar (lo prueba `withholding-emission.test.ts`); la
// misma solicitud da la misma huella.
import { describe, expect, it } from "vitest";
import { withholdingFingerprint } from "../../src/modules/withholding-receipts/application/emission.ts";
import type { WithholdingDraftRecord } from "../../src/modules/withholding-receipts/domain/draft.ts";
import { DRAFT, SUPPORT } from "./fixtures.ts";

const RECORD: WithholdingDraftRecord = {
  ...DRAFT,
  emissionPointId: "point-1",
  id: "draft-1",
  companyId: "company-1",
  status: "DRAFT",
  documentId: null,
  version: 3,
  createdAt: new Date("2026-10-06T15:00:00Z"),
  createdBy: "user-1",
  updatedAt: new Date("2026-10-06T15:05:00Z"),
  updatedBy: "user-1",
};
const INPUT = { draftId: "draft-1", expectedVersion: 3 };
const base = withholdingFingerprint(INPUT, RECORD);

describe("huella de la emisión de una retención", () => {
  it("la misma solicitud da la misma huella, sin depender de quién ni cuándo editó", () => {
    expect(withholdingFingerprint({ ...INPUT }, { ...RECORD })).toBe(base);
    expect(
      withholdingFingerprint(INPUT, {
        ...RECORD,
        updatedAt: new Date("2026-10-07T10:00:00Z"),
        updatedBy: "user-2",
      }),
    ).toBe(base);
  });

  it("otro borrador, otra versión, otro período, otro proveedor u otras retenciones dan otra huella", () => {
    const variants: Record<string, string> = {
      "otro borrador": withholdingFingerprint({ ...INPUT, draftId: "draft-2" }, RECORD),
      "otra versión": withholdingFingerprint({ ...INPUT, expectedVersion: 4 }, RECORD),
      "otro período": withholdingFingerprint(INPUT, { ...RECORD, fiscalPeriod: "09/2026" }),
      "otro proveedor": withholdingFingerprint(INPUT, { ...RECORD, partyId: "party-2" }),
      "otra parte relacionada": withholdingFingerprint(INPUT, { ...RECORD, relatedParty: "SI" }),
      "otra base": withholdingFingerprint(INPUT, {
        ...RECORD,
        supports: [
          {
            ...SUPPORT,
            withholdings: [
              { ...SUPPORT.withholdings[0]!, base: "100.30" },
              SUPPORT.withholdings[1]!,
            ],
          },
        ],
      }),
      "otro concepto": withholdingFingerprint(INPUT, {
        ...RECORD,
        supports: [
          {
            ...SUPPORT,
            withholdings: [
              { ...SUPPORT.withholdings[0]!, entryKey: "312" },
              SUPPORT.withholdings[1]!,
            ],
          },
        ],
      }),
      "otro orden de las retenciones": withholdingFingerprint(INPUT, {
        ...RECORD,
        supports: [{ ...SUPPORT, withholdings: [...SUPPORT.withholdings].reverse() }],
      }),
      "otra forma de pago": withholdingFingerprint(INPUT, {
        ...RECORD,
        supports: [{ ...SUPPORT, payments: [{ paymentMethod: "01", total: "115.33" }] }],
      }),
    };
    for (const [name, fingerprint] of Object.entries(variants)) {
      expect(fingerprint, name).not.toBe(base);
    }
    expect(new Set(Object.values(variants)).size).toBe(Object.keys(variants).length);
  });
});
