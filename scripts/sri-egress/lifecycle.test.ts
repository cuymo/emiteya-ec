// Ciclo de vida de los procesos de la sesión, con una tabla de procesos simulada
// (fix-sri-egress-rollback-process-cleanup, design D8). Sin procesos reales ni red.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findSessionProcesses,
  parseStat,
  SESSION_ID_VARIABLE,
  terminateSession,
  type ProcessTable,
} from "./lifecycle.ts";
import { rollbackSession, sessionStatus } from "./session.ts";

const ID = "0123456789abcdef0123456789abcdef";
const TOKEN = `${SESSION_ID_VARIABLE}=${ID}`;
const HOST_NS = "net:[4026531840]";
const SESSION_NS = "net:[4026532999]";

type FakeProcess = {
  start: string;
  comm?: string;
  cmdline?: string[];
  env?: string[];
  netns?: string;
  state?: string;
  /** Lo que hace ante la señal: termina (por defecto) o la ignora, como un proceso bloqueado. */
  onTerm?: "exit" | "ignore";
  onKill?: "exit" | "ignore";
  /** La señal falla con este código (`EPERM`). */
  signalError?: string;
  /** Termina justo antes de recibir la señal: la señal da `ESRCH`. */
  vanishOnSignal?: boolean;
};

function fakeTable(processes: Record<number, FakeProcess>) {
  const live = new Map(Object.entries(processes).map(([pid, p]) => [Number(pid), { ...p }]));
  const signals: [number, NodeJS.Signals][] = [];
  const error = (code: string) => Object.assign(new Error(code), { code });
  const table: ProcessTable = {
    pids: () => [...live.keys()],
    info: (pid) => {
      const p = live.get(pid);
      return p ? { start: p.start, state: p.state ?? "S", comm: p.comm ?? "node" } : null;
    },
    environ: (pid) => live.get(pid)?.env ?? (live.has(pid) ? [] : null),
    cmdline: (pid) => live.get(pid)?.cmdline ?? (live.has(pid) ? ["node"] : null),
    netns: (pid) => live.get(pid)?.netns ?? (live.has(pid) ? HOST_NS : null),
    hostNetns: () => HOST_NS,
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      const p = live.get(pid);
      if (!p) throw error("ESRCH");
      if (p.vanishOnSignal) {
        live.delete(pid);
        throw error("ESRCH");
      }
      if (p.signalError) throw error(p.signalError);
      const behavior = signal === "SIGKILL" ? (p.onKill ?? "exit") : (p.onTerm ?? "exit");
      if (behavior === "exit") live.delete(pid);
    },
  };
  return { table, signals, live };
}

/** Reloj simulado: las esperas no duermen de verdad. */
function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

const supervisor = { pid: 100, start: "1000" };
const sessionProcesses = (): Record<number, FakeProcess> => ({
  100: { start: "1000", cmdline: ["node", "/repo/scripts/sri-egress/session.ts", "apply"] },
  101: { start: "1001", comm: "unshare", env: [TOKEN], netns: SESSION_NS },
  102: {
    start: "1002",
    cmdline: ["node", "/repo/scripts/sri-egress/inside.ts"],
    env: [TOKEN],
    netns: SESSION_NS,
  },
  103: { start: "1003", cmdline: ["node", "backend/src/main.ts"], env: [TOKEN], netns: SESSION_NS },
  // Un descendiente que limpió su entorno: se reconoce por el espacio de red de la sesión.
  104: { start: "1004", cmdline: ["helper"], env: [], netns: SESSION_NS },
});

