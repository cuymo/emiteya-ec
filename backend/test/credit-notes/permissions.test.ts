// Guardia de permisos de los casos de uso de notas de crédito (add-credit-notes, spec credit-notes
// "Permisos de notas de crédito", design D17): cada operación exige su permiso antes de leer o
// escribir datos. La matriz vigente concede la consulta, el borrador, la emisión y el reintento a
// administradores y operadores, así que el rechazo se prueba con una política que no los concede,
// sin inventar un rol. Las dependencias registran cualquier uso.
import { describe, expect, it } from "vitest";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import { can, type Permission } from "../../src/modules/identity/domain/access-policy.ts";
import { createCreditNotes } from "../../src/modules/credit-notes/application/credit-notes.ts";
import { createCreditNoteDrafts } from "../../src/modules/credit-notes/application/drafts.ts";
import { createCreditNoteEmission } from "../../src/modules/credit-notes/application/emission.ts";
import { ForbiddenError } from "../../src/platform/http/errors.ts";

const CTX: RequestContext = {
  userId: "user-1",
  companyId: "company-1",
  role: "OPERATOR",
  requestId: "req-1",
};

/** Dependencia que falla y lo registra si alguien la llama, en cualquier profundidad. */
function untouchable(touched: string[], path = "deps"): never {
  const target = () => undefined;
  return new Proxy(target, {
    get: (_target, key) =>
      key === "then" ? undefined : untouchable(touched, `${path}.${String(key)}`),
    apply: () => {
      touched.push(path);
      throw new Error(`${path} no debía usarse`);
    },
  }) as never;
}

/** Política que no concede ningún permiso y registra cuál se pidió. */
function denying(requested: Permission[]): Authorizer {
  return {
    requirePermission: (_ctx: RequestContext, action: Permission) => {
      requested.push(action);
      throw new ForbiddenError();
    },
    requireMember: () => Promise.reject(new Error("no se usa")),
    missingResource: () => new Error("no se usa"),
  } as unknown as Authorizer;
}

function setup() {
  const touched: string[] = [];
  const requested: Permission[] = [];
  const deps = (extra: Record<string, unknown>) =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "authorizer"
            ? denying(requested)
            : key in extra
              ? extra[key as string]
              : untouchable(touched, `deps.${String(key)}`),
      },
    ) as never;
  return {
    touched,
    requested,
    drafts: createCreditNoteDrafts(deps({})),
    emission: createCreditNoteEmission(deps({ builderVersion: "1" })),
    creditNotes: createCreditNotes(deps({ conclusionWindowMs: 1 })),
  };
}

const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};

describe("guardia de permisos de notas de crédito (spec credit-notes: Permisos)", () => {
  const operations: [string, Permission, (s: ReturnType<typeof setup>) => Promise<unknown>][] = [
    [
      "buscar facturas elegibles",
      "creditNotes.draft",
      (s) => s.creditNotes.eligibleInvoices(CTX, {}),
    ],
    ["listar borradores", "creditNotes.draft", (s) => s.drafts.list(CTX, {})],
    ["crear un borrador", "creditNotes.draft", (s) => s.drafts.create(CTX, {})],
    ["consultar un borrador", "creditNotes.draft", (s) => s.drafts.get(CTX, "draft-1")],
    ["corregir un borrador", "creditNotes.draft", (s) => s.drafts.update(CTX, "draft-1", {})],
    ["eliminar un borrador", "creditNotes.draft", (s) => s.drafts.remove(CTX, "draft-1")],
    [
      "emitir",
      "creditNotes.emit",
      (s) =>
        s.emission.emit(CTX, "clave-1", {
          draftId: "draft-1",
          expectedVersion: 1,
          declarations: DECLARATIONS,
        }),
    ],
    ["consultar una nota", "creditNotes.read", (s) => s.creditNotes.get(CTX, "nota-1")],
    [
      "reintentar la firma",
      "creditNotes.retrySigning",
      (s) => s.creditNotes.retrySigning(CTX, "nota-1"),
    ],
    ["listar notas", "creditNotes.read", (s) => s.creditNotes.list(CTX, {})],
    [
      "consultar el historial de la transmisión",
      "creditNotes.read",
      (s) => s.creditNotes.transmission(CTX, "nota-1"),
    ],
    [
      "consultar el crédito de una factura",
      "creditNotes.read",
      (s) => s.creditNotes.invoiceCredit(CTX, "factura-1"),
    ],
    [
      "pedir una reconciliación",
      "creditNotes.reconcile",
      (s) => s.creditNotes.requestReconciliation(CTX, "nota-1", { reason: "x" }),
    ],
  ];

  it.each(operations)(
    "%s exige %s y, sin él, responde prohibido sin leer ni escribir",
    async (_name, permission, run) => {
      const s = setup();
      const error = await run(s).then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).status).toBe(403);
      expect(s.requested).toEqual([permission]);
      expect(s.touched).toEqual([]);
    },
  );

  it("con la matriz vigente, administradores y operadores consultan, preparan, emiten y reintentan", () => {
    for (const permission of [
      "creditNotes.read",
      "creditNotes.draft",
      "creditNotes.emit",
      "creditNotes.retrySigning",
    ] as const) {
      expect([can("ADMIN", permission), can("OPERATOR", permission)]).toEqual([true, true]);
    }
    expect([
      can("ADMIN", "creditNotes.reconcile"),
      can("OPERATOR", "creditNotes.reconcile"),
    ]).toEqual([true, false]);
  });
});
