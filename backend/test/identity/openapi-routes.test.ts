// Cada ruta de usuarios que atiende Express está documentada en el registro de OpenAPI, y viceversa.
import { describe, expect, it } from "vitest";
import { apiRoutes } from "@facturador/contracts";
import type { UserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

describe("rutas documentadas", () => {
  it("el registro de OpenAPI coincide con las rutas del router de usuarios", () => {
    const router = usersRouter({} as UserAdministration) as unknown as { stack: Layer[] };
    const served = router.stack
      .flatMap((layer) =>
        layer.route
          ? Object.keys(layer.route.methods).map((method) => `${method} ${layer.route!.path}`)
          : [],
      )
      .sort();
    const documented = apiRoutes.map((route) => `${route.method} ${route.path}`).sort();
    expect(served).toEqual(documented);
  });
});