describe("procesos de la sesión", () => {
  it("lee el instante de arranque de /proc/<pid>/stat aunque el nombre tenga espacios", () => {
    const fields = Array.from({ length: 20 }, (_, i) => String(i));
    fields[0] = "S";
    fields[19] = "987654";
    expect(parseStat(`42 (node (main) x) ${fields.join(" ")}`)).toEqual({
      comm: "node (main) x",
      state: "S",
      start: "987654",
    });
  });

  it("reconoce cada papel por el identificador, el espacio de red y el supervisor verificado", () => {
    const { table } = fakeTable(sessionProcesses());
    const found = findSessionProcesses(table, { sessionId: ID, supervisor });
    expect(found.map((p) => [p.pid, p.role]).sort()).toEqual([
      [100, "supervisor"],
      [101, "launcher"],
      [102, "inside"],
      [103, "app"],
      [104, "app"],
    ]);
  });
});

describe("detención de la sesión", () => {
  it("A: sesión normal, primero la aplicación y al final nada vivo", async () => {
    const { table, signals, live } = fakeTable(sessionProcesses());
    const outcome = await terminateSession(table, { sessionId: ID, supervisor, ...clock() });
    expect(outcome.remaining).toEqual([]);
    expect(outcome.stopped.map((p) => p.role).sort()).toEqual([
      "app",
      "app",
      "inside",
      "launcher",
      "supervisor",
    ]);
    expect(live.size).toBe(0);
    const firstOther = signals.findIndex(([pid]) => pid <= 102);
    const lastApp = signals.map(([pid]) => pid).lastIndexOf(104);
    expect(signals.slice(0, 2)).toEqual([
      [103, "SIGTERM"],
      [104, "SIGTERM"],
    ]);
    expect(lastApp).toBeLessThan(firstOther);
  });

  it("B: la aplicación que sobrevivió al supervisor y al lanzador se detiene", async () => {
    const { table, live } = fakeTable({
      103: { start: "1003", env: [TOKEN], netns: SESSION_NS },
    });
    const outcome = await terminateSession(table, { sessionId: ID, supervisor, ...clock() });
    expect(outcome).toEqual({
      stopped: [{ pid: 103, start: "1003", role: "app" }],
      remaining: [],
    });
    expect(live.size).toBe(0);
  });

  it("C: una sesión parcialmente detenida y un ESRCH en carrera terminan bien, y repetir no falla", async () => {
    const processes = sessionProcesses();
    delete processes[101];
    processes[102]!.vanishOnSignal = true;
    const { table, live } = fakeTable(processes);
    const first = await terminateSession(table, { sessionId: ID, supervisor, ...clock() });
    expect(first.remaining).toEqual([]);
    expect(live.size).toBe(0);
    const again = await terminateSession(table, { sessionId: ID, supervisor, ...clock() });
    expect(again).toEqual({ stopped: [], remaining: [] });
  });

  it("D: nunca señala un proceso ajeno, aunque se llame igual o use la misma ruta", async () => {
    const { table, signals, live } = fakeTable({
      ...sessionProcesses(),
      200: {
        start: "2000",
        env: [`${SESSION_ID_VARIABLE}=otra-sesion`],
        netns: "net:[4026533000]",
      },
      201: { start: "2001", comm: "unshare" },
      202: {
        start: "2002",
        cmdline: ["node", "/repo/scripts/sri-egress/inside.ts"],
        netns: "net:[4026533001]",
      },
      203: { start: "2003", cmdline: ["node", "backend/src/main.ts"] },
    });
    await terminateSession(table, { sessionId: ID, supervisor, ...clock() });
    expect(signals.filter(([pid]) => pid >= 200)).toEqual([]);
    expect([...live.keys()].sort()).toEqual([200, 201, 202, 203]);
  });

  it("E: una señal rechazada o un proceso que no muere quedan informados con su motivo", async () => {
    const { table } = fakeTable({
      103: { start: "1003", env: [TOKEN], netns: SESSION_NS, signalError: "EPERM" },
      105: { start: "1005", env: [TOKEN], netns: SESSION_NS, onTerm: "ignore", onKill: "ignore" },
    });
    const outcome = await terminateSession(table, { sessionId: ID, ...clock() });
    expect(outcome.stopped).toEqual([]);
    expect(outcome.remaining).toEqual([
      { pid: 103, start: "1003", role: "app", reason: "EPERM" },
      { pid: 105, start: "1005", role: "app", reason: "STILL_ALIVE" },
    ]);
  });

  it("un PID reutilizado del supervisor no se señala, y un zombi cuenta como terminado", async () => {
    const { table, signals } = fakeTable({
      100: { start: "9999" },
      103: { start: "1003", env: [TOKEN], netns: SESSION_NS, state: "Z" },
    });
    const outcome = await terminateSession(table, { sessionId: ID, supervisor, ...clock() });
    expect(outcome).toEqual({ stopped: [], remaining: [] });
    expect(signals).toEqual([]);
  });

  it("el supervisor que se cierra se excluye a sí mismo", async () => {
    const { table, live } = fakeTable(sessionProcesses());
    const outcome = await terminateSession(table, { sessionId: ID, exclude: [100], ...clock() });
    expect(outcome.remaining).toEqual([]);
    expect([...live.keys()]).toEqual([100]);
  });
});

