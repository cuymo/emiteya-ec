// Reglas puras del tercero (add-parties-and-products, design D4, D10 y D13).
import { describe, expect, it } from "vitest";
import {
  identificationProblem,
  partyChanges,
  partySearchKeys,
  type IdentificationRule,
  type PartyRecord,
} from "../../src/modules/parties/domain/party.ts";
import { escapeLike, searchKey } from "../../src/platform/search/search-key.ts";

const ruc: IdentificationRule = {
  code: "04",
  officialLabel: "RUC",
  pattern: "^[0-9]{10}001$",
  description: "13 dígitos terminados en 001",
  reservedFor: null,
};

const before: PartyRecord = {
  id: "p1",
  companyId: "c1",
  identificationType: "04",
  identification: "1790012345001",
  legalName: "Comercial Andina S.A.",
  address: "Quito",
  email: "a@b.ec",
  phone: null,
  roles: ["CUSTOMER"],
  status: "ACTIVE",
  systemRecord: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const data = {
  identificationType: before.identificationType,
  identification: before.identification,
  legalName: before.legalName,
  address: before.address,
  email: before.email,
  phone: before.phone,
  roles: before.roles,
};

describe("claves de búsqueda", () => {
  it("quitan tildes, mayúsculas y espacios repetidos", () => {
    expect(searchKey("  García   Ñandú S.A. ")).toBe("garcia nandu s.a.");
    expect(partySearchKeys({ legalName: "CAFÉ", identification: "AB-12" })).toEqual({
      searchName: "cafe",
      searchIdentification: "ab-12",
    });
  });

  it("los comodines de LIKE se escapan", () => {
    expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  });
});

describe("identificationProblem", () => {
  it("valida con el patrón del catálogo y nunca con un dígito verificador", () => {
    expect(identificationProblem(ruc, "1234567890001")).toBeNull();
    expect(identificationProblem(ruc, "123456789")).toEqual({ kind: "INVALID", rule: ruc });
  });

  it("el tipo reservado y el tipo sin versión vigente se rechazan", () => {
    expect(
      identificationProblem({ ...ruc, reservedFor: "CONSUMER_FINAL" }, "9999999999999"),
    ).toEqual({
      kind: "RESERVED",
    });
    expect(identificationProblem(null, "1")).toEqual({ kind: "TYPE_UNAVAILABLE" });
  });
});

describe("partyChanges", () => {
  it("una corrección sin cambios no produce cambios", () => {
    expect(partyChanges(before, data)).toBeNull();
  });

  it("la identidad, la razón social y los roles con valor anterior y nuevo; el contacto, solo sus nombres", () => {
    expect(
      partyChanges(before, {
        ...data,
        identification: "1790012345002",
        roles: ["CUSTOMER", "CARRIER"],
        email: "otro@b.ec",
        phone: "022",
      }),
    ).toEqual({
      "identification.from": "1790012345001",
      "identification.to": "1790012345002",
      "roles.from": ["CUSTOMER"],
      "roles.to": ["CUSTOMER", "CARRIER"],
      changedFields: ["email", "phone"],
    });
  });
});
