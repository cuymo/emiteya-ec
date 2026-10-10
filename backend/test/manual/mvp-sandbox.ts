// Sandbox de la prueba manual integral del MVP: SOLO desarrollo y pruebas, nunca producción.
//
//   corepack pnpm --filter @facturador/backend sandbox:mvp [archivo-de-estado.json]
//
// Arranca main.ts real sobre un esquema aislado de la base de pruebas, con la transmisión dirigida
// a un SRI SIMULADO local (respuestas sintéticas con la estructura oficial) a través de un proxy de
// salida que solo admite el host simulado: ninguna llamada llega al SRI real. Instala la política
// de tamaño SINTÉTICA de las pruebas (no es la cifra oficial, Q-47) y genera P12 sintéticos con el
// generador del repositorio. Expone un pequeño control local para elegir el comportamiento del SRI
// simulado por comprobante: recibido, retenido (`SEND_UNKNOWN`), clave ajena (`MANUAL_REVIEW`),
// devuelto (`RETURNED`), no autorizado o caído. Escribe en el archivo de estado lo necesario para la
// prueba (puertos, credenciales sintéticas, el P12 y la clave maestra sintética de la custodia). Al
// detenerse con SIGINT o SIGTERM para el backend y conserva el esquema y el directorio de trabajo,
// para que una prueba larga sobreviva a un reinicio:
//
//   sandbox:mvp <estado.json> --resume   reanuda el esquema y la custodia del archivo de estado
//   sandbox:mvp <estado.json> --clean    borra el esquema, el directorio de trabajo y el estado
//
// Se niega a arrancar con NODE_ENV=production.
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../src/platform/db/database.ts";
import {
  TEST_DATABASE_URL,
  createMigratedSchema,
  type MigratedSchema,
  withSchema,
} from "../integration/database.ts";
import { E2E_ORIGIN, startE2eBackend } from "../integration/e2e-backend.ts";
import { FIXTURE_PASSWORD, FIXTURE_RUC, generateP12Fixtures } from "../support/p12-fixtures.ts";
import {
  SRI_HOST,
  listen,
  outboundProxy,
  simulatedSri,
  type ReceptionBehavior,
} from "../support/simulated-sri.ts";

if (process.env.NODE_ENV === "production") {
  console.error("sandbox:mvp es solo para desarrollo y pruebas; nunca se arranca en producción.");
  process.exit(1);
}

const [statePath = join(tmpdir(), "facturador-mvp-sandbox.json"), mode] = process.argv.slice(2);
const API_PORT = Number(process.env.SANDBOX_API_PORT ?? 4000);
const CONTROL_PORT = Number(process.env.SANDBOX_CONTROL_PORT ?? 4699);
const ADMIN = { email: "admin@sandbox-mvp.ec", password: "Sandbox-Admin-2026" };
const BEHAVIORS: readonly ReceptionBehavior[] = ["RECEIVED", "HOLD", "FOREIGN_KEY", "RETURNED"];

type SandboxState = { schema: string; workDir: string; masterKey: string };
const previous = existsSync(statePath)
  ? (JSON.parse(readFileSync(statePath, "utf8")) as Partial<SandboxState>)
  : null;

/** Abre un esquema de pruebas que ya existe (el de un arranque anterior); null si no existe. */
async function existingSchema(name: string | undefined): Promise<MigratedSchema | null> {
  if (!name || !/^t_manual_mvp_[0-9a-f]{8}$/.test(name)) return null;
  const url = withSchema(TEST_DATABASE_URL, name);
  const database = createDatabase(url);
  const rows = await database.prisma.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = ${name}) AS found`;
  if (!rows[0]?.found) {
    await database.close();
    return null;
  }
  return {
    name,
    url,
    database,
    drop: async () => {
      // El nombre se validó arriba contra el patrón de los esquemas del sandbox.
      await database.prisma.$executeRawUnsafe(`DROP SCHEMA "${name}" CASCADE`);
      await database.close();
    },
  };
}

if (mode === "--clean") {
  await (await existingSchema(previous?.schema))?.drop();
  if (previous?.workDir?.includes("facturador-mvp-sandbox-"))
    rmSync(previous.workDir, { recursive: true, force: true });
  rmSync(statePath, { force: true });
  console.log("sandbox:mvp limpio: esquema, directorio de trabajo y estado borrados");
  process.exit(0);
}

const resumed = mode === "--resume" ? await existingSchema(previous?.schema) : null;
if (mode === "--resume" && (!resumed || !previous?.workDir || !previous.masterKey)) {
  console.error(
    "sandbox:mvp --resume necesita un estado con su esquema, su directorio y su clave.",
  );
  process.exit(1);
}
const workDir = resumed
  ? previous!.workDir!
  : mkdtempSync(join(tmpdir(), "facturador-mvp-sandbox-"));
// Clave maestra SINTÉTICA de la custodia, aleatoria por sandbox: reanudar exige la misma.
const masterKey = resumed ? previous!.masterKey! : randomBytes(32).toString("base64");
const p12Dir = join(workDir, "p12");
if (!resumed) generateP12Fixtures(p12Dir);

const sri = simulatedSri();
const sriPort = await listen(sri.server);
const proxy = outboundProxy(sriPort);
const proxyUrl = `http://127.0.0.1:${await listen(proxy.server)}`;
const db = resumed ?? (await createMigratedSchema("manual_mvp"));

