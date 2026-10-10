// Comprobación final de la sesión de certificación en Pruebas, sin red
// (docs/quality/sri-test-environment-checklist.md, sección G). Lee la base de la instalación de la
// certificación (solo lectura), el archivo de entorno de la sesión, las confirmaciones del operador y
// el `verify` de la lista de permitidos. No contacta el SRI, ni Pruebas ni Producción, y no imprime
// el RUC, las identificaciones ni ningún secreto.
//
//   corepack pnpm --filter @facturador/backend sri:test-session-readiness \
//     --backend-env-file <archivo> --confirmations <archivo> [--egress-verify <archivo>] [--min-days 7]
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/platform/db/database.ts";
import {
  CERTIFICATION_DOCUMENT_TYPES,
  COUNTERPARTY_PLACEHOLDERS,
  evaluateSessionReadiness,
  type Confirmations,
  type EgressVerify,
  type Installation,
} from "./support/sri-test-session-readiness.ts";

const REPO = realpathSync(join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."));

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

/** Un archivo local con secretos: fuera del repositorio y solo para su dueño. */
function readPrivate(path: string, label: string): string {
  const real = realpathSync(path);
  if (real === REPO || real.startsWith(REPO + sep))
    throw new Error(`${label}: dentro del repositorio`);
  if ((statSync(real).mode & 0o077) !== 0)
    throw new Error(`${label}: permisos abiertos, se requiere 600`);
  return readFileSync(real, "utf8");
}

function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if (value.length >= 2 && /^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]!] = value;
  }
  return values;
}

const envFile = option("--backend-env-file");
const confirmationsFile = option("--confirmations");
if (!envFile || !confirmationsFile) {
  console.error(
    "uso: --backend-env-file <archivo> --confirmations <archivo> [--egress-verify <archivo>] [--min-days N]",
  );
  process.exit(2);
}
const env = parseEnv(readPrivate(envFile, "archivo de entorno"));
const confirmations = JSON.parse(readPrivate(confirmationsFile, "confirmaciones")) as Confirmations;
const egressFile = option("--egress-verify");
const egress = egressFile ? (JSON.parse(readFileSync(egressFile, "utf8")) as EgressVerify) : null;
if (!env.DATABASE_URL) throw new Error("el archivo de entorno no define DATABASE_URL");

const database = createDatabase(env.DATABASE_URL);
try {
  const prisma = database.prisma;
  const configs = await prisma.companyConfig.findMany({ include: { current: true } });
  const config = configs.length === 1 ? configs[0]! : null;
  const companyId = config?.companyId ?? "";
  const establishment = config
    ? await prisma.establishment.findUnique({
        where: { companyId_code: { companyId, code: confirmations.establishmentCode } },
      })
    : null;
  const point = establishment
    ? await prisma.emissionPoint.findUnique({
        where: {
          establishmentId_code: {
            establishmentId: establishment.id,
            code: confirmations.emissionPointCode,
          },
        },
      })
    : null;
  const sequences = point
    ? await prisma.fiscalSequence.findMany({ where: { companyId, emissionPointId: point.id } })
    : [];
  const certificate = config
    ? await prisma.signingCertificate.findFirst({
        where: { companyId, status: "ACTIVE" },
        include: { secret: { select: { certificateId: true } } },
      })
    : null;
  const counterpartiesInInstallation: Installation["counterpartiesInInstallation"] =
    Object.fromEntries(
      await Promise.all(
        COUNTERPARTY_PLACEHOLDERS.map(async (placeholder) => {
          const party = confirmations.counterparties[placeholder];
          const found =
            party && config
              ? await prisma.party.findFirst({
                  where: { companyId, identification: party.identification, status: "ACTIVE" },
                })
              : null;
          return [placeholder, found !== null] as const;
        }),
      ),
    );
  const installation: Installation = {
    companies: configs.length,
    environment: config?.current.environment ?? null,
    companyRuc: config?.current.ruc ?? null,
    documentsOutsideTest: config
      ? await prisma.electronicDocument.count({
          where: { companyId, environment: { not: "TEST" } },
        })
      : 0,
    establishmentActive: establishment ? establishment.active : null,
    emissionPointActive: point ? point.active : null,
    productionSequencesOnPoint: sequences.filter((s) => s.environment !== "TEST").length,
    testNextNumbers: Object.fromEntries(
      CERTIFICATION_DOCUMENT_TYPES.map((type) => [
        type,
        sequences.find((s) => s.environment === "TEST" && s.documentType === type)?.nextNumber ??
          null,
      ]),
    ),
    certificate: {
      present: certificate !== null,
      secretPresent: certificate?.secret !== null && certificate?.secret !== undefined,
      notAfter: certificate?.notAfter ?? null,
      detectedRuc: certificate?.detectedRuc ?? null,
    },
    counterpartiesInInstallation,
  };
  const minDays = option("--min-days");
  const checks = evaluateSessionReadiness({
    confirmations,
    env,
    egress,
    installation,
    now: new Date(),
    ...(minDays ? { minDaysToExpiry: Number(minDays) } : {}),
  });
  const ok = checks.every((check) => check.ok);
  console.log(
    JSON.stringify(
      { readiness: ok ? "PASS" : "FAIL", network: "NONE", at: new Date().toISOString(), checks },
      null,
      2,
    ),
  );
  process.exitCode = ok ? 0 : 1;
} finally {
  await database.close();
}
