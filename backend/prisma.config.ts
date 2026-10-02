// Configuración de Prisma 7. En desarrollo lee backend/.env si existe; en CI y producción, el entorno.
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` no necesita conexión; las migraciones exigen DATABASE_URL.
  ...(url ? { datasource: { url } } : {}),
});
