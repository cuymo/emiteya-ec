// Seguridad de las dependencias (add-ci-dependency-and-secret-scanning, design D1 a D3): ejecuta
// `pnpm audit --json`, bloquea los avisos HIGH y CRITICAL sin una excepción revisada y vigente, e
// informa los demás. Solo usa módulos de Node, así corre sin instalar dependencias. Una salida
// inutilizable de la fuente de avisos es un ERROR, nunca cero vulnerabilidades.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Severity = "info" | "low" | "moderate" | "high" | "critical";

export type Finding = Readonly<{
  advisory: string;
  package: string;
  severity: Severity;
  title: string;
  vulnerable: string;
  patched: string | null;
  paths: readonly string[];
  dev: boolean;
}>;

export type DependencyException = Readonly<{
  advisory: string;
  package: string;
  paths: readonly string[];
  reason: string;
  owner: string;
  reviewed: string;
  expires: string;
}>;

export type Evaluation = Readonly<{
  status: "PASS" | "FAIL";
  blocking: readonly Finding[];
  excepted: readonly { finding: Finding; exception: DependencyException }[];
  reported: readonly Finding[];
  exceptionErrors: readonly string[];
}>;

export const BLOCKING: ReadonlySet<Severity> = new Set(["high", "critical"]);
export const MAX_EXCEPTION_DAYS = 90;
const SEVERITIES: ReadonlySet<string> = new Set(["info", "low", "moderate", "high", "critical"]);
const GHSA = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXCEPTION_FIELDS = ["advisory", "package", "paths", "reason", "owner", "reviewed", "expires"];
const DAY_MS = 86_400_000;

/** La salida de `pnpm audit` no es utilizable: vacía, no JSON o sin la forma esperada. */
export class AuditOutputError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Normaliza la salida de `pnpm audit --json`. Cualquier forma inesperada es un error. */
export function parseAudit(raw: string): { findings: Finding[]; dependencies: number } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AuditOutputError("la salida no es JSON");
  }
  if (!isRecord(data) || !isRecord(data.advisories) || !isRecord(data.metadata)) {
    throw new AuditOutputError("la salida no tiene avisos ni metadatos");
  }
  if (!isRecord(data.metadata.vulnerabilities)) {
    throw new AuditOutputError("la salida no tiene el recuento de vulnerabilidades");
  }
  const dependencies = data.metadata.totalDependencies;
  if (typeof dependencies !== "number" || dependencies <= 0) {
    throw new AuditOutputError("la salida no informa dependencias revisadas");
  }
  const findings = Object.values(data.advisories).map((advisory): Finding => {
    if (!isRecord(advisory)) throw new AuditOutputError("un aviso no tiene forma de objeto");
    const { github_advisory_id: id, module_name: name, severity, findings: raw } = advisory;
    if (typeof id !== "string" || !GHSA.test(id)) {
      throw new AuditOutputError("un aviso no tiene un GHSA válido");
    }
    if (typeof name !== "string" || typeof severity !== "string" || !SEVERITIES.has(severity)) {
      throw new AuditOutputError(`el aviso ${id} no tiene paquete o severidad válidos`);
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new AuditOutputError(`el aviso ${id} no tiene rutas`);
    }
    const paths = new Set<string>();
    let dev = false;
    for (const finding of raw) {
      if (!isRecord(finding) || !Array.isArray(finding.paths)) {
        throw new AuditOutputError(`el aviso ${id} tiene una ruta inválida`);
      }
      for (const path of finding.paths) {
        if (typeof path !== "string" || path === "") {
          throw new AuditOutputError(`el aviso ${id} tiene una ruta inválida`);
        }
        paths.add(path);
      }
      dev ||= finding.dev === true;
    }
    return {
      advisory: id,
      package: name,
      severity: severity as Severity,
      title: typeof advisory.title === "string" ? advisory.title : "",
      vulnerable:
        typeof advisory.vulnerable_versions === "string" ? advisory.vulnerable_versions : "",
      patched: typeof advisory.patched_versions === "string" ? advisory.patched_versions : null,
      paths: [...paths].sort(),
      dev,
    };
  });
  return { findings, dependencies };
}

const dayOf = (value: string) => Date.parse(`${value}T00:00:00Z`);
const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  DATE.test(value) &&
  new Date(dayOf(value)).toISOString().slice(0, 10) === value;
const covers = (prefix: string, path: string) => path === prefix || path.startsWith(`${prefix}>`);

