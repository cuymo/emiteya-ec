// Arranca el backend con el mismo comando de desarrollo (sin --watch) y espera /health/live y
// /health/ready. Garantiza que el type stripping nativo de Node sigue pudiendo arrancarlo (ADR 0016).
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";

const backendDir = join(import.meta.dirname, "..", "backend");
const DEADLINE_MS = 20_000;
const DEFAULT_TEST_URL = "postgresql://facturador:facturador@127.0.0.1:5432/facturador_test";

function devArgs(): string[] {
  const manifest = JSON.parse(readFileSync(join(backendDir, "package.json"), "utf8")) as {
    scripts?: { dev?: string };
  };
  const [command, ...args] = (manifest.scripts?.dev ?? "").split(/\s+/).filter(Boolean);
  if (command !== "node")
    throw new Error(
      `check:dev-start: el script dev del backend debe empezar con node (es «${command}»)`,
    );
  return args.filter((arg) => arg !== "--watch");
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, until: number): Promise<boolean> {
  while (Date.now() < until) {
    const ok = await fetch(url).then(
      (res) => res.status === 200,
      () => false,
    );
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const port = await freePort();
const args = devArgs();
const child = spawn(process.execPath, args, {
  cwd: backendDir,
  env: {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? DEFAULT_TEST_URL,
    LOG_LEVEL: "warn",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

const until = Date.now() + DEADLINE_MS;
const live = await waitFor(`http://127.0.0.1:${port}/health/live`, until);
const ready = live && (await waitFor(`http://127.0.0.1:${port}/health/ready`, until));
child.kill("SIGTERM");
const code = await exited;

if (!live || !ready || code !== 0) {
  console.error(
    `check:dev-start falló: node ${args.join(" ")} (live=${live}, ready=${ready}, salida=${code})`,
  );
  console.error(output.trim());
  process.exit(1);
}
console.log(
  `check:dev-start: el backend arranca con «node ${args.join(" ")}» y responde live y ready.`,
);