describe("rollback de la sesión (estado y falla cerrada)", () => {
  const withStateDir = async (state: unknown, body: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "sri-egress-rollback-"));
    try {
      if (state !== null)
        writeFileSync(join(dir, "state.json"), JSON.stringify(state), { mode: 0o600 });
      writeFileSync(join(dir, "egress.log"), "", { mode: 0o600 });
      await body(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const timeouts = clock();
  const state = {
    version: 2,
    sessionId: ID,
    supervisor,
    launcher: null,
    apiPort: 4100,
    startedAt: "x",
  };

  it("E: si un proceso no se puede detener, informa ROLLBACK_INCOMPLETE y conserva el estado", async () => {
    await withStateDir(state, async (dir) => {
      const { table } = fakeTable({
        103: { start: "1003", env: [TOKEN], netns: SESSION_NS, onTerm: "ignore", onKill: "ignore" },
      });
      const result = await rollbackSession(dir, { table, timeouts });
      expect(result).toMatchObject({
        session: "ROLLBACK_INCOMPLETE",
        remaining: [{ pid: 103, role: "app", reason: "STILL_ALIVE" }],
        stateRetained: true,
      });
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toMatchObject({
        sessionId: ID,
      });
      expect(sessionStatus(dir, table)).toMatchObject({
        session: "STALE",
        app: true,
        supervisor: false,
      });
    });
  });

  it("con todo detenido borra el estado y conserva egress.log; sin estado es idempotente", async () => {
    await withStateDir(state, async (dir) => {
      const { table } = fakeTable(sessionProcesses());
      expect(await rollbackSession(dir, { table, timeouts })).toMatchObject({
        session: "ROLLED_BACK",
        leftoverProcesses: 0,
        leftoverState: false,
      });
      expect(existsSync(join(dir, "state.json"))).toBe(false);
      expect(existsSync(join(dir, "egress.log"))).toBe(true);
      expect(await rollbackSession(dir, { table, timeouts })).toEqual({
        session: "ROLLED_BACK",
        stopped: [],
        leftoverProcesses: 0,
        leftoverState: false,
      });
      expect(sessionStatus(dir, table)).toEqual({ session: "NOT_RUNNING" });
    });
  });

  it("rechaza el estado de la versión anterior sin señalar nada ni borrarlo", async () => {
    await withStateDir(
      { supervisorPid: 100, childPid: 101, apiPort: 4100, startedAt: "x" },
      async (dir) => {
        const { table, signals } = fakeTable(sessionProcesses());
        expect(await rollbackSession(dir, { table, timeouts })).toMatchObject({
          session: "ROLLBACK_INCOMPLETE",
          reason: "STATE_WITHOUT_SESSION_ID",
          stateRetained: true,
        });
        expect(signals).toEqual([]);
        expect(existsSync(join(dir, "state.json"))).toBe(true);
      },
    );
  });
});
