// Build de `verify` con el destino interno explícito (harden-production-configuration-and-clock-
// ownership, design D5): el comando, el entorno y la paridad del resultado, con un proceso simulado.
import { describe, expect, it } from "vitest";
import { run, VERIFICATION_API_INTERNAL_URL } from "./build-for-verification.ts";

type Call = { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };

function simulated(result: { status: number | null; signal?: NodeJS.Signals; error?: Error }) {
  const calls: Call[] = [];
  const errors: string[] = [];
  const code = run({
    root: "/raiz",
    env: { PATH: "/bin", API_INTERNAL_URL: "http://otro.interno:9" },
    spawn: (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return { status: result.status, signal: result.signal ?? null, error: result.error };
    },
    err: (line) => errors.push(line),
  });
  return { code, calls, errors };
}

describe("build de verificación", () => {
  it("ejecuta corepack pnpm build sin shell, con el destino de bucle local explícito", () => {
    const { code, calls, errors } = simulated({ status: 0 });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).toEqual([
      {
        command: "corepack",
        args: ["pnpm", "build"],
        cwd: "/raiz",
        env: { PATH: "/bin", API_INTERNAL_URL: VERIFICATION_API_INTERNAL_URL },
      },
    ]);
    expect(VERIFICATION_API_INTERNAL_URL).toBe("http://127.0.0.1:4000");
  });

  it("devuelve el código del build, y un error o una señal nunca son un éxito", () => {
    expect(simulated({ status: 2 }).code).toBe(2);
    const signaled = simulated({ status: null, signal: "SIGTERM" });
    expect(signaled.code).toBe(1);
    expect(signaled.errors).toEqual(["build:verification: el build terminó por la señal SIGTERM."]);
    const failed = simulated({ status: null, error: new Error("spawn corepack ENOENT") });
    expect(failed.code).toBe(1);
    expect(failed.errors).toEqual([
      "build:verification: no se pudo ejecutar el build (spawn corepack ENOENT).",
    ]);
    expect(simulated({ status: null }).code).toBe(1);
  });
});
