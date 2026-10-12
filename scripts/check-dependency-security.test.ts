// Política y excepciones de la seguridad de las dependencias (add-ci-dependency-and-secret-scanning,
// design D1 a D3), con salidas de muestra de `pnpm audit` y fechas inyectadas.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluate,
  main,
  parseAudit,
  validateExceptions,
  type DependencyException,
  type Finding,
} from "./check-dependency-security.ts";

const TODAY = "2026-10-12";

type Advisory = {
  id: string;
  name: string;
  severity: string;
  paths: string[];
  dev?: boolean;
};

const advisory = ({ id, name, severity, paths, dev = false }: Advisory) => ({
  github_advisory_id: id,
  module_name: name,
  severity,
  title: `Aviso de ${name}`,
  vulnerable_versions: "<2.0.0",
  patched_versions: ">=2.0.0",
  findings: [{ version: "1.0.0", paths, dev }],
});

const audit = (...advisories: Advisory[]) =>
  JSON.stringify({
    advisories: Object.fromEntries(advisories.map((a, i) => [String(i + 1), advisory(a)])),
    metadata: { vulnerabilities: {}, totalDependencies: 833 },
  });

const HIGH: Advisory = {
  id: "GHSA-aaaa-bbbb-cccc",
  name: "paquete-alto",
  severity: "high",
  paths: ["backend>intermedio>paquete-alto", "backend>paquete-alto"],
};

const exceptionFor = (overrides: Partial<DependencyException> = {}): DependencyException => ({
  advisory: HIGH.id,
  package: HIGH.name,
  paths: HIGH.paths,
  reason: "Transitiva sin uso en ejecución; corrección en un cambio propio.",
  owner: "Mantenedores del backend",
  reviewed: TODAY,
  expires: "2026-11-11",
  ...overrides,
});

const findings = (...advisories: Advisory[]) => parseAudit(audit(...advisories)).findings;
const check = (found: Finding[], entries: unknown[]) => {
  const { exceptions, errors } = validateExceptions({ exceptions: entries }, TODAY);
  return evaluate(found, exceptions, errors);
};

describe("política de severidad", () => {
  it("un HIGH nuevo falla, de producción y de desarrollo, directo o transitivo", () => {
    expect(check(findings(HIGH), []).status).toBe("FAIL");
    expect(
      check(findings({ ...HIGH, dev: true, paths: ["frontend>paquete-alto"] }), []).status,
    ).toBe("FAIL");
  });

  it("un CRITICAL falla", () => {
    const result = check(findings({ ...HIGH, severity: "critical" }), []);
    expect(result.status).toBe("FAIL");
    expect(result.blocking).toHaveLength(1);
  });

  it("un MODERATE solo se informa y no falla", () => {
    const result = check(findings({ ...HIGH, severity: "moderate" }), []);
    expect(result.status).toBe("PASS");
    expect(result.reported).toHaveLength(1);
    expect(result.blocking).toEqual([]);
  });

  it("LOW e INFO tampoco bloquean", () => {
    expect(check(findings({ ...HIGH, severity: "low" }), []).status).toBe("PASS");
    expect(check(findings({ ...HIGH, severity: "info" }), []).status).toBe("PASS");
  });
});

