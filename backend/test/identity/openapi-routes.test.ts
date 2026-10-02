// Cada ruta de /api/v1 que atiende Express está documentada en el registro de OpenAPI, y viceversa.
import type { Router } from "express";
import { describe, expect, it } from "vitest";
import { apiRoutes } from "@facturador/contracts";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import type { UserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { taxpayerRouters } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { fiscalRouters } from "../../src/modules/fiscal/infrastructure/index.ts";

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

function served(router: Router): string[] {
  return (router as unknown as { stack: Layer[] }).stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map((method) => `${method} ${layer.route!.path}`)
      : [],
  );
}

describe("rutas documentadas", () => {
  it("el registro de OpenAPI coincide con las rutas de los routers de /api/v1", () => {
    // Los routers solo se inspeccionan: ninguna dependencia se usa al construirlos.
    const routers = [
      usersRouter({} as UserAdministration),
      ...taxpayerRouters({
        prisma: {} as PrismaClient,
        authorizer: {} as Authorizer,
        logoMaxBytes: 1,
      }),
      ...fiscalRouters({ prisma: {} as PrismaClient, authorizer: {} as Authorizer }),
    ];
    const documented = apiRoutes.map((route) => `${route.method} ${route.path}`).sort();
    expect(routers.flatMap(served).sort()).toEqual(documented);
  });

  it("ninguna ruta permite bloquear ni desbloquear la identidad tributaria", () => {
    expect(apiRoutes.filter((route) => /lock|bloque/i.test(route.path))).toEqual([]);
  });

  it("ninguna ruta reserva secuenciales (add-fiscal-numbering, design D4)", () => {
    expect(apiRoutes.filter((route) => /reserv/i.test(route.path))).toEqual([]);
    const writes = apiRoutes.filter(
      (route) => route.method !== "get" && /sequence/i.test(route.path),
    );
    expect(writes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "put /establishments/:establishmentId/emission-points/:emissionPointId/sequences/:environment/:documentType",
    ]);
  });
});
