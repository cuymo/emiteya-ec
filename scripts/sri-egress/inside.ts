// Arranque dentro del espacio de nombres de red de la certificación
// (docs/quality/sri-egress-allowlist.md). Lo lanza `session.ts apply` con
// `unshare --user --map-root-user --net`.
// 1. Levanta loopback y exige que sea la única interfaz.
// 2. Abre los puentes locales: el proxy de salida, la base de datos y la API.
// 3. Arranca el proceso de la aplicación con el proxy como única salida.
// Si algo falla, no arranca nada y sale con error (falla cerrada).
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { closeServer, relayTcpToUnix, relayUnixToTcp } from "./relay.ts";

export const PROXY_PORT = 3128;

/** Interfaces del espacio de nombres de red del proceso actual. */
export function namespaceInterfaces(): string[] {
  return readFileSync("/proc/self/net/dev", "utf8")
    .split("\n")
    .slice(2)
    .map((line) => line.split(":")[0]!.trim())
    .filter(Boolean);
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`falta ${name}`);
  return args[index + 1]!;
}

async function main() {
  const separator = process.argv.indexOf("--");
  const args = process.argv.slice(2, separator < 0 ? undefined : separator);
  const command = separator < 0 ? [] : process.argv.slice(separator + 1);
  const stateDir = option(args, "--state-dir");
  const apiPort = Number(option(args, "--api-port"));
  const pgPort = Number(option(args, "--pg-port"));
  if (command.length === 0) throw new Error("falta el comando de la aplicación");

  execFileSync("ip", ["link", "set", "lo", "up"]);
  const interfaces = namespaceInterfaces();
  if (interfaces.length !== 1 || interfaces[0] !== "lo") {
    console.error(JSON.stringify({ stop: "NETWORK_NAMESPACE_NOT_ISOLATED", interfaces }));
    process.exit(3);
  }

  const relays = [
    await relayTcpToUnix(PROXY_PORT, join(stateDir, "egress.sock")),
    await relayTcpToUnix(pgPort, join(stateDir, "pg.sock")),
    await relayUnixToTcp(join(stateDir, "api.sock"), "127.0.0.1", apiPort),
  ];
  const proxy = `http://127.0.0.1:${PROXY_PORT}`;
  const child = spawn(command[0]!, command.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy,
      NO_PROXY: "",
    },
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => {
    void Promise.all(relays.map(closeServer)).then(() => process.exit(code ?? (signal ? 1 : 0)));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ stop: "INSIDE_START_FAILED", error: String(error) }));
    process.exit(2);
  });
}