describe("excepciones", () => {
  it("una excepción coincidente neutraliza solo su hallazgo y sus rutas", () => {
    const other: Advisory = {
      ...HIGH,
      id: "GHSA-dddd-eeee-ffff",
      name: "otro",
      paths: ["backend>otro"],
    };
    const result = check(findings(HIGH, other), [exceptionFor()]);
    expect(result.excepted.map((e) => e.finding.advisory)).toEqual([HIGH.id]);
    expect(result.blocking.map((f) => f.advisory)).toEqual([other.id]);
    expect(result.status).toBe("FAIL");
  });

  it("una ruta nueva hacia un paquete exceptuado vuelve a bloquear", () => {
    const widened = { ...HIGH, paths: [...HIGH.paths, "frontend>nuevo>paquete-alto"] };
    const result = check(findings(widened), [exceptionFor()]);
    expect(result.status).toBe("FAIL");
    expect(result.blocking.map((f) => f.package)).toEqual([HIGH.name]);
  });

  it("un prefijo cubre solo rutas en el límite de un segmento", () => {
    const result = check(findings({ ...HIGH, paths: ["backend>paquete-alto-bis>paquete-alto"] }), [
      exceptionFor({ paths: ["backend>paquete-alto"] }),
    ]);
    expect(result.status).toBe("FAIL");
  });

  it("otro GHSA u otro paquete no coinciden", () => {
    const wrongAdvisory = check(findings(HIGH), [
      exceptionFor({ advisory: "GHSA-zzzz-zzzz-zzzz" }),
    ]);
    expect(wrongAdvisory.status).toBe("FAIL");
    expect(wrongAdvisory.blocking).toHaveLength(1);
    const wrongPackage = check(findings(HIGH), [exceptionFor({ package: "otro-paquete" })]);
    expect(wrongPackage.status).toBe("FAIL");
    expect(wrongPackage.blocking).toHaveLength(1);
  });

  it("una excepción vencida falla", () => {
    const result = check(findings(HIGH), [
      exceptionFor({ reviewed: "2026-08-01", expires: "2026-10-11" }),
    ]);
    expect(result.status).toBe("FAIL");
    expect(result.exceptionErrors.join()).toContain("venció el 2026-10-11");
  });

  it("vence al terminar su último día, no antes", () => {
    const result = check(findings(HIGH), [
      exceptionFor({ reviewed: "2026-09-12", expires: TODAY }),
    ]);
    expect(result.status).toBe("PASS");
  });

  it("una excepción de más de 90 días falla", () => {
    const result = check(findings(HIGH), [exceptionFor({ expires: "2027-01-11" })]);
    expect(result.status).toBe("FAIL");
    expect(result.exceptionErrors.join()).toContain("el máximo es 90");
  });

  it("una revisión con fecha futura falla", () => {
    const result = check(findings(HIGH), [
      exceptionFor({ reviewed: "2026-10-20", expires: "2026-11-30" }),
    ]);
    expect(result.status).toBe("FAIL");
  });

  it.each(["advisory", "package", "paths", "reason", "owner", "reviewed", "expires"])(
    "una excepción sin %s falla",
    (field) => {
      const entry: Record<string, unknown> = { ...exceptionFor() };
      delete entry[field];
      const result = check(findings(HIGH), [entry]);
      expect(result.status).toBe("FAIL");
      expect(result.blocking).toHaveLength(1);
    },
  );

  it.each([
    ["un comodín en el aviso", { advisory: "GHSA-*" }],
    ["un comodín en la ruta", { paths: ["backend>*"] }],
    ["una ruta sin dependencias", { paths: ["backend"] }],
    ["rutas vacías", { paths: [] }],
    ["un campo de severidad", { severity: "high" }],
  ])("una excepción con %s falla", (_case, overrides) => {
    expect(check(findings(HIGH), [{ ...exceptionFor(), ...overrides }]).status).toBe("FAIL");
  });

  it("una excepción duplicada falla", () => {
    const result = check(findings(HIGH), [exceptionFor(), exceptionFor()]);
    expect(result.status).toBe("FAIL");
    expect(result.exceptionErrors.join()).toContain("duplicada");
  });

  it("una excepción sin hallazgo, o sobre un MODERATE, es obsoleta y falla", () => {
    expect(check(findings(), [exceptionFor()]).status).toBe("FAIL");
    const moderate = check(findings({ ...HIGH, severity: "moderate" }), [exceptionFor()]);
    expect(moderate.status).toBe("FAIL");
    expect(moderate.exceptionErrors.join()).toContain("obsoleta");
  });

  it("una ruta exceptuada que ya no aparece es obsoleta y falla", () => {
    const result = check(findings({ ...HIGH, paths: ["backend>paquete-alto"] }), [exceptionFor()]);
    expect(result.status).toBe("FAIL");
    expect(result.exceptionErrors.join()).toContain("ya no aparecen");
  });

  it("un archivo sin la lista o con campos extra falla", () => {
    expect(validateExceptions({}, TODAY).errors).toHaveLength(1);
    expect(validateExceptions({ exceptions: [], ignorar: true }, TODAY).errors).toHaveLength(1);
  });
});

