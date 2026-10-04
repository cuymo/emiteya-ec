// El espejo de presentación del frontend (`frontend/src/lib/permissions.ts`) coincide con la
// política central del servidor, permiso por permiso y rol por rol. El espejo solo decide qué se
// muestra, pero una diferencia ofrecería acciones que la API rechaza u ocultaría las permitidas.
import { describe, expect, it } from "vitest";
import { canSee } from "../../../frontend/src/lib/permissions.ts";
import { PERMISSIONS, can } from "../../src/modules/identity/domain/access-policy.ts";

describe("espejo de los permisos en el frontend", () => {
  it("cada permiso se ve en la interfaz exactamente para los roles que el servidor autoriza", () => {
    for (const permission of PERMISSIONS) {
      for (const role of ["ADMIN", "OPERATOR"] as const) {
        expect(canSee(role, permission), `${permission} ${role}`).toBe(can(role, permission));
      }
    }
    expect(canSee("OPERATOR", "invoices.reconcile")).toBe(false);
    expect(canSee("ADMIN", "invoices.reconcile")).toBe(true);
  });
});
