// Lista de permitidos de salida de la sesión de certificación en Pruebas
// (docs/quality/sri-egress-allowlist.md). Herramienta del operador, fuera del runtime de la aplicación.
// No usa sudo ni cambia el firewall: aísla el proceso en un espacio de nombres de red sin interfaces y
// le da una única salida, un proxy que solo admite celcer.sri.gob.ec:443.
//
//   node scripts/sri-egress/session.ts verify   [--backend-env-file <archivo>] [--pg <host:puerto>] [--out <archivo>]
//   node scripts/sri-egress/session.ts apply    --state-dir <dir> --backend-env-file <archivo> --api-port <n> [--pg <host:puerto>] -- <comando de la aplicación…>
//   node scripts/sri-egress/session.ts status   --state-dir <dir>
//   node scripts/sri-egress/session.ts rollback --state-dir <dir>
//
// `verify` no genera tráfico de red: no contacta el SRI, ni Pruebas ni Producción.
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { decideEgress, type EgressReason } from "./policy.ts";
import { createEgressProxy, type Dial } from "./proxy.ts";
import { closeServer, listenUnix, relayTcpToUnix, relayUnixToTcp } from "./relay.ts";
import { checkSessionEnv, parseEnvFile, type EnvCheck } from "./session-env.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = realpathSync(join(HERE, "..", ".."));

export type Check = Readonly<{ name: string; ok: boolean; detail: string }>;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function parsePg(value = "127.0.0.1:5432") {
  const match = /^([^:]+):(\d+)$/.exec(value);
  if (!match) throw new Error("--pg debe ser host:puerto");
  return { host: match[1]!, port: Number(match[2]) };
}

/** Matriz de la política: lo admitido y lo rechazado, sin red. */
export const POLICY_MATRIX: readonly [string, string, EgressReason][] = [
  ["CONNECT", "celcer.sri.gob.ec:443", "ALLOWED_SRI_TEST"],
  ["CONNECT", "CELCER.SRI.GOB.EC.:443", "ALLOWED_SRI_TEST"],
  ["CONNECT", "cel.sri.gob.ec:443", "PRODUCTION_ACCESS_BLOCKED"],
  ["CONNECT", "cel.sri.gob.ec:80", "PRODUCTION_ACCESS_BLOCKED"],
  [
    "GET",
    "http://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline",
    "PRODUCTION_ACCESS_BLOCKED",
  ],
  ["CONNECT", "celcer.sri.gob.ec:80", "PORT_NOT_ALLOWED"],
  ["CONNECT", "celcer.sri.gob.ec.example.com:443", "HOST_NOT_ALLOWED"],
  ["CONNECT", "www.sri.gob.ec:443", "HOST_NOT_ALLOWED"],
  ["CONNECT", "192.0.2.1:443", "HOST_NOT_ALLOWED"],
  ["CONNECT", "[::1]:443", "MALFORMED_TARGET"],
  ["GET", "http://celcer.sri.gob.ec/", "METHOD_NOT_ALLOWED"],
];

function checkPolicy(): Check[] {
  return POLICY_MATRIX.map(([method, target, expected]) => {
    const result = decideEgress(method, target);
    return {
      name: `policy ${method} ${target}`,
      ok: result.reason === expected,
      detail: result.reason,
    };
  });
}

/** Una petición CONNECT por el socket Unix del proxy; devuelve la línea de estado y la decisión. */
function connectThrough(unixPath: string, target: string, payload?: string) {
  return new Promise<{ status: string; decision: string | null; echoed: string }>((resolve) => {
    const socket = connect(unixPath);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (
        buffer.includes("\r\n\r\n") &&
        buffer.startsWith("HTTP/1.1 200") &&
        payload &&
        !buffer.includes(payload)
      ) {
        socket.write(payload);
      }
    });
    socket.on("close", () => {
      const status = buffer.split("\r\n")[0] ?? "";
      const decision = /X-Egress-Decision: (\S+)/.exec(buffer)?.[1] ?? null;
      const body = buffer.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      resolve({ status, decision, echoed: body });
    });
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    setTimeout(() => socket.end(), 500);
  });
}