describe("salida de pnpm audit y ejecución completa", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const run = (stdout: string, entries: unknown[] = [], stderr = "") => {
    dir = mkdtempSync(join(tmpdir(), "dependency-security-"));
    const file = join(dir, "exceptions.json");
    writeFileSync(file, JSON.stringify({ exceptions: entries }));
    const summaryFile = join(dir, "summary.md");
    const lines: string[] = [];
    const code = main({
      root: dir,
      exceptionsPath: file,
      today: TODAY,
      audit: () => ({ status: 1, stdout, stderr }),
      out: (line) => lines.push(line),
      env: { GITHUB_STEP_SUMMARY: summaryFile, GITHUB_ACTIONS: "true" },
    });
    return { code, output: lines.join("\n"), summary: readFileSync(summaryFile, "utf8") };
  };

  it.each([
    ["vacía", ""],
    ["no JSON", "Error: algo falló"],
    ["sin avisos", JSON.stringify({ metadata: { vulnerabilities: {}, totalDependencies: 10 } })],
    [
      "sin dependencias revisadas",
      JSON.stringify({ advisories: {}, metadata: { vulnerabilities: {} } }),
    ],
    ["un objeto de error", JSON.stringify({ error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" } })],
  ])("una salida %s es ERROR y nunca PASS", (_case, stdout) => {
    const result = run(
      stdout,
      [],
      "ERR_PNPM_AUDIT_BAD_RESPONSE  Failed to request the audit endpoint",
    );
    expect(result.code).toBe(2);
    expect(result.output).toContain("DEPENDENCY SECURITY: ERROR");
    expect(result.output).toContain("ERR_PNPM_AUDIT_BAD_RESPONSE");
    expect(result.output).not.toContain("DEPENDENCY SECURITY: PASS");
    expect(result.summary).toContain("DEPENDENCY SECURITY: ERROR");
    expect(result.output).not.toContain("Failed to request");
  });

  it("sin avisos bloqueantes y con las excepciones válidas, PASS con código 0", () => {
    const result = run(audit(HIGH, { ...HIGH, id: "GHSA-mmmm-nnnn-oooo", severity: "moderate" }), [
      exceptionFor(),
    ]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("EXCEPTUADO");
    expect(result.output).toContain("vence el 2026-11-11");
    expect(result.output).toContain("INFORMADO");
    expect(result.output).toMatch(/DEPENDENCY SECURITY: PASS$/);
  });

  it("un hallazgo bloqueante es FAIL con código 1 y una anotación sin datos crudos", () => {
    const result = run(audit(HIGH));
    expect(result.code).toBe(1);
    expect(result.output).toContain("DEPENDENCY SECURITY: FAIL");
    expect(result.output).toContain(
      `::error title=DEPENDENCY SECURITY::${HIGH.id} high en ${HIGH.name}`,
    );
    expect(result.output).not.toContain('"findings"');
    expect(result.summary).toContain("| Bloquea |");
  });

  it("un archivo de excepciones ilegible es FAIL", () => {
    dir = mkdtempSync(join(tmpdir(), "dependency-security-"));
    const code = main({
      root: dir,
      exceptionsPath: join(dir, "no-existe.json"),
      today: TODAY,
      audit: () => ({ status: 0, stdout: audit(), stderr: "" }),
      out: () => {},
      env: {},
    });
    expect(code).toBe(1);
  });
});

describe("excepción real de braces (pin-openspec-ci-validation)", () => {
  const LINT = "frontend>@next/eslint-plugin-next>fast-glob>micromatch>braces";
  const OPENSPEC = ".>@fission-ai/openspec>fast-glob>micromatch>braces";
  const OTHER = "backend>otra-herramienta>fast-glob>micromatch>braces";
  const real = () => {
    const file = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "security", "dependency-audit-exceptions.json"),
        "utf8",
      ),
    ) as unknown;
    const { exceptions, errors } = validateExceptions(file, TODAY);
    expect(errors).toEqual([]);
    return exceptions.filter((e) => e.advisory === "GHSA-vfj7-8cjw-p6xm" && e.package === "braces");
  };
  const braces = (paths: string[]) =>
    findings({ id: "GHSA-vfj7-8cjw-p6xm", name: "braces", severity: "high", paths, dev: true });

  it("es una sola excepción que conserva su revisión y su vencimiento", () => {
    const [exception, ...rest] = real();
    expect(rest).toEqual([]);
    expect(exception).toMatchObject({ reviewed: "2026-10-12", expires: "2027-01-10" });
  });

  it("cubre la ruta del lint y la ruta exacta de OpenSpec", () => {
    const result = evaluate(braces([LINT, OPENSPEC]), real());
    expect(result.status).toBe("PASS");
    expect(result.excepted).toHaveLength(1);
  });

  it("una tercera ruta arbitraria hacia braces vuelve a bloquear", () => {
    const result = evaluate(braces([LINT, OPENSPEC, OTHER]), real());
    expect(result.status).toBe("FAIL");
    expect(result.blocking.map((f) => f.package)).toEqual(["braces"]);
  });
});
