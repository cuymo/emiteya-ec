// Validación de OpenSpec con la CLI del repositorio (pin-openspec-ci-validation, design D2 y D6). Los
// contratos de resolución, entorno y resultado se prueban con una CLI simulada en raíces temporales;
// la resolución real, el PATH y la validación, con la CLI 1.14.0 instalada. Ningún artefacto inválido
// entra en el repositorio, y los node_modules reales no se tocan.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveOpenSpec, run, VALIDATE_ARGS } from "./openspec-validate.ts";

const REPO = join(import.meta.dirname, "..");
const SCRIPT = join(import.meta.dirname, "openspec-validate.ts");
let temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
  temporary = [];
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

/**
 * Una raíz temporal con una CLI simulada: escribe en FAKE_REPORT sus argumentos y su entorno, y
 * termina con FAKE_EXIT o por la señal FAKE_SIGNAL.
 */
function fakeRoot(options: { declared?: string; installed?: string | null } = {}): string {
  const root = tempDir("openspec-root-");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ devDependencies: { "@fission-ai/openspec": options.declared ?? "1.14.0" } }),
  );
  if (options.installed === null) return root;
  const pkg = join(root, "node_modules", "@fission-ai", "openspec");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  mkdirSync(join(pkg, "bin"));
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "@fission-ai/openspec",
      version: options.installed ?? "1.14.0",
      type: "module",
      exports: { ".": { default: "./dist/index.js" } },
      bin: { openspec: "./bin/openspec.js" },
    }),
  );
  writeFileSync(join(pkg, "dist", "index.js"), "export {};\n");
  writeFileSync(
    join(pkg, "bin", "openspec.js"),
    [
      'import { writeFileSync } from "node:fs";',
      "const env = process.env;",
      "if (env.FAKE_REPORT) writeFileSync(env.FAKE_REPORT, JSON.stringify({ args: process.argv.slice(2), telemetry: env.OPENSPEC_TELEMETRY, unrelated: env.UNRELATED_VAR }));",
      "if (env.FAKE_SIGNAL) process.kill(process.pid, env.FAKE_SIGNAL);",
      "process.exit(Number(env.FAKE_EXIT ?? 0));",
      "",
    ].join("\n"),
  );
  return root;
}

const quiet = { stdio: "pipe" as const, out: () => {}, err: () => {} };

describe("contratos con una CLI simulada", () => {
  it.each([
    ["termina con 0", { FAKE_EXIT: "0" }, 0],
    ["termina con 3", { FAKE_EXIT: "3" }, 3],
  ])("la CLI %s y el comando devuelve lo mismo", (_case, env, expected) => {
    const root = fakeRoot();
    expect(run({ root, env: { ...process.env, ...env }, ...quiet })).toBe(expected);
  });

  it("una terminación por señal nunca es un éxito", () => {
    const root = fakeRoot();
    const errors: string[] = [];
    const code = run({
      root,
      env: { ...process.env, FAKE_SIGNAL: "SIGTERM" },
      ...quiet,
      err: (l) => errors.push(l),
    });
    expect(code).not.toBe(0);
    expect(errors.join()).toContain("SIGTERM");
  });

  it("pasa validate --all --strict, desactiva la telemetría y conserva el resto del entorno", () => {
    const root = fakeRoot();
    const report = join(root, "informe.json");
    const code = run({
      root,
      env: {
        ...process.env,
        FAKE_REPORT: report,
        OPENSPEC_TELEMETRY: "1",
        UNRELATED_VAR: "se-conserva",
      },
      ...quiet,
    });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(report, "utf8"))).toEqual({
      args: [...VALIDATE_ARGS],
      telemetry: "0",
      unrelated: "se-conserva",
    });
  });

  it.each([
    ["con otra versión instalada", { installed: "9.9.9" }, "9.9.9"],
    ["sin el paquete instalado", { installed: null }, "no está instalado"],
    ["con una versión declarada no exacta", { declared: "^1.14.0" }, "versión exacta"],
  ])("falla %s, sin ejecutar nada", (_case, options, message) => {
    const root = fakeRoot(options);
    const report = join(root, "informe.json");
    const errors: string[] = [];
    const code = run({
      root,
      env: { ...process.env, FAKE_REPORT: report },
      ...quiet,
      err: (l) => errors.push(l),
    });
    expect(code).not.toBe(0);
    expect(errors.join()).toContain(message);
    expect(existsSync(report)).toBe(false);
  });
});

/** Suma de todos los archivos de un árbol, para comprobar que nada cambió. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else hash.update(path).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("con la CLI instalada en el repositorio", () => {
  it("resuelve la versión fijada, 1.14.0, dentro de las dependencias del repositorio", () => {
    const cli = resolveOpenSpec(REPO);
    expect(cli.version).toBe("1.14.0");
    expect(cli.bin).toContain(join("node_modules"));
    expect(cli.bin).toMatch(/@fission-ai[\\/]openspec[\\/]bin[\\/]openspec\.js$/);
  });

  it("un openspec falso al frente del PATH no interviene", () => {
    const bin = tempDir("openspec-path-");
    const marker = join(bin, "usado");
    writeFileSync(join(bin, "openspec"), `#!/bin/sh\ntouch "${marker}"\necho "0.0.1"\nexit 0\n`);
    chmodSync(join(bin, "openspec"), 0o755);
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OpenSpec 1.14.0 del repositorio, telemetría desactivada.");
    expect(result.stdout).toMatch(/Totals: \d+ passed, 0 failed/);
    expect(existsSync(marker)).toBe(false);
  });

  it("valida el repositorio sin modificar openspec/", () => {
    const before = treeHash(join(REPO, "openspec"));
    expect(run({ root: REPO, ...quiet })).toBe(0);
    expect(treeHash(join(REPO, "openspec"))).toBe(before);
  });

  it("un contenido de OpenSpec inválido en un repositorio temporal hace fallar el comando", () => {
    const fixture = tempDir("openspec-invalido-");
    mkdirSync(join(fixture, "openspec", "specs", "roto"), { recursive: true });
    mkdirSync(join(fixture, "openspec", "changes"));
    writeFileSync(join(fixture, "openspec", "config.yaml"), "schema: spec-driven\n");
    writeFileSync(
      join(fixture, "openspec", "specs", "roto", "spec.md"),
      "# roto Specification\n\n## Purpose\n\nCorto.\n",
    );
    expect(run({ root: REPO, cwd: fixture, ...quiet })).not.toBe(0);
  });
});
