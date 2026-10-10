// Ciclo de vida de los procesos de una sesión de certificación aislada
// (docs/quality/sri-egress-allowlist.md; fix-sri-egress-rollback-process-cleanup, design D1 a D4).
// - Un proceso es de la sesión si arrancó con `SRI_EGRESS_SESSION_ID=<id>` en su entorno, o si
//   comparte el espacio de nombres de red de uno de esos procesos y ese espacio no es el del anfitrión.
// - El supervisor no lleva el identificador: se reconoce por su PID con el mismo instante de arranque.
// - Nunca se compara el nombre de un proceso ni se señala un proceso ajeno.
// La detención es ordenada: primero la aplicación, con la salida todavía abierta; luego el lanzador y
// el supervisor; al final SIGKILL. Termina con una nueva búsqueda, y lo que siga vivo se informa.
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

export const SESSION_ID_VARIABLE = "SRI_EGRESS_SESSION_ID";

export type ProcessRef = Readonly<{ pid: number; start: string }>;
export type Role = "app" | "inside" | "launcher" | "supervisor";
export type SessionProcess = Readonly<{ pid: number; start: string; role: Role }>;
export type RemainingProcess = SessionProcess & Readonly<{ reason: string }>;
export type ProcessInfo = Readonly<{ start: string; state: string; comm: string }>;

/** Acceso a la tabla de procesos; se inyecta en las pruebas. */
export type ProcessTable = {
  pids(): number[];
  /** null si el proceso no existe o no se puede leer. */
  info(pid: number): ProcessInfo | null;
  environ(pid: number): string[] | null;
  cmdline(pid: number): string[] | null;
  netns(pid: number): string | null;
  hostNetns(): string | null;
  /** Lanza un error con `code` (`ESRCH`, `EPERM`) si la señal no se pudo enviar. */
  signal(pid: number, signal: NodeJS.Signals): void;
};

const read = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/** Campos de /proc/<pid>/stat: el nombre va entre paréntesis y puede tener espacios. */
export function parseStat(stat: string): ProcessInfo {
  const close = stat.lastIndexOf(")");
  const comm = stat.slice(stat.indexOf("(") + 1, close);
  const fields = stat.slice(close + 2).split(" ");
  return { comm, state: fields[0]!, start: fields[19]! };
}

