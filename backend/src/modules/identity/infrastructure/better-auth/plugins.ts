// Plugins de Better Auth (design D1 y D2). Junto con el adapter, son las únicas opciones que
// cambian el esquema de base de datos: el CLI `auth` los lee desde cli.config.ts.
import { admin, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";

// Los roles de la membresía no conceden permisos de los endpoints del plugin, que están cerrados
// (D2); la autorización de la aplicación vive en domain/access-policy.ts.
const accessControl = createAccessControl({});

export function createPlugins() {
  return [
    // Solo para auth.api.createUser desde el servidor; nadie recibe el rol global `admin`.
    admin(),
    organization({
      ac: accessControl,
      roles: { ADMIN: accessControl.newRole({}), OPERATOR: accessControl.newRole({}) },
      creatorRole: "ADMIN",
      allowUserToCreateOrganization: false,
      schema: {
        member: {
          additionalFields: {
            status: { type: "string", required: true, defaultValue: "ACTIVE", input: false },
          },
        },
      },
    }),
  ];
}
