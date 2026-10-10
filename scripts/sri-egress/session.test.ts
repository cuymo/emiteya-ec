// Sesión de certificación aislada, de punta a punta y sin red (docs/quality/sri-egress-allowlist.md).
// Una aplicación de prueba corre dentro del espacio de nombres y comprueba:
// - que pedir Producción por el proxy queda bloqueado, sin DNS ni conexión;
// - que una conexión directa no tiene ruta;
// - que la base de datos llega por su puente, a un servidor falso del anfitrión.
// `rollback` deja sin vida todo proceso de la sesión, también una aplicación que sobrevivió a su
// supervisor, y no toca un proceso ajeno. No se contacta ningún host del SRI ni de Internet. Sin
// espacios de nombres de usuario sin privilegios (por ejemplo, en algunos runners de CI), la prueba se
// omite de forma explícita.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runVerify } from "./session.ts";

const SESSION = new URL("./session.ts", import.meta.url).pathname;
const namespaces =
  spawnSync("unshare", ["--user", "--map-root-user", "--net", "--", "true"]).status === 0;

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Instante de arranque del proceso (campo 22 de /proc/<pid>/stat); null si ya no existe. */
function startOf(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19]!;
  } catch {
    return null;
  }
}

/** El mismo proceso sigue vivo: el PID existe con el mismo instante de arranque. */
const sameProcessAlive = (pid: number, start: string) => startOf(pid) === start;

async function until(condition: () => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await wait(100);
  return condition();
}

const fakeApp = (apiPort: number, pgPort: number, pidFile: string) => `
import { createServer, connect } from "node:net";
import { createServer as http } from "node:http";
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const blocked = () => fetch("https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline").then(() => "REACHED", () => "BLOCKED");
const direct = () => new Promise((resolve) => {
  const s = connect({ host: "192.0.2.1", port: 443, timeout: 3000 });
  s.once("connect", () => { s.destroy(); resolve("CONNECTED"); });
  s.once("timeout", () => { s.destroy(); resolve("TIMEOUT"); });
  s.once("error", (e) => resolve(e.code));
});
const database = () => new Promise((resolve) => {
  const s = connect(${pgPort}, "127.0.0.1");
  s.once("data", (d) => { resolve(d.toString()); s.destroy(); });
  s.once("error", (e) => resolve(e.code));
});
http(async (req, res) => {
  res.end(JSON.stringify({ production: await blocked(), direct: await direct(), database: await database(), proxy: process.env.HTTPS_PROXY }));
}).listen(${apiPort}, "127.0.0.1");
`;

type Session = {
  stateDir: string;
  apiPort: number;
  supervisor: ChildProcess;
  app: { pid: number; start: string };
  output: () => string;
};

const run = (...args: string[]) =>
  spawnSync(process.execPath, [SESSION, ...args], { encoding: "utf8", timeout: 60_000 });

