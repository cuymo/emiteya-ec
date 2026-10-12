// Seguridad de los secretos (add-ci-dependency-and-secret-scanning, design D5 y D6). Ejecuta el
// Gitleaks fijado sobre datos de git: el historial alcanzable desde HEAD y, en local, el índice
// preparado. Nunca recorre el directorio de trabajo, así que no lee archivos sin versionar. Añade una
// comprobación de rutas con git, porque Gitleaks no informa las reglas por ruta de archivos binarios
// o vacíos. Solo imprime metadatos seguros: nunca el valor, el campo `Match` ni la huella cruda.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Reglas por ruta; sus patrones son los mismos de `.gitleaks.toml` (lo comprueba una prueba). */
export const PATH_RULES = [
  { id: "project-pkcs12-file", category: "archivo PKCS#12", source: String.raw`(?i)\.(p12|pfx)$` },
  {
    id: "project-local-secrets-file",
    category: "archivo de secretos local",
    source: String.raw`(?i)(^|/)archivosensible\.env$`,
  },
  {
    id: "project-env-file",
    category: "archivo .env real",
    source: String.raw`(^|/)\.env(\.[^/]+)?$`,
    allow: String.raw`(^|/)\.env\.example$`,
  },
] as const;

/** La regla por ruta de las reglas por defecto de Gitleaks. */
const DEFAULT_PATH_RULES: Readonly<Record<string, string>> = { "pkcs12-file": "archivo PKCS#12" };
const LEAKS_EXIT_CODE = 99;
const HISTORY_LOG_OPTS = "--full-history HEAD";

const toRegExp = (source: string) =>
  source.startsWith("(?i)") ? new RegExp(source.slice(4), "i") : new RegExp(source);
const COMPILED = PATH_RULES.map((rule) => ({
  ...rule,
  regex: toRegExp(rule.source),
  allowRegex: "allow" in rule ? toRegExp(rule.allow) : null,
}));
const PATH_RULE_IDS = new Set<string>([
  ...PATH_RULES.map((r) => r.id),
  ...Object.keys(DEFAULT_PATH_RULES),
]);

export type SecretFinding = Readonly<
  | { kind: "content"; rule: string; file: string; line: number; commit: string; id: string }
  | { kind: "path"; category: string; directory: string; commit: string; id: string }
>;

const opaqueId = (...parts: (string | number)[]) =>
  createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 12);
const shortCommit = (commit: string) => (commit ? commit.slice(0, 7) : "preparado");
const directoryOf = (file: string) => (dirname(file) === "." ? "(raíz)" : `${dirname(file)}/`);

/** La categoría de una ruta según las reglas por ruta, o null si no es un archivo prohibido. */
export function pathCategory(file: string): string | null {
  for (const rule of COMPILED) {
    if (rule.regex.test(file) && !(rule.allowRegex?.test(file) ?? false)) return rule.category;
  }
  return null;
}

/**
 * Normaliza el informe JSON de Gitleaks. Solo se leen campos permitidos: nunca `Secret`, `Match`,
 * `Author`, `Email`, `Message` ni `Fingerprint`, que pueden contener el valor, la ruta o datos personales.
 */
export function parseReport(raw: string): SecretFinding[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("el informe de Gitleaks no es una lista");
  return data.map((entry: unknown): SecretFinding => {
    if (typeof entry !== "object" || entry === null) throw new Error("hallazgo inválido");
    const {
      RuleID: rule,
      File: file,
      StartLine: line,
      EndLine: end,
      Commit: commit,
    } = entry as Record<string, unknown>;
    if (typeof rule !== "string" || typeof file !== "string") throw new Error("hallazgo inválido");
    const commitId = typeof commit === "string" ? commit : "";
    const startLine = typeof line === "number" ? line : 0;
    const isPath = PATH_RULE_IDS.has(rule) || (startLine === 0 && end === 0);
    if (isPath) {
      const category =
        PATH_RULES.find((r) => r.id === rule)?.category ??
        DEFAULT_PATH_RULES[rule] ??
        "archivo prohibido";
      return {
        kind: "path",
        category,
        directory: directoryOf(file),
        commit: commitId,
        id: opaqueId(commitId, file, category),
      };
    }
    return {
      kind: "content",
      rule,
      file,
      line: startLine,
      commit: commitId,
      id: opaqueId(commitId, file, rule, startLine),
    };
  });
}