/** Valida el archivo de excepciones contra el esquema y la fecha de hoy (`AAAA-MM-DD`). */
export function validateExceptions(
  data: unknown,
  today: string,
): { exceptions: DependencyException[]; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(data) || !Array.isArray(data.exceptions)) {
    return { exceptions: [], errors: ["el archivo debe ser un objeto con la lista `exceptions`"] };
  }
  const extraKeys = Object.keys(data).filter((key) => key !== "exceptions");
  if (extraKeys.length > 0)
    errors.push(`campos no permitidos en el archivo: ${extraKeys.join(", ")}`);
  const exceptions: DependencyException[] = [];
  const seen = new Set<string>();
  data.exceptions.forEach((entry: unknown, index) => {
    const label = `excepción ${index + 1}`;
    if (!isRecord(entry)) {
      errors.push(`${label}: no es un objeto`);
      return;
    }
    const problems: string[] = [];
    for (const key of Object.keys(entry)) {
      if (!EXCEPTION_FIELDS.includes(key)) problems.push(`campo no permitido \`${key}\``);
    }
    const { advisory, package: name, paths, reason, owner, reviewed, expires } = entry;
    if (typeof advisory !== "string" || !GHSA.test(advisory))
      problems.push("`advisory` debe ser un GHSA exacto");
    if (typeof name !== "string" || !PACKAGE.test(name))
      problems.push("`package` debe ser un nombre exacto");
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.some((path) => typeof path !== "string" || !path.includes(">") || /[*?\s]/.test(path))
    ) {
      problems.push("`paths` debe listar rutas de dependencias exactas, sin comodines");
    }
    if (typeof reason !== "string" || reason.trim() === "") problems.push("falta `reason`");
    if (typeof owner !== "string" || owner.trim() === "") problems.push("falta `owner`");
    if (!isDate(reviewed)) problems.push("`reviewed` debe ser una fecha AAAA-MM-DD");
    if (!isDate(expires)) problems.push("`expires` debe ser una fecha AAAA-MM-DD");
    if (isDate(reviewed) && isDate(expires)) {
      const days = (dayOf(expires) - dayOf(reviewed)) / DAY_MS;
      if (days <= 0) problems.push("`expires` debe ser posterior a `reviewed`");
      if (days > MAX_EXCEPTION_DAYS)
        problems.push(`dura ${days} días; el máximo es ${MAX_EXCEPTION_DAYS}`);
      if (dayOf(reviewed) > dayOf(today)) problems.push("`reviewed` está en el futuro");
      if (dayOf(today) > dayOf(expires)) problems.push(`venció el ${expires}`);
    }
    const id = `${String(advisory)}|${String(name)}`;
    if (seen.has(id)) problems.push("duplicada");
    seen.add(id);
    if (problems.length > 0) {
      errors.push(`${label} (${String(advisory)}, ${String(name)}): ${problems.join("; ")}`);
      return;
    }
    exceptions.push({
      advisory: advisory as string,
      package: name as string,
      paths: paths as string[],
      reason: reason as string,
      owner: owner as string,
      reviewed: reviewed as string,
      expires: expires as string,
    });
  });
  return { exceptions, errors };
}

/**
 * Aplica la política: HIGH y CRITICAL bloquean salvo que una excepción vigente cubra todas sus rutas;
 * MODERATE, LOW e INFO se informan. Una excepción que no corresponde a un hallazgo bloqueante, o con
 * una ruta que ya no aparece, es obsoleta y hace fallar.
 */
export function evaluate(
  findings: readonly Finding[],
  exceptions: readonly DependencyException[],
  exceptionErrors: readonly string[] = [],
): Evaluation {
  const errors = [...exceptionErrors];
  const blocking: Finding[] = [];
  const excepted: { finding: Finding; exception: DependencyException }[] = [];
  const reported: Finding[] = [];
  const used = new Set<DependencyException>();
  for (const finding of findings) {
    if (!BLOCKING.has(finding.severity)) {
      reported.push(finding);
      continue;
    }
    const exception = exceptions.find(
      (e) => e.advisory === finding.advisory && e.package === finding.package,
    );
    if (exception) used.add(exception);
    const covered =
      exception !== undefined &&
      finding.paths.every((path) => exception.paths.some((prefix) => covers(prefix, path)));
    if (exception && covered) excepted.push({ finding, exception });
    else blocking.push(finding);
  }
  for (const exception of exceptions) {
    const label = `excepción obsoleta (${exception.advisory}, ${exception.package})`;
    const finding = findings.find(
      (f) => f.advisory === exception.advisory && f.package === exception.package,
    );
    if (!used.has(exception) || !finding) {
      errors.push(`${label}: ningún hallazgo bloqueante le corresponde`);
      continue;
    }
    const dead = exception.paths.filter(
      (prefix) => !finding.paths.some((path) => covers(prefix, path)),
    );
    if (dead.length > 0) errors.push(`${label}: ${dead.length} ruta(s) ya no aparecen`);
  }
  return {
    status: blocking.length === 0 && errors.length === 0 ? "PASS" : "FAIL",
    blocking,
    excepted,
    reported,
    exceptionErrors: errors,
  };
}

const describeFinding = (f: Finding) =>
  `${f.advisory} ${f.severity.toUpperCase()} ${f.package} — ${f.title} (${f.paths.length} ruta(s), ${
    f.dev ? "desarrollo" : "producción"
  }; corregida: ${f.patched ?? "sin versión corregida"})`;