export const procTable: ProcessTable = {
  pids: () =>
    readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .map(Number),
  info: (pid) => read(() => parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"))),
  environ: (pid) => read(() => readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")),
  cmdline: (pid) => read(() => readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")),
  netns: (pid) => read(() => readlinkSync(`/proc/${pid}/ns/net`)),
  hostNetns: () => read(() => readlinkSync("/proc/self/ns/net")),
  signal: (pid, signal) => process.kill(pid, signal),
};

/** Instante de arranque de un proceso propio, para guardarlo en el estado de la sesión. */
export const processRef = (table: ProcessTable, pid: number): ProcessRef | null => {
  const info = table.info(pid);
  return info ? { pid, start: info.start } : null;
};

/** El mismo proceso sigue vivo: el PID existe, con el mismo instante de arranque y sin ser zombi. */
export function sameProcessAlive(table: ProcessTable, ref: ProcessRef): boolean {
  const info = table.info(ref.pid);
  return info !== null && info.state !== "Z" && info.start === ref.start;
}

function roleOf(table: ProcessTable, pid: number, info: ProcessInfo): Role {
  if (info.comm === "unshare") return "launcher";
  if ((table.cmdline(pid) ?? []).some((arg) => arg.endsWith("/inside.ts"))) return "inside";
  return "app";
}

export type SessionQuery = Readonly<{
  sessionId: string;
  supervisor?: ProcessRef | null;
  /** PID que nunca se incluyen, por ejemplo el del supervisor que se está cerrando. */
  exclude?: readonly number[];
}>;

/** Los procesos vivos de la sesión, con su papel. */
export function findSessionProcesses(table: ProcessTable, query: SessionQuery): SessionProcess[] {
  const token = `${SESSION_ID_VARIABLE}=${query.sessionId}`;
  const exclude = new Set(query.exclude ?? []);
  const live = (pid: number) => {
    const info = table.info(pid);
    return info && info.state !== "Z" ? info : null;
  };
  const members = new Map<number, ProcessInfo>();
  const pids = table.pids().filter((pid) => !exclude.has(pid));
  for (const pid of pids) {
    if (!(table.environ(pid) ?? []).includes(token)) continue;
    const info = live(pid);
    if (info) members.set(pid, info);
  }
  // El espacio de red solo se toma de un proceso vivo con el identificador, nunca de un número
  // guardado: un número de un espacio ya liberado se puede reutilizar.
  const host = table.hostNetns();
  const namespaces = new Set(
    [...members.keys()]
      .map((pid) => table.netns(pid))
      .filter((ns): ns is string => ns !== null && ns !== host),
  );
  if (namespaces.size > 0) {
    for (const pid of pids) {
      if (members.has(pid)) continue;
      const ns = table.netns(pid);
      if (ns === null || !namespaces.has(ns)) continue;
      const info = live(pid);
      if (info) members.set(pid, info);
    }
  }
  const found: SessionProcess[] = [...members].map(([pid, info]) => ({
    pid,
    start: info.start,
    role: roleOf(table, pid, info),
  }));
  const supervisor = query.supervisor;
  if (
    supervisor &&
    !exclude.has(supervisor.pid) &&
    !members.has(supervisor.pid) &&
    sameProcessAlive(table, supervisor)
  )
    found.push({ pid: supervisor.pid, start: supervisor.start, role: "supervisor" });
  return found;
}

export type TerminateOptions = SessionQuery &
  Readonly<{
    /** Cierre ordenado de la aplicación: el backend espera hasta 8 s los jobs en curso. */
    graceMs?: number;
    termMs?: number;
    killMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  }>;

export type TerminateOutcome = Readonly<{
  stopped: SessionProcess[];
  remaining: RemainingProcess[];
}>;

/**
 * Detiene la sesión en orden y lo verifica:
 * 1. SIGTERM a la aplicación y a sus descendientes, con la salida abierta;
 * 2. SIGTERM al lanzador (`inside.ts` y `unshare`) y al supervisor;
 * 3. SIGKILL a lo que quede.
 * Devuelve lo detenido y lo que sigue vivo con su motivo.
 */
export async function terminateSession(
  table: ProcessTable,
  options: TerminateOptions,
): Promise<TerminateOutcome> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? 100;
  const errors = new Map<number, string>();
  const seen = new Map<number, SessionProcess>();

  const scan = () => {
    const found = findSessionProcesses(table, options);
    for (const entry of found) if (!seen.has(entry.pid)) seen.set(entry.pid, entry);
    return found;
  };
  const send = (targets: readonly SessionProcess[], signal: NodeJS.Signals) => {
    for (const target of targets) {
      // Se verifica justo antes de la señal: el PID podría haberse reutilizado.
      if (!sameProcessAlive(table, target)) continue;
      try {
        table.signal(target.pid, signal);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") errors.set(target.pid, code ?? "SIGNAL_FAILED");
      }
    }
  };
  const waitUntilGone = async (pending: () => readonly SessionProcess[], ms: number) => {
    const deadline = now() + ms;
    while (pending().length > 0 && now() < deadline) await sleep(pollMs);
  };
  const byRole = (role: Role) => () => scan().filter((entry) => entry.role === role);

  send(byRole("app")(), "SIGTERM");
  await waitUntilGone(byRole("app"), options.graceMs ?? 20_000);

  for (const role of ["inside", "launcher", "supervisor"] as const) send(byRole(role)(), "SIGTERM");
  await waitUntilGone(scan, options.termMs ?? 10_000);

  send(scan(), "SIGKILL");
  await waitUntilGone(scan, options.killMs ?? 5_000);

  const remaining = scan().map((entry) => ({
    ...entry,
    reason: errors.get(entry.pid) ?? "STILL_ALIVE",
  }));
  const left = new Set(remaining.map((entry) => entry.pid));
  return {
    stopped: [...seen.values()].filter((entry) => !left.has(entry.pid)),
    remaining,
  };
}