/** Valida `.gitleaksignore`: huellas `commit:archivo:regla:línea`, nunca de una regla por ruta. */
export function validateIgnoreFile(raw: string): string[] {
  const errors: string[] = [];
  raw.split("\n").forEach((text, index) => {
    const line = text.trim();
    if (line === "" || line.startsWith("#")) return;
    const parts = line.split(":");
    const rule = parts.at(-2) ?? "";
    const lineNumber = parts.at(-1) ?? "";
    if (parts.length < 4 || !/^\d+$/.test(lineNumber)) {
      errors.push(`.gitleaksignore, línea ${index + 1}: no es una huella de Gitleaks`);
    } else if (PATH_RULE_IDS.has(rule) || lineNumber === "0") {
      errors.push(
        `.gitleaksignore, línea ${index + 1}: una regla por ruta no se suprime (un archivo prohibido versionado es un incidente)`,
      );
    }
  });
  return errors;
}

type Exec = (
  command: string,
  args: string[],
  cwd: string,
) => { status: number | null; stdout: string; error?: Error };

const defaultExec: Exec = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
};

/** Archivos prohibidos en el historial de HEAD (y en el índice, en local), solo con git. */
export function pathFindings(
  root: string,
  staged: boolean,
  exec: Exec = defaultExec,
): SecretFinding[] {
  const found: SecretFinding[] = [];
  const add = (commit: string, file: string) => {
    const category = pathCategory(file);
    if (category) {
      found.push({
        kind: "path",
        category,
        directory: directoryOf(file),
        commit,
        id: opaqueId(commit, file, category),
      });
    }
  };
  const log = exec(
    "git",
    ["log", "--format=commit %H", "--name-only", "--no-renames", "--diff-filter=ACMRT", "HEAD"],
    root,
  );
  if (log.status === 0) {
    let commit = "";
    for (const line of log.stdout.split("\n")) {
      if (line.startsWith("commit ")) commit = line.slice(7).trim();
      else if (line.trim() !== "") add(commit, line.trim());
    }
  }
  if (staged) {
    const index = exec(
      "git",
      ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=ACMRT"],
      root,
    );
    if (index.status === 0) {
      for (const line of index.stdout.split("\n")) if (line.trim() !== "") add("", line.trim());
    }
  }
  return found;
}

const describe = (f: SecretFinding) =>
  f.kind === "content"
    ? `  SECRETO  ${f.rule} en ${f.file}:${f.line} (commit ${shortCommit(f.commit)}, id ${f.id})`
    : `  ARCHIVO  ${f.category} en ${f.directory} (commit ${shortCommit(f.commit)}, id ${f.id})`;

const annotation = (f: SecretFinding) =>
  f.kind === "content"
    ? `::error file=${f.file},line=${f.line},title=SECRET SECURITY::${f.rule} (id ${f.id})`
    : `::error title=SECRET SECURITY::${f.category} en ${f.directory} (id ${f.id})`;

export type SecretCheckOptions = {
  root?: string;
  ci?: boolean;
  gitleaks?: string;
  pinPath?: string;
  out?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  exec?: Exec;
};