/** El proxy real con un destino simulado: lo admitido se marca y lo rechazado nunca se marca. */
async function checkProxy(): Promise<Check[]> {
  const dir = mkdtempSync(join(tmpdir(), "sri-egress-verify-"));
  chmodSync(dir, 0o700);
  const dialed: string[] = [];
  const echo = createServer((socket) => socket.pipe(socket));
  await listenUnix(echo, join(dir, "echo.sock"));
  const dial: Dial = (host, port) => {
    dialed.push(`${host}:${port}`);
    return connect(join(dir, "echo.sock"));
  };
  const proxy = createEgressProxy({ dial });
  await listenUnix(proxy, join(dir, "egress.sock"));
  try {
    const allowed = await connectThrough(join(dir, "egress.sock"), "celcer.sri.gob.ec:443", "ping");
    const production = await connectThrough(join(dir, "egress.sock"), "cel.sri.gob.ec:443");
    const other = await connectThrough(join(dir, "egress.sock"), "example.com:443");
    return [
      {
        name: "proxy admite celcer:443",
        ok: allowed.status.includes("200") && allowed.echoed.includes("ping"),
        detail: allowed.status,
      },
      {
        name: "proxy bloquea Producción",
        ok:
          production.status.includes("403") && production.decision === "PRODUCTION_ACCESS_BLOCKED",
        detail: production.decision ?? production.status,
      },
      {
        name: "proxy bloquea otros destinos",
        ok: other.status.includes("403") && other.decision === "HOST_NOT_ALLOWED",
        detail: other.decision ?? other.status,
      },
      {
        name: "proxy solo marcó celcer:443",
        ok: dialed.length === 1 && dialed[0] === "celcer.sri.gob.ec:443",
        detail: dialed.join(","),
      },
    ];
  } finally {
    await closeServer(proxy);
    await closeServer(echo);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** El espacio de nombres de red, sin tráfico fuera de la máquina. */
function checkNamespace(): Check[] {
  const probe = spawnSync(
    "unshare",
    ["--user", "--map-root-user", "--net", "--", process.execPath, join(HERE, "probe.ts")],
    { encoding: "utf8", timeout: 20_000 },
  );
  if (probe.status !== 0) {
    return [
      {
        name: "namespace disponible",
        ok: false,
        detail: "unshare --user --net no está disponible: no se aplica la sesión",
      },
    ];
  }
  const result = JSON.parse(probe.stdout) as {
    interfaces: string[];
    directConnect: string;
    dns: string;
  };
  return [
    {
      name: "namespace solo con loopback",
      ok: result.interfaces.length === 1 && result.interfaces[0] === "lo",
      detail: result.interfaces.join(","),
    },
    {
      name: "namespace sin ruta a la red",
      ok: result.directConnect !== "CONNECTED",
      detail: result.directConnect,
    },
    { name: "namespace sin DNS", ok: result.dns !== "RESOLVED", detail: result.dns },
  ];
}

const outsideRepository = (path: string) => {
  const real = realpathSync(path);
  return !(real === REPO || real.startsWith(REPO + sep));
};

function checkEnvFile(file: string, pgPort: number): Check[] {
  const mode = statSync(file).mode & 0o777;
  const checks: Check[] = [
    { name: "archivo de entorno fuera del repositorio", ok: outsideRepository(file), detail: "" },
    {
      name: "archivo de entorno con permisos 600",
      ok: (mode & 0o077) === 0,
      detail: mode.toString(8),
    },
  ];
  return [
    ...checks,
    ...checkSessionEnv(parseEnvFile(readFileSync(file, "utf8")), pgPort).map((c: EnvCheck) => ({
      ...c,
    })),
  ];
}

export async function runVerify(options: {
  envFile?: string;
  pg?: string;
}): Promise<{ ok: boolean; checks: Check[] }> {
  const pg = parsePg(options.pg);
  const checks = [
    ...checkPolicy(),
    ...(await checkProxy()),
    ...checkNamespace(),
    ...(options.envFile ? checkEnvFile(options.envFile, pg.port) : []),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

type State = { supervisorPid: number; childPid: number | null; apiPort: number; startedAt: string };

const alive = (pid: number | null) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function apply(args: string[], command: string[]) {
  const stateDir = option(args, "--state-dir");
  const envFile = option(args, "--backend-env-file");
  const apiPort = Number(option(args, "--api-port"));
  const pg = parsePg(option(args, "--pg"));
  if (!stateDir || !envFile || !apiPort || command.length === 0)
    throw new Error(
      "apply necesita --state-dir, --backend-env-file, --api-port y el comando de la aplicación",
    );
  const statePath = join(stateDir, "state.json");
  if (existsSync(statePath)) {
    const previous = JSON.parse(readFileSync(statePath, "utf8")) as State;
    if (alive(previous.supervisorPid))
      throw new Error("ya hay una sesión activa en ese directorio");
  }

  // Falla cerrada: sin todas las comprobaciones en verde no arranca nada.
  const verified = await runVerify({ envFile, pg: `${pg.host}:${pg.port}` });
  if (!verified.ok) {
    console.error(
      JSON.stringify(
        { stop: "VERIFY_FAILED", failed: verified.checks.filter((c) => !c.ok) },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  const log = join(stateDir, "egress.log");
  const proxy = createEgressProxy({
    log: (entry) => appendFileSync(log, `${JSON.stringify(entry)}\n`, { mode: 0o600 }),
  });
  const servers: Server[] = [
    await listenUnix(proxy, join(stateDir, "egress.sock")),
    await relayUnixToTcp(join(stateDir, "pg.sock"), pg.host, pg.port),
    await relayTcpToUnix(apiPort, join(stateDir, "api.sock")),
  ];

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    ...parseEnvFile(readFileSync(envFile, "utf8")),
  };
  const child = spawn(
    "unshare",
    [
      "--user",
      "--map-root-user",
      "--net",
      "--kill-child",
      "--",
      process.execPath,
      join(HERE, "inside.ts"),
      "--state-dir",
      stateDir,
      "--api-port",
      String(apiPort),
      "--pg-port",
      String(pg.port),
      "--",
      ...command,
    ],
    { stdio: "inherit", env },
  );
  const state: State = {
    supervisorPid: process.pid,
    childPid: child.pid ?? null,
    apiPort,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(JSON.stringify({ session: "APPLIED", apiPort, allowed: "celcer.sri.gob.ec:443" }));

  let stopping = false;
  const teardown = async (code: number) => {
    if (stopping) return;
    stopping = true;
    if (alive(child.pid ?? null)) child.kill("SIGTERM");
    await Promise.all(servers.map(closeServer));
    for (const name of ["egress.sock", "pg.sock", "api.sock"])
      rmSync(join(stateDir, name), { force: true });
    rmSync(statePath, { force: true });
    console.log(JSON.stringify({ session: "ROLLED_BACK" }));
    process.exit(code);
  };
  // Si el proxy falla, la sesión termina: el proceso aislado se queda sin salida.
  proxy.on("error", () => void teardown(1));
  child.on("exit", (code) => void teardown(code ?? 1));
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => void teardown(0));
}

function status(args: string[]) {
  const stateDir = option(args, "--state-dir");
  if (!stateDir) throw new Error("status necesita --state-dir");
  const statePath = join(stateDir, "state.json");
  if (!existsSync(statePath)) return { session: "NOT_RUNNING" };
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
  return {
    session: alive(state.supervisorPid) ? "RUNNING" : "STALE",
    supervisor: alive(state.supervisorPid),
    isolatedProcess: alive(state.childPid),
    apiPort: state.apiPort,
    startedAt: state.startedAt,
  };
}

async function rollback(args: string[]) {
  const stateDir = option(args, "--state-dir");
  if (!stateDir) throw new Error("rollback necesita --state-dir");
  const statePath = join(stateDir, "state.json");
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
    for (const pid of [state.supervisorPid, state.childPid])
      if (pid && alive(pid)) process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 10_000;
    while ((alive(state.supervisorPid) || alive(state.childPid)) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 200));
    for (const pid of [state.supervisorPid, state.childPid])
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
  }
  for (const name of ["egress.sock", "pg.sock", "api.sock", "state.json"])
    rmSync(join(stateDir, name), { force: true });
  // Nada global que revertir: la sesión nunca cambió el firewall ni la red del anfitrión.
  return { session: "ROLLED_BACK", leftoverState: existsSync(statePath) };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const separator = rest.indexOf("--");
  const args = separator < 0 ? rest : rest.slice(0, separator);
  const appCommand = separator < 0 ? [] : rest.slice(separator + 1);
  if (command === "verify") {
    const result = await runVerify({
      envFile: option(args, "--backend-env-file"),
      pg: option(args, "--pg"),
    });
    const output = {
      verify: result.ok ? "PASS" : "FAIL",
      at: new Date().toISOString(),
      checks: result.checks,
    };
    const out = option(args, "--out");
    if (out) writeFileSync(out, JSON.stringify(output, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(output, null, 2));
    process.exit(result.ok ? 0 : 1);
  }
  if (command === "apply") return apply(args, appCommand);
  if (command === "status") return console.log(JSON.stringify(status(args)));
  if (command === "rollback") return console.log(JSON.stringify(await rollback(args)));
  console.error(
    "uso: session.ts verify | apply | status | rollback (ver docs/quality/sri-egress-allowlist.md)",
  );
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ stop: "SESSION_FAILED", error: String(error) }));
    process.exit(1);
  });
}
