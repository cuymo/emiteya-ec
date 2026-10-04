// Guardia de permisos del archivo documental (add-document-archive, spec "Permisos de la bandeja",
// design D11): cada operación exige su permiso antes de leer o escribir datos. La matriz vigente da
// los tres permisos a administradores y operadores, así que el rechazo se prueba con una política
// que no los concede, sin inventar un rol. Las dependencias registran cualquier uso.
import { describe, expect, it } from "vitest";
import { createArchive } from "../../src/modules/fiscal/application/archive/archive.ts";
import { createDownloads } from "../../src/modules/fiscal/application/archive/downloads.ts";
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
  return {
    touched,
    requested,
    archive: createArchive(deps),
    downloads: createDownloads(deps),
  };
}

describe("guardia de permisos del archivo documental", () => {
  const operations: [string, Permission, (s: ReturnType<typeof setup>) => Promise<unknown>][] = [
    ["consultar la bandeja", "archive.read", (s) => s.archive.list(CTX, {})],
    [
      "consultar los documentos de un comprobante",
      "archive.read",
      (s) => s.archive.summary(CTX, "d-1"),
    ],
    ["descargar el RIDE", "archive.download", (s) => s.downloads.download(CTX, "d-1", "RIDE_PDF")],
    [
      "descargar el XML autorizado",
      "archive.download",
      (s) => s.downloads.download(CTX, "d-1", "AUTHORIZED_XML"),
    ],
    [
      "descargar el XML firmado",
      "archive.download",
      (s) => s.downloads.download(CTX, "d-1", "SIGNED_XML"),
    ],
    ["solicitar la impresión", "archive.download", (s) => s.downloads.requestPrint(CTX, "d-1")],
    ["consultar las entregas", "archive.read", (s) => s.downloads.deliveries(CTX, "d-1")],
    [
      "reintentar una generación detenida",
      "archive.retryRide",
      (s) => s.archive.retryRide(CTX, "d-1"),
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

  it("con la matriz vigente, administradores y operadores tienen los tres permisos", () => {
    for (const role of ["ADMIN", "OPERATOR"]) {
      for (const permission of ["archive.read", "archive.download", "archive.retryRide"]) {
        expect(can(role, permission), `${role} ${permission}`).toBe(true);
      }
    }
  });
});