/** Ejecuta la comprobación y devuelve el código de salida: 0 PASS, 1 FAIL, 2 ERROR. */
export function main(options: SecretCheckOptions = {}): number {
  const root = options.root ?? process.cwd();
  const out = options.out ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;
  const exec = options.exec ?? defaultExec;
  const gitleaks = options.gitleaks ?? "gitleaks";
  const summary = (text: string) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  };
  const error = (message: string) => {
    out(message);
    out("SECRET SECURITY: ERROR");
    if (env.GITHUB_ACTIONS) out(`::error title=SECRET SECURITY: ERROR::${message}`);
    summary(`## SECRET SECURITY: ERROR\n\n- ${message}\n`);
    return 2;
  };

  let pin: { version: string };
  try {
    pin = JSON.parse(
      readFileSync(options.pinPath ?? join(root, "security", "gitleaks.json"), "utf8"),
    ) as {
      version: string;
    };
  } catch {
    return error("No se puede leer la fijación de Gitleaks (security/gitleaks.json).");
  }
  const version = exec(gitleaks, ["version"], root);
  if (version.error || version.status !== 0) {
    return error(
      `Gitleaks no está disponible. Instala exactamente la versión ${pin.version} (docs/quality/testing.md); este comando no lo descarga.`,
    );
  }
  if (version.stdout.trim() !== pin.version) {
    return error(
      `La versión de Gitleaks es ${version.stdout.trim() || "desconocida"} y se exige ${pin.version} (security/gitleaks.json).`,
    );
  }

  const ignorePath = join(root, ".gitleaksignore");
  const ignoreErrors = existsSync(ignorePath)
    ? validateIgnoreFile(readFileSync(ignorePath, "utf8"))
    : [];

  const work = mkdtempSync(join(tmpdir(), "secret-security-"));
  const findings: SecretFinding[] = [];
  try {
    const common = [
      "--no-banner",
      "--redact",
      "--ignore-gitleaks-allow",
      `--exit-code=${LEAKS_EXIT_CODE}`,
      `--config=${join(root, ".gitleaks.toml")}`,
      `--gitleaks-ignore-path=${root}`,
      "--report-format=json",
    ];
    const scans: { label: string; args: string[] }[] = [
      { label: "historial", args: ["git", ...common, `--log-opts=${HISTORY_LOG_OPTS}`] },
      ...(options.ci
        ? []
        : [{ label: "cambios preparados", args: ["git", ...common, "--pre-commit", "--staged"] }]),
    ];
    for (const [index, scan] of scans.entries()) {
      const report = join(work, `informe-${index}.json`);
      const result = exec(gitleaks, [...scan.args, `--report-path=${report}`, root], root);
      if (result.error || (result.status !== 0 && result.status !== LEAKS_EXIT_CODE)) {
        return error(
          `Gitleaks falló al revisar el ${scan.label} (código ${String(result.status)}).`,
        );
      }
      try {
        findings.push(...parseReport(readFileSync(report, "utf8")));
      } catch {
        return error(`El informe de Gitleaks del ${scan.label} no es utilizable.`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  // Un mismo archivo puede salir de dos reglas o de las dos comprobaciones: se informa una vez.
  const unique = new Map<string, SecretFinding>();
  for (const f of [...findings, ...pathFindings(root, !options.ci, exec)]) {
    if (!unique.has(f.id)) unique.set(f.id, f);
  }
  findings.splice(0, findings.length, ...unique.values());

  const status = findings.length === 0 && ignoreErrors.length === 0 ? "PASS" : "FAIL";
  out(
    `Gitleaks ${pin.version}: ${options.ci ? "historial de HEAD" : "historial de HEAD y cambios preparados"}.`,
  );
  findings.forEach((f) => out(describe(f)));
  ignoreErrors.forEach((e) => out(`  SUPRESIÓN ${e}`));
  if (status === "FAIL") {
    out(
      "Contén y rota o revoca el secreto, y evalúa la exposición. No reescribas el historial sin autorización explícita del dueño (docs/security/hardening.md).",
    );
  }
  out(`SECRET SECURITY: ${status}`);
  if (env.GITHUB_ACTIONS) {
    findings.forEach((f) => out(annotation(f)));
    ignoreErrors.forEach((e) => out(`::error title=SECRET SECURITY::${e}`));
  }
  summary(
    [
      `## SECRET SECURITY: ${status}`,
      "",
      ...(findings.length > 0
        ? ["| Tipo | Detalle | Commit | Id |", "| --- | --- | --- | --- |"]
        : []),
      ...findings.map((f) =>
        f.kind === "content"
          ? `| Secreto | ${f.rule} en ${f.file}:${f.line} | ${shortCommit(f.commit)} | ${f.id} |`
          : `| Archivo | ${f.category} en ${f.directory} | ${shortCommit(f.commit)} | ${f.id} |`,
      ),
      ...ignoreErrors.map((e) => `- ${e}`),
      "",
    ].join("\n"),
  );
  return status === "PASS" ? 0 : 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const binary = args.indexOf("--gitleaks");
  process.exitCode = main({
    ci: args.includes("--ci"),
    ...(binary >= 0 && args[binary + 1] ? { gitleaks: args[binary + 1] } : {}),
  });
}
