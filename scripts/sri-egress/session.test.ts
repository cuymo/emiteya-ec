// Sesión de certificación aislada, de punta a punta y sin red (docs/quality/sri-egress-allowlist.md).
// Una aplicación de prueba corre dentro del espacio de nombres y comprueba:
// - que pedir Producción por el proxy queda bloqueado, sin DNS ni conexión;
// - que una conexión directa no tiene ruta;
// - que la base de datos llega por su puente, a un servidor falso del anfitrión.
// No se contacta ningún host del SRI ni de Internet. Sin espacios de nombres de usuario sin
// privilegios (por ejemplo, en algunos runners de CI), la prueba se omite de forma explícita.
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

const fakeApp = (apiPort: number, pgPort: number) => `
import { createServer, connect } from "node:net";
import { createServer as http } from "node:http";
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

describe.skipIf(!namespaces)("sesión de certificación aislada (sin red)", () => {
  const dir = mkdtempSync(join(tmpdir(), "sri-egress-session-"));
  const stateDir = join(dir, "state");
  let pgPort: number;
  let apiPort: number;
  let fakeDatabase: Server;
  let session: ChildProcess;
  let output = "";

  beforeAll(async () => {
    chmodSync(dir, 0o700);
    pgPort = await freePort();
    apiPort = await freePort();
    fakeDatabase = createServer((socket) => socket.end("fake-pg"));
    await new Promise<void>((resolve) => fakeDatabase.listen(pgPort, "127.0.0.1", resolve));
    const envFile = join(dir, "cert.env");
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
    writeFileSync(join(dir, "app.mjs"), fakeApp(apiPort, pgPort));
    session = spawn(
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
        join(dir, "app.mjs"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    session.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    session.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ok = await fetch(`http://127.0.0.1:${apiPort}/`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`la sesión no arrancó:\n${output}`);
  }, 60_000);

  afterAll(async () => {
    spawnSync(process.execPath, [SESSION, "rollback", "--state-dir", stateDir]);
    await new Promise((resolve) => fakeDatabase.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it("dentro: Producción bloqueada, sin ruta directa, base de datos por su puente", async () => {
    const result = (await (await fetch(`http://127.0.0.1:${apiPort}/`)).json()) as Record<
      string,
      string
    >;
    expect(result).toEqual({
      production: "BLOCKED",
      direct: "ENETUNREACH",
      database: "fake-pg",
      proxy: "http://127.0.0.1:3128",
    });
    const log = readFileSync(join(stateDir, "egress.log"), "utf8")
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
  }, 30_000);

  it("rollback detiene todo y no deja estado ni sockets", async () => {
    const result = spawnSync(process.execPath, [SESSION, "rollback", "--state-dir", stateDir], {
      encoding: "utf8",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      session: "ROLLED_BACK",
      leftoverState: false,
    });
    const deadline = Date.now() + 10_000;
    while (session.exitCode === null && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(session.exitCode).not.toBeNull();
    for (const name of ["egress.sock", "pg.sock", "api.sock", "state.json"])
      expect(existsSync(join(stateDir, name)), name).toBe(false);
    const after = await fetch(`http://127.0.0.1:${apiPort}/`).then(
      () => "UP",
      () => "DOWN",
    );
    expect(after).toBe("DOWN");
  }, 30_000);
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