describe.skipIf(!namespaces)("sesión de certificación aislada (sin red)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sri-egress-session-"));
  const envFile = join(dir, "cert.env");
  let pgPort: number;
  let fakeDatabase: Server;
  let unrelated: ChildProcess;
  const sessions: Session[] = [];

  async function startSession(name: string): Promise<Session> {
    const stateDir = join(dir, `${name}-state`);
    const apiPort = await freePort();
    const pidFile = join(dir, `${name}-app.pid`);
    writeFileSync(join(dir, `${name}-app.mjs`), fakeApp(apiPort, pgPort, pidFile));
    const supervisor = spawn(
      process.execPath,
      [
        SESSION,
        "apply",
        "--state-dir",
        stateDir,
        "--backend-env-file",
        envFile,
        "--api-port",
        String(apiPort),
        "--pg",
        `127.0.0.1:${pgPort}`,
        "--",
        process.execPath,
        join(dir, `${name}-app.mjs`),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    supervisor.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    supervisor.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ok = await fetch(`http://127.0.0.1:${apiPort}/`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok && existsSync(pidFile)) {
        const pid = Number(readFileSync(pidFile, "utf8"));
        const session = {
          stateDir,
          apiPort,
          supervisor,
          app: { pid, start: startOf(pid)! },
          output: () => output,
        };
        sessions.push(session);
        return session;
      }
      await wait(250);
    }
    throw new Error(`la sesión ${name} no arrancó:\n${output}`);
  }

  beforeAll(async () => {
    chmodSync(dir, 0o700);
    pgPort = await freePort();
    fakeDatabase = createServer((socket) => socket.end("fake-pg"));
    await new Promise<void>((resolve) => fakeDatabase.listen(pgPort, "127.0.0.1", resolve));
    writeFileSync(
      envFile,
      [
        `DATABASE_URL=postgresql://cert:clave@127.0.0.1:${pgPort}/facturador`,
        "SRI_TRANSMISSION_ENABLED=0",
        "SRI_ENDPOINT_PRODUCTION_RECEPTION=https://127.0.0.1:9/cerrado",
        "SRI_ENDPOINT_PRODUCTION_AUTHORIZATION=https://127.0.0.1:9/cerrado",
        "SRI_ENDPOINT_PRODUCTION_VALIDITY=https://127.0.0.1:9/cerrado",
      ].join("\n"),
      { mode: 0o600 },
    );
    // Un proceso ajeno a toda sesión: rollback nunca lo toca.
    unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  }, 60_000);

  afterAll(async () => {
    for (const session of sessions) run("rollback", "--state-dir", session.stateDir);
    // Higiene: ninguna aplicación de prueba sobrevive a la prueba, aunque una aserción haya fallado.
    for (const { app } of sessions)
      if (sameProcessAlive(app.pid, app.start)) process.kill(app.pid, "SIGKILL");
    unrelated.kill("SIGKILL");
    await new Promise((resolve) => fakeDatabase.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it("dentro: Producción bloqueada, sin ruta directa, base de datos por su puente", async () => {
    const session = await startSession("normal");
    const result = (await (await fetch(`http://127.0.0.1:${session.apiPort}/`)).json()) as Record<
      string,
      string
    >;
    expect(result).toEqual({
      production: "BLOCKED",
      direct: "ENETUNREACH",
      database: "fake-pg",
      proxy: "http://127.0.0.1:3128",
    });
    const log = readFileSync(join(session.stateDir, "egress.log"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(log).toContainEqual(
      expect.objectContaining({
        host: "cel.sri.gob.ec",
        allowed: false,
        reason: "PRODUCTION_ACCESS_BLOCKED",
      }),
    );
    expect(log.some((entry) => entry.allowed === true)).toBe(false);
    expect(JSON.parse(run("status", "--state-dir", session.stateDir).stdout)).toMatchObject({
      session: "RUNNING",
      supervisor: true,
      launcher: true,
      isolatedProcess: true,
      app: true,
    });
  }, 60_000);

  it("rollback detiene la aplicación, el lanzador y el supervisor, y no deja estado ni sockets", async () => {
    const session = sessions.find((s) => s.stateDir.endsWith("normal-state"))!;
    const result = run("rollback", "--state-dir", session.stateDir);
    expect(JSON.parse(result.stdout)).toMatchObject({
      session: "ROLLED_BACK",
      leftoverProcesses: 0,
      leftoverState: false,
    });
    expect(result.status).toBe(0);
    expect(await until(() => session.supervisor.exitCode !== null, 10_000)).toBe(true);
    expect(sameProcessAlive(session.app.pid, session.app.start), "aplicación viva").toBe(false);
    for (const name of ["egress.sock", "pg.sock", "api.sock", "state.json"])
      expect(existsSync(join(session.stateDir, name)), name).toBe(false);
    expect(existsSync(join(session.stateDir, "egress.log")), "evidencia").toBe(true);
    const after = await fetch(`http://127.0.0.1:${session.apiPort}/`).then(
      () => "UP",
      () => "DOWN",
    );
    expect(after).toBe("DOWN");
    // Idempotente: repetirlo no falla ni encuentra nada.
    const again = run("rollback", "--state-dir", session.stateDir);
    expect(again.status).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({ session: "ROLLED_BACK", stopped: [] });
    expect(unrelated.exitCode).toBeNull();
    expect(unrelated.signalCode).toBeNull();
  }, 60_000);

  it("una aplicación que sobrevivió a su supervisor y su lanzador: status la detecta y rollback la detiene", async () => {
    const session = await startSession("orphan");
    const state = JSON.parse(readFileSync(join(session.stateDir, "state.json"), "utf8")) as {
      supervisor?: { pid: number };
      launcher?: { pid: number };
      supervisorPid?: number;
      childPid?: number;
    };
    // El defecto encontrado: sin supervisor ni lanzador, la aplicación quedaba huérfana.
    process.kill(state.supervisor?.pid ?? state.supervisorPid!, "SIGKILL");
    process.kill(state.launcher?.pid ?? state.childPid!, "SIGKILL");
    expect(
      await until(
        () => session.supervisor.exitCode !== null || session.supervisor.signalCode !== null,
        10_000,
      ),
    ).toBe(true);
    expect(sameProcessAlive(session.app.pid, session.app.start), "huérfana").toBe(true);
    expect(JSON.parse(run("status", "--state-dir", session.stateDir).stdout)).toMatchObject({
      session: "STALE",
      supervisor: false,
      app: true,
    });
    const result = run("rollback", "--state-dir", session.stateDir);
    expect(JSON.parse(result.stdout)).toMatchObject({
      session: "ROLLED_BACK",
      leftoverProcesses: 0,
    });
    expect(result.status).toBe(0);
    expect(sameProcessAlive(session.app.pid, session.app.start), "aplicación viva").toBe(false);
    expect(existsSync(join(session.stateDir, "state.json"))).toBe(false);
    expect(unrelated.exitCode).toBeNull();
  }, 60_000);
});

describe("verify sin red", () => {
  it("falla cerrada si el entorno no sobrescribe Producción", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sri-egress-verify-env-"));
    try {
      const envFile = join(dir, "cert.env");
      writeFileSync(
        envFile,
        "DATABASE_URL=postgresql://u:p@127.0.0.1:5432/x\nSRI_TRANSMISSION_ENABLED=0\n",
        { mode: 0o600 },
      );
      const result = await runVerify({ envFile });
      expect(result.ok).toBe(false);
      expect(
        result.checks
          .filter((c) => !c.ok)
          .map((c) => c.detail)
          .join(" "),
      ).toContain("PRODUCTION_ACCESS_BLOCKED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
