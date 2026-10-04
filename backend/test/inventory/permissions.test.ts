// Guardia de permisos del inventario (add-minimal-inventory, spec "Permisos del inventario", design
// D11): cada operación exige su permiso antes de leer o escribir datos. La matriz vigente da
// `inventory.read` a administradores y operadores, así que el rechazo de las consultas se prueba con
// una política que no lo concede, sin inventar un rol. Las dependencias registran cualquier uso.
import { describe, expect, it } from "vitest";
import { createInventory } from "../../src/modules/inventory/application/inventory.ts";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import type { RequestContext } from "../../src/modules/identity/application/request-context.ts";
import { can, type Permission } from "../../src/modules/identity/domain/access-policy.ts";
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

function setup() {
  const touched: string[] = [];
  const requested: Permission[] = [];
  const authorizer = {
    requirePermission: (_ctx: RequestContext, action: Permission) => {
      requested.push(action);
      throw new ForbiddenError();
    },
  } as unknown as Authorizer;
  const deps = new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "authorizer" ? authorizer : untouchable(touched, `deps.${String(key)}`),
    },
  ) as never;
  return { touched, requested, inventory: createInventory(deps) };
}

describe("guardia de permisos del inventario", () => {
  const operations: [string, Permission, (s: ReturnType<typeof setup>) => Promise<unknown>][] = [
    ["consultar la lista", "inventory.read", (s) => s.inventory.list(CTX, {})],
    ["consultar el detalle", "inventory.read", (s) => s.inventory.detail(CTX, "p-1")],
    ["consultar el kárdex", "inventory.read", (s) => s.inventory.movements(CTX, "p-1", {})],
    [
      "inicializar",
      "inventory.initialize",
      (s) => s.inventory.initialize(CTX, "p-1", { quantity: "1" }),
    ],
    [
      "registrar una entrada",
      "inventory.entry",
      (s) => s.inventory.entry(CTX, "p-1", "clave-1", { quantity: "1" }),
    ],
    [
      "registrar un ajuste",
      "inventory.adjust",
      (s) => s.inventory.adjust(CTX, "p-1", "clave-1", { delta: "-1", reason: "Merma" }),
    ],
    [
      "fijar el control",
      "inventory.configure",
      (s) => s.inventory.setTracking(CTX, "p-1", { tracked: false }),
    ],
  ];

  for (const [name, permission, run] of operations) {
    it(`${name} exige ${permission} antes de tocar datos`, async () => {
      const s = setup();
      await expect(run(s)).rejects.toBeInstanceOf(ForbiddenError);
      expect(s.requested).toEqual([permission]);
      expect(s.touched).toEqual([]);
    });
  }

  it("con la matriz vigente, el operador consulta y registra entradas; el resto es del administrador", () => {
    for (const permission of [
      "inventory.read",
      "inventory.entry",
      "inventory.adjust",
      "inventory.initialize",
      "inventory.configure",
    ] as const) {
      expect(can("ADMIN", permission), `ADMIN ${permission}`).toBe(true);
    }
    expect(can("OPERATOR", "inventory.read")).toBe(true);
    expect(can("OPERATOR", "inventory.entry")).toBe(true);
    for (const permission of ["inventory.adjust", "inventory.initialize", "inventory.configure"]) {
      expect(can("OPERATOR", permission), `OPERATOR ${permission}`).toBe(false);
    }
  });
});
