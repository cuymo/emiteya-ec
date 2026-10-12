// Comprobador de secretos (add-ci-dependency-and-secret-scanning, design D5 y D6), sin el binario real:
// las llamadas a Gitleaks se sustituyen por informes de muestra, y git corre sobre repositorios
// temporales. Comprueba el alcance, la salida segura, los errores y la comprobación de rutas.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PATH_RULES,
  main,
  pathCategory,
  validateIgnoreFile,
  type SecretCheckOptions,
} from "./check-secret-security.ts";

const SYNTHETIC = "VALOR-SINTETICO-QUE-NO-DEBE-APARECER-123";
const ROOT = join(import.meta.dirname, "..");
let repos: string[] = [];

afterEach(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  repos = [];
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "secret-check-"));
  repos.push(dir);
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "prueba@example.test");
  git("config", "user.name", "Prueba");
  writeFileSync(join(dir, ".gitleaks.toml"), "[extend]\nuseDefault = true\n");
  writeFileSync(join(dir, "pin.json"), JSON.stringify({ version: "8.30.1" }));
  writeFileSync(join(dir, "LEEME.md"), "repositorio de prueba\n");
  git("add", ".");
  git("commit", "-qm", "inicio");
  return dir;
}

const gitIn = (dir: string, ...args: string[]) =>
  spawnSync("git", args, { cwd: dir, encoding: "utf8" });

type Call = { command: string; args: string[] };

