// Configuración que lee el CLI `auth` para generar el esquema de Prisma (`db:auth-schema`).
// Contiene solo lo que afecta al esquema; nunca se usa para atender peticiones.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createPlugins } from "./plugins.ts";

export const auth = betterAuth({
  database: prismaAdapter({}, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  telemetry: { enabled: false },
  plugins: createPlugins(),
});
