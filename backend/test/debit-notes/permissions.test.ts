// Guardia de permisos de los casos de uso de notas de débito (add-debit-notes, spec debit-notes
// "Permisos de notas de débito", design D21): cada operación exige su permiso antes de leer o
// escribir datos. La matriz vigente concede la consulta, el borrador, la emisión y el reintento a
// administradores y operadores, así que el rechazo se prueba con una política que no los concede,
// sin inventar un rol. Las dependencias registran cualquier uso.
import { describe, expect, it } from "vitest";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import { can, type Permission } from "../../src/modules/identity/domain/access-policy.ts";
import { createDebitNotes } from "../../src/modules/debit-notes/application/debit-notes.ts";
import { createDebitNoteDrafts } from "../../src/modules/debit-notes/application/drafts.ts";
import { createDebitNoteEmission } from "../../src/modules/debit-notes/application/emission.ts";
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
  const deps = () =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === "authorizer" ? denying(requested) : untouchable(touched, `deps.${String(key)}`),
      },
    ) as never;
  return {
    touched,
    requested,
    drafts: createDebitNoteDrafts(deps()),
    emission: createDebitNoteEmission(deps()),
    debitNotes: createDebitNotes(deps()),
  };
}

describe("permisos de las notas de débito", () => {
  it("cada caso de uso exige su permiso antes de leer o escribir", async () => {
    const cases: [Permission, (s: ReturnType<typeof setup>) => Promise<unknown>][] = [
      ["debitNotes.draft", (s) => s.drafts.create(CTX, {})],
      ["debitNotes.draft", (s) => s.drafts.get(CTX, "draft-1")],
      ["debitNotes.draft", (s) => s.drafts.list(CTX, {})],
      ["debitNotes.draft", (s) => s.drafts.update(CTX, "draft-1", {})],
      ["debitNotes.draft", (s) => s.drafts.remove(CTX, "draft-1")],
      ["debitNotes.draft", (s) => s.debitNotes.eligibleInvoices(CTX, {})],
      ["debitNotes.emit", (s) => s.emission.emit(CTX, "clave", {})],
      ["debitNotes.read", (s) => s.debitNotes.get(CTX, "note-1")],
      ["debitNotes.read", (s) => s.debitNotes.list(CTX, {})],
      ["debitNotes.read", (s) => s.debitNotes.transmission(CTX, "note-1")],
      ["debitNotes.retrySigning", (s) => s.debitNotes.retrySigning(CTX, "note-1")],
      ["debitNotes.reconcile", (s) => s.debitNotes.requestReconciliation(CTX, "note-1", {})],
    ];
    for (const [permission, run] of cases) {
      const s = setup();
      await expect(run(s), permission).rejects.toBeInstanceOf(ForbiddenError);
      expect(s.requested, permission).toEqual([permission]);
      expect(s.touched, permission).toEqual([]);
    }
  });

  it("la matriz concede las operaciones a ambos roles y la reconciliación solo al administrador", () => {
    for (const permission of [
      "debitNotes.read",
      "debitNotes.draft",
      "debitNotes.emit",
      "debitNotes.retrySigning",
    ] as const) {
      expect([can("ADMIN", permission), can("OPERATOR", permission)], permission).toEqual([
        true,
        true,
      ]);
    }
    expect([can("ADMIN", "debitNotes.reconcile"), can("OPERATOR", "debitNotes.reconcile")]).toEqual(
      [true, false],
    );
  });
});
