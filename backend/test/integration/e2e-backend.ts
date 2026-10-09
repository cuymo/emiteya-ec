// Arranque común de las pruebas end-to-end: un esquema vacío con las migraciones y main.ts como
// proceso, la espera a /health/ready, la parada y el inicio de sesión por HTTP. Antes cada prueba
// copiaba este bloque (deuda técnica registrada en add-fiscal-numbering).
import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { BACKEND_DIR, createMigratedSchema, type MigratedSchema } from "./database.ts";

export const E2E_ORIGIN = "http://localhost:3000";

export type E2eBackend = {
  db: MigratedSchema;
  base: string;
  /** Proceso de main.ts, para medir su memoria y su CPU en los benchmarks. */
  pid: number;
  /** Salida estándar y de errores acumulada del proceso. */
  output: () => string;
  /** Detiene el proceso con SIGTERM y borra el esquema si lo creó este arranque. */
  stop: () => Promise<void>;
  /** Mata el proceso con SIGKILL, sin apagado ordenado: una caída. No borra el esquema. */
  crash: () => Promise<void>;
  /** Inicio de sesión con correo y contraseña desde el origen del frontend. */
  signIn: (email: string, password: string) => Promise<{ status: number; cookie: string }>;
  /** Petición a /api/v1 con la cookie de sesión y el origen del frontend. */
  fetchApi: (method: string, path: string, cookie: string, body?: unknown) => Promise<Response>;
};

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Arranca main.ts sobre un esquema nuevo, que se aprovisiona con el administrador inicial. La
 * custodia de firmas está deshabilitada salvo que `env` la configure. Con `db`, arranca sobre un
 * esquema existente (un segundo arranque), y `stop` no lo borra: lo borra quien lo creó. Con
 * `waitFor: "live"`, espera a /health/live: para probar un arranque que no queda listo.
 */
export async function startE2eBackend(options: {
  label: string;
  admin: { email: string; password: string };
  env?: Record<string, string>;
  db?: MigratedSchema;
  waitFor?: "ready" | "live";
  /** Un puerto fijo, para un frontend que reenvía `/api` a una dirección conocida. */
  port?: number;
}): Promise<E2eBackend> {
  const db = options.db ?? (await createMigratedSchema(options.label));
  const port = options.port ?? (await freePort());
  const base = `http://127.0.0.1:${port}`;
  const backend = spawn(process.execPath, ["--conditions=development", "src/main.ts"], {
    cwd: BACKEND_DIR,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      DATABASE_URL: db.url,
      BETTER_AUTH_SECRET: "secreto-de-pruebas-e2e-0123456789abcdef",
      BETTER_AUTH_URL: E2E_ORIGIN,
      INITIAL_USER_EMAIL: options.admin.email,
      INITIAL_USER_PASSWORD: options.admin.password,
      LOG_LEVEL: "warn",
      CERTIFICATE_CUSTODY: "disabled",
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  backend.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  backend.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const stop = async () => {
    if (backend.exitCode === null && backend.signalCode === null) {
      const exited = new Promise((resolve) => backend.once("exit", resolve));
      backend.kill("SIGTERM");
      await exited;
    }
    if (!options.db) await db.drop();
  };

  const deadline = Date.now() + 90_000;
  let ready = false;
  while (!ready && Date.now() < deadline && backend.exitCode === null) {
    ready = await fetch(`${base}/health/${options.waitFor ?? "ready"}`).then(
      (res) => res.ok,
      () => false,
    );
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) {
    await stop();
    throw new Error(`El backend no arrancó:\n${output}`);
  }

  return {
    db,
    base,
    pid: backend.pid!,
    output: () => output,
    stop,
    async crash() {
      if (backend.exitCode !== null || backend.signalCode !== null) return;
      const exited = new Promise((resolve) => backend.once("exit", resolve));
      backend.kill("SIGKILL");
      await exited;
    },
    async signIn(email, password) {
      const res = await fetch(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: E2E_ORIGIN },
        body: JSON.stringify({ email, password }),
      });
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      return { status: res.status, cookie };
    },
    fetchApi: (method, path, cookie, body) =>
      fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          cookie,
          origin: E2E_ORIGIN,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
  };
}