/** Gitleaks simulado: devuelve la versión y escribe el informe pedido; git corre de verdad. */
function harness(
  dir: string,
  options: {
    version?: string | null;
    report?: unknown[];
    exit?: number;
    invalidReport?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const summaryFile = join(dir, "resumen.md");
  const run = (extra: Partial<SecretCheckOptions> = {}) =>
    main({
      root: dir,
      pinPath: join(dir, "pin.json"),
      gitleaks: "gitleaks",
      out: (line) => lines.push(line),
      env: { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryFile },
      exec: (command, args, cwd) => {
        calls.push({ command, args });
        if (command === "git") {
          const result = spawnSync("git", args, { cwd, encoding: "utf8" });
          return { status: result.status, stdout: result.stdout };
        }
        if (args[0] === "version") {
          return options.version === null
            ? { status: null, stdout: "", error: new Error("ENOENT") }
            : { status: 0, stdout: `${options.version ?? "8.30.1"}\n` };
        }
        const reportArg = args.find((a) => a.startsWith("--report-path="))!;
        const report = reportArg.slice("--report-path=".length);
        writeFileSync(
          report,
          options.invalidReport ? "no es json" : JSON.stringify(options.report ?? []),
        );
        return { status: options.exit ?? (options.report?.length ? 99 : 0), stdout: "" };
      },
      ...extra,
    });
  return {
    run,
    calls,
    output: () => lines.join("\n"),
    summary: () => (existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : ""),
  };
}

const contentFinding = {
  RuleID: "generic-api-key",
  File: "src/config.ts",
  StartLine: 12,
  EndLine: 12,
  Commit: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
  Secret: SYNTHETIC,
  Match: `token = "${SYNTHETIC}"`,
  Author: "Persona de Prueba",
  Email: "persona@example.test",
  Message: "mensaje del commit con datos",
  Fingerprint: `a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0:src/config.ts:generic-api-key:12`,
};

describe("alcance de los escaneos", () => {
  it("en local revisa el historial de HEAD y los cambios preparados, nunca el directorio de trabajo", () => {
    const dir = repo();
    const h = harness(dir);
    expect(h.run()).toBe(0);
    const scans = h.calls.filter((c) => c.command === "gitleaks" && c.args[0] !== "version");
    expect(scans.map((c) => c.args[0])).toEqual(["git", "git"]);
    for (const scan of scans) {
      expect(scan.args).not.toContain("dir");
      expect(scan.args).toContain("--redact");
      expect(scan.args).toContain("--ignore-gitleaks-allow");
      expect(scan.args.at(-1)).toBe(dir);
    }
    expect(scans[0]!.args).toContain("--log-opts=--full-history HEAD");
    expect(scans[1]!.args).toEqual(expect.arrayContaining(["--pre-commit", "--staged"]));
    expect(h.output()).toMatch(/SECRET SECURITY: PASS$/);
  });

  it("en CI revisa solo el historial de HEAD", () => {
    const dir = repo();
    const h = harness(dir);
    expect(h.run({ ci: true })).toBe(0);
    const scans = h.calls.filter((c) => c.command === "gitleaks" && c.args[0] !== "version");
    expect(scans).toHaveLength(1);
    expect(scans[0]!.args).not.toContain("--staged");
  });

  it("borra siempre el informe temporal", () => {
    const dir = repo();
    const h = harness(dir, { report: [contentFinding] });
    h.run();
    const reports = h.calls
      .flatMap((c) => c.args)
      .filter((a) => a.startsWith("--report-path="))
      .map((a) => a.slice("--report-path=".length));
    expect(reports.length).toBeGreaterThan(0);
    for (const report of reports) expect(existsSync(dirname(report))).toBe(false);
  });
});

describe("salida segura", () => {
  it("un secreto de contenido muestra la regla, el archivo, la línea, el commit y un id, nunca el valor", () => {
    const dir = repo();
    const h = harness(dir, { report: [contentFinding] });
    expect(h.run({ ci: true })).toBe(1);
    const output = h.output() + h.summary();
    expect(output).toContain("generic-api-key en src/config.ts:12");
    expect(output).toContain("commit a1b2c3d");
    expect(output).toMatch(/id [0-9a-f]{12}/);
    expect(output).toContain(
      "::error file=src/config.ts,line=12,title=SECRET SECURITY::generic-api-key",
    );
    for (const forbidden of [
      SYNTHETIC,
      contentFinding.Fingerprint,
      "persona@example.test",
      "mensaje del commit",
    ]) {
      expect(output).not.toContain(forbidden);
    }
    expect(h.output()).toContain("SECRET SECURITY: FAIL");
    expect(h.output()).toContain("No reescribas el historial");
  });

  it("un hallazgo por ruta muestra la categoría y el directorio, no el nombre del archivo", () => {
    const dir = repo();
    const finding = {
      ...contentFinding,
      RuleID: "project-pkcs12-file",
      File: "certificados/nombre-del-contribuyente.p12",
      StartLine: 0,
      EndLine: 0,
      Match: "file detected: certificados/nombre-del-contribuyente.p12",
    };
    const h = harness(dir, { report: [finding] });
    expect(h.run({ ci: true })).toBe(1);
    const output = h.output() + h.summary();
    expect(output).toContain("archivo PKCS#12 en certificados/");
    expect(output).not.toContain("nombre-del-contribuyente");
    expect(output).toContain("::error title=SECRET SECURITY::archivo PKCS#12");
    expect(output).not.toMatch(/::error file=certificados/);
  });
});

describe("errores y versión", () => {
  it("sin Gitleaks instalado falla con la versión esperada y no escanea", () => {
    const dir = repo();
    const h = harness(dir, { version: null });
    expect(h.run()).toBe(2);
    expect(h.output()).toContain("Instala exactamente la versión 8.30.1");
    expect(h.output()).toContain("SECRET SECURITY: ERROR");
    expect(h.calls.filter((c) => c.command === "gitleaks")).toHaveLength(1);
  });

  it("con otra versión de Gitleaks falla y no escanea", () => {
    const dir = repo();
    const h = harness(dir, { version: "8.18.0" });
    expect(h.run()).toBe(2);
    expect(h.output()).toContain("es 8.18.0 y se exige 8.30.1");
    expect(h.calls.filter((c) => c.command === "gitleaks")).toHaveLength(1);
  });

  it("un error de la herramienta es ERROR, no FAIL ni PASS", () => {
    const dir = repo();
    expect(harness(dir, { exit: 1 }).run()).toBe(2);
    const invalid = harness(dir, { invalidReport: true });
    expect(invalid.run()).toBe(2);
    expect(invalid.output()).toContain("SECRET SECURITY: ERROR");
  });
});

describe("supresiones", () => {
  it("una huella de contenido es válida y una de una regla por ruta falla", () => {
    expect(validateIgnoreFile("# comentario\nabc123:src/a.ts:generic-api-key:4\n")).toEqual([]);
    expect(validateIgnoreFile("abc123:certs/x.p12:project-pkcs12-file:0\n")).toHaveLength(1);
    expect(validateIgnoreFile("abc123:x.p12:pkcs12-file:0\n")).toHaveLength(1);
    expect(validateIgnoreFile("esto no es una huella\n")).toHaveLength(1);
  });

  it("un .gitleaksignore con una regla por ruta hace fallar la comprobación", () => {
    const dir = repo();
    writeFileSync(join(dir, ".gitleaksignore"), "abc123:x.pfx:project-pkcs12-file:0\n");
    const h = harness(dir);
    expect(h.run({ ci: true })).toBe(1);
    expect(h.output()).toContain("una regla por ruta no se suprime");
  });
});

describe("comprobación de rutas con git", () => {
  it("las reglas por ruta son las de .gitleaks.toml", () => {
    const toml = readFileSync(join(ROOT, ".gitleaks.toml"), "utf8");
    const paths = [...toml.matchAll(/^path = '''(.+)'''$/gm)].map((m) => m[1]);
    expect(paths).toEqual(PATH_RULES.map((r) => r.source));
    expect(toml).toContain(PATH_RULES[2].allow);
  });

  it.each([
    ["certificados/firma.p12", "archivo PKCS#12"],
    ["FIRMA.PFX", "archivo PKCS#12"],
    ["archivosensible.env", "archivo de secretos local"],
    ["backend/.env", "archivo .env real"],
    ["backend/.env.production", "archivo .env real"],
    ["backend/.env.example", null],
    ["docs/firma.p12.md", null],
    ["publico.crt", null],
  ])("%s → %s", (file, category) => {
    expect(pathCategory(file)).toBe(category);
  });

  it("detecta un PKCS#12 binario versionado o preparado, y nunca un archivo sin versionar", () => {
    const dir = repo();
    writeFileSync(join(dir, "firma.p12"), randomBytes(512));
    writeFileSync(join(dir, ".env.example"), "X=1\n");
    gitIn(dir, "add", ".");
    gitIn(dir, "commit", "-qm", "binario");
    writeFileSync(join(dir, "otra.pfx"), randomBytes(256));
    gitIn(dir, "add", "otra.pfx");
    writeFileSync(join(dir, "archivosensible.env"), `CLAVE=${SYNTHETIC}\n`);
    writeFileSync(join(dir, ".env"), `CLAVE=${SYNTHETIC}\n`);

    const local = harness(dir);
    expect(local.run()).toBe(1);
    const output = local.output();
    expect(output.match(/^ {2}ARCHIVO {2}archivo PKCS#12 en \(raíz\)/gm)).toHaveLength(2);
    expect(output).toContain("commit preparado");
    expect(output).not.toContain("archivo de secretos local");
    expect(output).not.toContain("archivo .env real");
    expect(output).not.toContain("firma.p12");
    expect(output).not.toContain(SYNTHETIC);

    const ci = harness(dir);
    expect(ci.run({ ci: true })).toBe(1);
    expect(ci.output().match(/^ {2}ARCHIVO {2}archivo PKCS#12/gm)).toHaveLength(1);
  });
});