const endpoint = (path: string) => `http://${SRI_HOST}/comprobantes-electronicos-ws/${path}`;
const backend = await startE2eBackend({
  label: "manual_mvp",
  admin: ADMIN,
  db,
  port: API_PORT,
  env: {
    LOG_LEVEL: "warn",
    CERTIFICATE_CUSTODY: "enabled",
    CERTIFICATE_MASTER_KEY: masterKey,
    DATA_EXPORT_DIRECTORY: join(workDir, "exports"),
    // Salida solo hacia el SRI simulado, a través del proxy que rechaza cualquier otro destino.
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    SRI_TRANSMISSION_ENABLED: "1",
    SRI_JOB_WORKERS: "2",
    SRI_JOB_POLL_INTERVAL_MS: "500",
    SRI_JOB_LEASE_SECONDS: "30",
    SRI_REQUEST_TIMEOUT_MS: "5000",
    SRI_BODY_TIMEOUT_MS: "1000",
    SRI_AUTHORIZATION_FIRST_DELAY_SECONDS: "0",
    SRI_POLL_BACKOFF_BASE_SECONDS: "1",
    SRI_POLL_BACKOFF_CAP_SECONDS: "2",
    SRI_ENDPOINT_TEST_RECEPTION: endpoint("RecepcionComprobantesOffline"),
    SRI_ENDPOINT_TEST_AUTHORIZATION: endpoint("AutorizacionComprobantesOffline"),
    SRI_ENDPOINT_TEST_VALIDITY: endpoint("ConsultaComprobante"),
    // También Producción va al simulado: ningún ambiente apunta al SRI real.
    SRI_ENDPOINT_PRODUCTION_RECEPTION: endpoint("RecepcionComprobantesOffline"),
    SRI_ENDPOINT_PRODUCTION_AUTHORIZATION: endpoint("AutorizacionComprobantesOffline"),
    SRI_ENDPOINT_PRODUCTION_VALIDITY: endpoint("ConsultaComprobante"),
  },
});

/** Control local del SRI simulado: solo escucha en 127.0.0.1. */
const control = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
  req.on("end", () => {
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const input = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    if (req.method === "GET" && req.url === "/calls") return json(200, sri.calls);
    if (req.method === "POST" && req.url === "/behavior") {
      const behavior = input.behavior as ReceptionBehavior;
      if (!Number.isInteger(input.sequential) || !BEHAVIORS.includes(behavior))
        return json(400, { error: "sequential entero y behavior conocido" });
      sri.behaviors.set(input.sequential as number, behavior);
      return json(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/not-authorized") {
      if (typeof input.document !== "string") return json(400, { error: "document `01:5`" });
      sri.notAuthorized.add(input.document);
      return json(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/down") {
      sri.setDown(input.down === true);
      return json(200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/release") {
      sri.releaseHeld();
      return json(200, { ok: true });
    }
    json(404, { error: "ruta desconocida" });
  });
});
await new Promise<void>((resolve) => control.listen(CONTROL_PORT, "127.0.0.1", resolve));

writeFileSync(
  statePath,
  JSON.stringify(
    {
      schema: db.name,
      api: backend.base,
      frontendOrigin: E2E_ORIGIN,
      control: `http://127.0.0.1:${CONTROL_PORT}`,
      admin: ADMIN,
      p12: {
        file: join(p12Dir, "sd-utf8.modern.p12"),
        password: FIXTURE_PASSWORD,
        ruc: FIXTURE_RUC,
        directory: p12Dir,
      },
      workDir,
      masterKey,
      note: "Datos sintéticos de la prueba manual; nunca credenciales ni certificados reales.",
    },
    null,
    2,
  ),
);
console.log(
  `sandbox:mvp ${resumed ? "reanudado" : "listo"} en ${backend.base}; estado en ${statePath}`,
);

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  // `backend.stop` no borra un esquema recibido: se conserva para `--resume` o `--clean`.
  await backend.stop();
  await db.database.close();
  sri.releaseHeld();
  sri.server.close();
  proxy.server.close();
  control.close();
  console.log("sandbox:mvp detenido; el esquema se conserva (--resume o --clean)");
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
