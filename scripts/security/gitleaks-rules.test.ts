// Reglas de Gitleaks contra el binario fijado (add-ci-dependency-and-secret-scanning, design D6 y D7):
// las reglas por defecto siguen activas, las del proyecto detectan sus casos y los valores permitidos
// no se informan. Cada caso es un repositorio git temporal fuera del proyecto, con valores sintéticos
// generados al vuelo; nunca se empuja nada. El binario sale de GITLEAKS_BIN o del PATH.
import { spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../check-secret-security.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const GITLEAKS = process.env.GITLEAKS_BIN ?? "gitleaks";
const PIN = JSON.parse(readFileSync(join(ROOT, "security", "gitleaks.json"), "utf8")) as {
  version: string;
};
const created: string[] = [];

const alnum = (length: number) =>
  Array.from(
    { length },
    () => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(56)],
  ).join("");
const pem = (label: string) => {
  const body = randomBytes(600)
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
};

beforeAll(() => {
  const version = spawnSync(GITLEAKS, ["version"], { encoding: "utf8" });
  if (version.error || version.stdout.trim() !== PIN.version) {
    throw new Error(
      `Estas pruebas necesitan Gitleaks ${PIN.version} (GITLEAKS_BIN o PATH); se encontró ${
        version.error ? "ninguno" : version.stdout.trim()
      }.`,
    );
  }
});

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Un repositorio temporal con la configuración del proyecto y los archivos dados en un commit. */
function repository(files: Record<string, string | Buffer>, ignore?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gitleaks-rules-"));
  created.push(dir);
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "prueba@example.test");
  git("config", "user.name", "Prueba");
  copyFileSync(join(ROOT, ".gitleaks.toml"), join(dir, ".gitleaks.toml"));
  mkdirSync(join(dir, "security"));
  copyFileSync(join(ROOT, "security", "gitleaks.json"), join(dir, "security", "gitleaks.json"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  if (ignore !== undefined) writeFileSync(join(dir, ".gitleaksignore"), ignore);
  git("add", "-A");
  git("commit", "-qm", "casos sintéticos");
  return dir;
}

function scan(dir: string): { code: number; output: string } {
  const lines: string[] = [];
  const code = main({
    root: dir,
    ci: true,
    gitleaks: GITLEAKS,
    out: (l) => lines.push(l),
    env: {},
  });
  return { code, output: lines.join("\n") };
}

describe("detectados", () => {
  const cases: [string, Record<string, string | Buffer>, string, string][] = (() => {
    const token = `ghp_${alnum(36)}`;
    const masterKey = randomBytes(32).toString("base64");
    const authSecret = alnum(40);
    const dbPassword = alnum(16);
    return [
      [
        "una regla por defecto (token de GitHub)",
        { "config/github.txt": `token = "${token}"\n` },
        "github-pat",
        token,
      ],
      [
        "la clave maestra",
        { "deploy/api.env.txt": `CERTIFICATE_MASTER_KEY=${masterKey}\n` },
        "project-certificate-master-key",
        masterKey,
      ],
      [
        "el secreto de Better Auth",
        { "deploy/auth.conf": `BETTER_AUTH_SECRET=${authSecret}\n` },
        "project-better-auth-secret",
        authSecret,
      ],
      [
        "una URL de PostgreSQL con contraseña",
        { "deploy/db.conf": `DATABASE_URL=postgresql://app:${dbPassword}@db.interno:5432/app\n` },
        "project-postgres-url-password",
        dbPassword,
      ],
      [
        "una clave privada PEM",
        { "deploy/clave.pem": pem("PRIVATE KEY") },
        "private-key",
        "BEGIN PRIVATE KEY",
      ],
    ];
  })();

  it.each(cases)("%s, sin mostrar el valor", (_case, files, rule, value) => {
    const result = scan(repository(files));
    expect(result.code).toBe(1);
    expect(result.output).toContain(`SECRETO  ${rule} en `);
    expect(result.output).not.toContain(value);
    expect(result.output).toContain("SECRET SECURITY: FAIL");
  });

  it.each([
    ["un PKCS#12 binario", { "certs/firma.p12": randomBytes(1024) }, "archivo PKCS#12"],
    ["un PFX binario", { "certs/firma.pfx": randomBytes(1024) }, "archivo PKCS#12"],
    [
      "el archivo de secretos local",
      { "archivosensible.env": `CLAVE=${alnum(20)}\n` },
      "archivo de secretos local",
    ],
    ["un .env versionado", { "backend/.env": `PORT=4000\n` }, "archivo .env real"],
  ])("%s, sin mostrar el nombre del archivo", (_case, files, category) => {
    const result = scan(repository(files));
    expect(result.code).toBe(1);
    expect(result.output).toContain(`ARCHIVO  ${category} en `);
    expect(result.output).not.toMatch(/firma\.p12|firma\.pfx|archivosensible\.env|\/\.env\b/);
  });
});

describe("permitidos", () => {
  it("el .env.example, un certificado público y una clave de acceso del SRI no se informan", () => {
    const accessKey = Array.from({ length: 49 }, () => String(randomInt(10))).join("");
    const result = scan(
      repository({
        "backend/.env.example": readFileSync(join(ROOT, "backend", ".env.example"), "utf8"),
        "docs/publico.crt": pem("CERTIFICATE"),
        "fixtures/clave-acceso.txt": `claveAcceso = "${accessKey}"\nnumeroAutorizacion = "${accessKey}"\n`,
      }),
    );
    expect(result.output).toMatch(/SECRET SECURITY: PASS$/);
    expect(result.code).toBe(0);
  });

  it("los valores marcados como de pruebas y los ejemplos documentados no se informan", () => {
    const env = readFileSync(join(ROOT, "backend", "src", "config", "env.ts"), "utf8");
    const example = (name: string) => new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(env)![1]!;
    const result = scan(
      repository({
        "test/harness.ts": [
          `const secret = "secreto-de-pruebas-${alnum(20)}";`,
          `const env = { BETTER_AUTH_SECRET: "secreto-de-pruebas-${alnum(20)}" };`,
          `const ci = { BETTER_AUTH_SECRET: "ci-solo-para-verificacion-${alnum(16)}" };`,
          `const newPassword = "contrasena-propia-nueva-1";`,
          `const IDEMPOTENCY_KEY = "${alnum(24)}";`,
          "",
        ].join("\n"),
        "deploy/ejemplo.env.txt": [
          `CERTIFICATE_MASTER_KEY=${example("EXAMPLE_CERTIFICATE_MASTER_KEY")}`,
          `BETTER_AUTH_SECRET=${example("EXAMPLE_AUTH_SECRET")}`,
          "DATABASE_URL=postgresql://facturador:facturador@127.0.0.1:5432/facturador_dev",
          "",
        ].join("\n"),
      }),
    );
    expect(result.output).toMatch(/SECRET SECURITY: PASS$/);
  });

  it("una huella de contenido en .gitleaksignore suprime solo ese hallazgo", () => {
    const files = { "config/github.txt": `token = "ghp_${alnum(36)}"\n` };
    const dir = repository(files);
    const report = join(dir, "informe.json");
    spawnSync(GITLEAKS, [
      "git",
      "--no-banner",
      "--redact",
      "--exit-code=0",
      "-c",
      join(dir, ".gitleaks.toml"),
      "-f",
      "json",
      "-r",
      report,
      dir,
    ]);
    const [finding] = JSON.parse(readFileSync(report, "utf8")) as { Fingerprint: string }[];
    rmSync(report);
    writeFileSync(
      join(dir, ".gitleaksignore"),
      `# Falso positivo de prueba, revisado.\n${finding!.Fingerprint}\n`,
    );
    expect(scan(dir).code).toBe(0);
  });

  it("un comentario gitleaks:allow no suprime un hallazgo", () => {
    const result = scan(
      repository({ "config/github.txt": `token = "ghp_${alnum(36)}" # gitleaks:allow\n` }),
    );
    expect(result.code).toBe(1);
  });
});
