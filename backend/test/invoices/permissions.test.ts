// Guardia de permisos de los casos de uso de facturas (add-invoice-emission, spec invoices "Permisos
// de facturas", design D14; add-sri-transmission, design D18): cada operación exige su permiso antes
// de leer o escribir datos. La matriz vigente da los cuatro primeros permisos a administradores y
// operadores, así que el rechazo se prueba con una política que no los concede, sin inventar un rol.
// Las dependencias registran cualquier uso.
import { describe, expect, it } from "vitest";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import { can, type Permission } from "../../src/modules/identity/domain/access-policy.ts";
import { createDrafts } from "../../src/modules/invoices/application/drafts.ts";
import { createEmission } from "../../src/modules/invoices/application/emission.ts";
import { createInvoices } from "../../src/modules/invoices/application/invoices.ts";
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
    drafts: createDrafts(deps({ maxLines: 100 })),
    emission: createEmission(deps({ maxLines: 100, builderVersion: "1" })),
    invoices: createInvoices(deps({ conclusionWindowMs: 1 })),
  };
}

describe("guardia de permisos de facturas (spec invoices: Permisos de facturas)", () => {
  const operations: [string, Permission, (s: ReturnType<typeof setup>) => Promise<unknown>][] = [
    ["listar borradores", "invoices.draft", (s) => s.drafts.list(CTX, {})],
    ["crear un borrador", "invoices.draft", (s) => s.drafts.create(CTX, {})],
    ["consultar un borrador", "invoices.draft", (s) => s.drafts.get(CTX, "draft-1")],
    ["corregir un borrador", "invoices.draft", (s) => s.drafts.update(CTX, "draft-1", {})],
    ["eliminar un borrador", "invoices.draft", (s) => s.drafts.remove(CTX, "draft-1")],
    [
      "emitir",
      "invoices.emit",
      (s) => s.emission.emit(CTX, "clave-1", { draftId: "draft-1", expectedVersion: 1 }),
    ],
    ["listar facturas", "invoices.read", (s) => s.invoices.list(CTX, {})],
    ["consultar una factura", "invoices.read", (s) => s.invoices.get(CTX, "invoice-1")],
    [
      "reintentar la firma",
      "invoices.retrySigning",
      (s) => s.invoices.retrySigning(CTX, "invoice-1"),
    ],
    // add-sri-transmission, design D18.
    [
      "consultar el historial de la transmisión",
      "invoices.read",
      (s) => s.invoices.transmission(CTX, "invoice-1"),
    ],
    [
      "pedir una reconciliación",
      "invoices.reconcile",
      (s) => s.invoices.requestReconciliation(CTX, "invoice-1", { reason: "x" }),
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

  it("con la matriz vigente, administradores y operadores tienen los cuatro permisos", () => {
    for (const permission of [
      "invoices.read",
      "invoices.draft",
      "invoices.emit",
      "invoices.retrySigning",
    ] as const) {
      expect([can("ADMIN", permission), can("OPERATOR", permission)]).toEqual([true, true]);
    }
  });

  it("solo los administradores pueden reconciliar (add-sri-transmission, design D18)", () => {
    expect([can("ADMIN", "invoices.reconcile"), can("OPERATOR", "invoices.reconcile")]).toEqual([
      true,
      false,
    ]);
  });
});