/** Las líneas de la salida: solo datos públicos del aviso, nunca la salida cruda de pnpm. */
export function render(evaluation: Evaluation, dependencies: number): string[] {
  const lines = [`Avisos de pnpm audit sobre ${dependencies} dependencias.`];
  for (const f of evaluation.blocking) lines.push(`  BLOQUEA     ${describeFinding(f)}`);
  for (const { finding, exception } of evaluation.excepted) {
    lines.push(`  EXCEPTUADO  ${describeFinding(finding)}; vence el ${exception.expires}`);
  }
  for (const f of evaluation.reported) lines.push(`  INFORMADO   ${describeFinding(f)}`);
  for (const error of evaluation.exceptionErrors) lines.push(`  EXCEPCIÓN   ${error}`);
  lines.push(`DEPENDENCY SECURITY: ${evaluation.status}`);
  return lines;
}

function summary(evaluation: Evaluation | null, status: string, detail: string[]): string {
  const rows = evaluation
    ? [
        ...evaluation.blocking.map(
          (f) => `| Bloquea | ${f.advisory} | ${f.severity} | ${f.package} |`,
        ),
        ...evaluation.excepted.map(
          ({ finding: f, exception }) =>
            `| Exceptuado hasta ${exception.expires} | ${f.advisory} | ${f.severity} | ${f.package} |`,
        ),
        ...evaluation.reported.map(
          (f) => `| Informado | ${f.advisory} | ${f.severity} | ${f.package} |`,
        ),
      ]
    : [];
  return [
    `## DEPENDENCY SECURITY: ${status}`,
    "",
    ...(rows.length > 0
      ? ["| Estado | Aviso | Severidad | Paquete |", "| --- | --- | --- | --- |", ...rows, ""]
      : []),
    ...detail.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

export type AuditRun = Readonly<{ status: number | null; stdout: string; stderr: string }>;

function runAudit(root: string): AuditRun {
  const result = spawnSync("corepack", ["pnpm", "audit", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Ejecuta la comprobación completa y devuelve el código de salida: 0 PASS, 1 FAIL, 2 ERROR. */
export function main(
  options: {
    root?: string;
    exceptionsPath?: string;
    today?: string;
    audit?: (root: string) => AuditRun;
    out?: (line: string) => void;
    env?: NodeJS.ProcessEnv;
  } = {},
): number {
  const root = options.root ?? process.cwd();
  const out = options.out ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const exceptionsPath =
    options.exceptionsPath ?? join(root, "security", "dependency-audit-exceptions.json");
  const writeSummary = (text: string) => {
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  };

  const run = (options.audit ?? runAudit)(root);
  let parsed: ReturnType<typeof parseAudit>;
  try {
    parsed = parseAudit(run.stdout);
  } catch (error) {
    const code = /ERR_PNPM_[A-Z_]+/.exec(run.stderr)?.[0] ?? `salida ${String(run.status)}`;
    const reason = error instanceof AuditOutputError ? error.message : "salida inesperada";
    const detail = [
      `La fuente de avisos no devolvió un resultado utilizable (${reason}; ${code}).`,
      "No es un hallazgo de seguridad: repite la ejecución cuando el registro responda.",
    ];
    detail.forEach((line) => out(line));
    out("DEPENDENCY SECURITY: ERROR");
    if (env.GITHUB_ACTIONS) out(`::error title=DEPENDENCY SECURITY: ERROR::${detail[0]}`);
    writeSummary(summary(null, "ERROR", detail));
    return 2;
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(exceptionsPath, "utf8"));
  } catch {
    data = null;
  }
  const { exceptions, errors } =
    data === null
      ? { exceptions: [], errors: ["no se puede leer el archivo de excepciones"] }
      : validateExceptions(data, today);
  const evaluation = evaluate(parsed.findings, exceptions, errors);
  render(evaluation, parsed.dependencies).forEach((line) => out(line));
  if (env.GITHUB_ACTIONS) {
    for (const f of evaluation.blocking) {
      out(`::error title=DEPENDENCY SECURITY::${f.advisory} ${f.severity} en ${f.package}`);
    }
    for (const error of evaluation.exceptionErrors) {
      out(`::error title=DEPENDENCY SECURITY::${error}`);
    }
  }
  const remediation =
    evaluation.status === "PASS"
      ? []
      : [
          "Corrige la dependencia o registra una excepción revisada y con vencimiento en `security/dependency-audit-exceptions.json` (docs/security/hardening.md).",
        ];
  remediation.forEach((line) => out(line));
  writeSummary(summary(evaluation, evaluation.status, remediation));
  return evaluation.status === "PASS" ? 0 : 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--exceptions");
  process.exitCode = main(index >= 0 && args[index + 1] ? { exceptionsPath: args[index + 1] } : {});
}
