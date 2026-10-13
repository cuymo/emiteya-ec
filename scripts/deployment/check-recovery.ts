// Ensayo de la recuperación (harden-deployment-proxy-and-recovery, design D11 y D12; spec
// `production-deployment`). Siembra datos sintéticos no fiscales en una topología de origen, la
// respalda con deploy/backup.sh, la restaura con deploy/restore.sh en un PostgreSQL 17 nuevo e
// independiente, arranca la aplicación sobre lo restaurado y compara. Sin emisión, firma ni
// transmisión de comprobantes, y sin ningún destino fuera de las redes locales de la prueba. Nunca
// imprime un secreto, el contenido cifrado ni el de los artefactos.
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_PASSWORD, generateP12Fixtures } from "../../backend/test/support/p12-fixtures.ts";
import { Checks, ROOT, run, until } from "./docker.ts";
import {
  compose,
  composeMust,
  createDeployment,
  destroyDeployment,
  edgeRequest,
  execNode,
  setSyntheticMasterKey,
  syntheticMasterKey,
  syntheticPng,
  SYNTHETIC_TAXPAYER,
  type Deployment,
} from "./fixtures.ts";

const BASE_HTTPS = Number(process.env.DEPLOYMENT_HTTPS_PORT ?? 18443) + 10;
const BASE_HTTP = Number(process.env.DEPLOYMENT_HTTP_PORT ?? 18080) + 10;
const BACKUP = join(ROOT, "deploy", "backup.sh");
const RESTORE = join(ROOT, "deploy", "restore.sh");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

const json = <T>(body: Buffer): T => JSON.parse(body.toString("utf8") || "{}") as T;

async function waitReady(d: Deployment): Promise<boolean> {
  const api = await until(
    () =>
      execNode(
        d,
        "backend",
        "fetch('http://127.0.0.1:4000/health/ready').then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))",
      ).status === 0,
    180_000,
    1_000,
  );
  return api && until(async () => (await edgeRequest(d, "/iniciar-sesion")).status === 200, 60_000);
}

async function signIn(d: Deployment, email: string, password: string) {
  const res = await edgeRequest(d, "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: d.publicOrigin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return {
    status: res.status,
    cookie: res
      .headerValues("set-cookie")
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}

/** Ejecuta SQL de solo lectura en el PostgreSQL del proyecto por su socket local. */
function sql(d: Deployment, query: string): string {
  const result = compose(
    d,
    [
      "exec",
      "-T",
      "postgres",
      "sh",
      "-c",
      'exec psql -X -q -t -A -F "|" -v ON_ERROR_STOP=1 --no-password --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"',
    ],
    [],
    query,
  );
  if (result.status !== 0) throw new Error(`consulta fallida: ${result.stderr.slice(-500)}`);
  return result.stdout.trim();
}

/**
 * Huella de la base: las migraciones aplicadas con su suma, y por cada tabla de `public` su recuento y
 * un resumen de su contenido completo. Solo se comparan; nunca se imprimen los resúmenes.
 */
function fingerprint(d: Deployment): Map<string, string> {
  const tables = sql(d, "select tablename from pg_tables where schemaname = 'public' order by 1;")
    .split("\n")
    .filter(Boolean);
  const parts = tables.map(
    (table) =>
      `select '${table}', count(*)::text, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from public."${table}" t`,
  );
  const rows = sql(d, `${parts.join(" union all ")};`)
    .split("\n")
    .filter(Boolean);
  const result = new Map<string, string>();
  for (const row of rows) {
    const [table, count, digest] = row.split("|");
    result.set(table!, `${count}|${digest}`);
  }
  result.set(
    "_migraciones",
    sql(
      d,
      "select string_agg(migration_name || ':' || checksum, ',' order by migration_name) from _prisma_migrations where finished_at is not null;",
    ),
  );
  return result;
}

function compareFingerprints(before: Map<string, string>, after: Map<string, string>) {
  const differing = [...new Set([...before.keys(), ...after.keys()])].filter(
    (key) => before.get(key) !== after.get(key),
  );
  const seeded = [...before.entries()].filter(
    ([key, value]) => key !== "_migraciones" && !value.startsWith("0|"),
  ).length;
  return { equal: differing.length === 0, differing, tables: before.size - 1, seeded };
}

/** Ejecuta un script de deploy/ con el entorno de Compose del proyecto, sin secretos en argumentos. */
function script(d: Deployment, path: string, args: string[]) {
  const started = Date.now();
  const result = run("bash", [path, ...args], { env: d.env });
  return { ...result, ms: Date.now() - started };
}

type Seed = {
  admin: { email: string; password: string };
  operatorEmail: string;
  logoSha: string;
  exportId: string;
};

async function seed(d: Deployment, checks: Checks, fixtures: string): Promise<Seed> {
  const session = await signIn(d, d.admin.email, d.admin.password);
  const mutate = (path: string, method: string, body: Buffer | string, type = "application/json") =>
    edgeRequest(d, path, {
      method,
      headers: { cookie: session.cookie, origin: d.publicOrigin, "content-type": type },
      body,
    });
  const taxpayer = await mutate("/api/v1/taxpayer", "PUT", JSON.stringify(SYNTHETIC_TAXPAYER));
  const version = json<{ data?: { version?: number } }>(taxpayer.body).data?.version ?? 0;
  const operatorEmail = "operacion@recuperacion.test";
  const operator = await mutate(
    "/api/v1/users",
    "POST",
    JSON.stringify({
      name: "Operación sintética",
      email: operatorEmail,
      password: `op-${randomBytes(10).toString("hex")}`,
      role: "OPERATOR",
    }),
  );
  const logo = syntheticPng(48);
  const upload = await mutate(
    `/api/v1/taxpayer/logo?expectedVersion=${version}`,
    "PUT",
    logo,
    "image/png",
  );
  // Certificado sintético del generador del repositorio, en la custodia cifrada; nunca se firma nada.
  const certificate = await mutate(
    "/api/v1/signing-certificate",
    "PUT",
    JSON.stringify({
      file: readFileSync(join(fixtures, "sd-utf8.modern.p12")).toString("base64"),
      password: FIXTURE_PASSWORD,
      expectedCurrentId: null,
    }),
  );
  const validity = await edgeRequest(d, "/api/v1/signing-certificate/validity", {
    headers: { cookie: session.cookie },
  });
  const requested = await mutate("/api/v1/data-exports", "POST", "{}");
  const exportId = json<{ data?: { id?: string } }>(requested.body).data?.id ?? "";
  const ready = await until(
    async () => {
      const res = await edgeRequest(d, `/api/v1/data-exports/${exportId}`, {
        headers: { cookie: session.cookie },
      });
      return json<{ data?: { status?: string } }>(res.body).data?.status === "READY";
    },
    180_000,
    2_000,
  );
  checks.record(
    "siembra sintética no fiscal: empresa, operador, logo, certificado custodiado y exportación lista",
    [200, 201].includes(taxpayer.status) &&
      operator.status === 201 &&
      upload.status === 200 &&
      certificate.status === 200 &&
      json<{ data?: { usable?: boolean } }>(validity.body).data?.usable === true &&
      ready,
    `empresa ${taxpayer.status}, operador ${operator.status}, logo ${upload.status}, certificado ${certificate.status}, exportación ${ready ? "READY" : "no lista"}`,
  );
  return { admin: d.admin, operatorEmail, logoSha: sha256(logo), exportId };
}

export async function main(): Promise<number> {
  const checks = new Checks();
  const work = mkdtempSync(join(tmpdir(), "emiteya-respaldos-"));
  chmodSync(work, 0o700);
  const fixtures = join(work, "p12");
  const source = createDeployment({
    project: "emiteya-recuperacion-origen",
    subnet: 240,
    httpsPort: BASE_HTTPS,
    httpPort: BASE_HTTP,
  });
  const target = createDeployment({
    project: "emiteya-recuperacion-destino",
    subnet: 241,
    httpsPort: BASE_HTTPS + 1,
    httpPort: BASE_HTTP + 1,
  });
  const scratch = createDeployment({
    project: "emiteya-recuperacion-pruebas",
    subnet: 242,
    httpsPort: BASE_HTTPS + 2,
    httpPort: BASE_HTTP + 2,
  });
  try {
    run("mkdir", ["-m", "700", fixtures]);
    generateP12Fixtures(fixtures);
    if (!process.env.DEPLOYMENT_SKIP_BUILD) composeMust(source, ["build"]);

    // Origen: topología completa y siembra.
    composeMust(source, ["up", "-d", "--no-build"]);
    if (!checks.record("la topología de origen queda lista", await waitReady(source)))
      return checks.summary("deployment:recovery");
    const seeded = await seed(source, checks, fixtures);

    // Sin mutaciones durante el respaldo de la prueba: se detiene la aplicación, no PostgreSQL.
    composeMust(source, ["stop", "--timeout", "30", "proxy", "frontend", "backend"]);
    const before = fingerprint(source);

    const backup = script(source, BACKUP, [work]);
    const dumpName = /respaldo: .*\/(emiteya-[0-9TZ]+\.dump) /.exec(backup.stdout)?.[1] ?? "";
    const dump = join(work, dumpName);
    const recorded = dumpName ? readFileSync(`${dump}.sha256`, "utf8").split(" ")[0] : "";
    const mode = dumpName ? (statSync(dump).mode & 0o777).toString(8) : "";
    checks.record(
      "el respaldo produce el volcado de PostgreSQL 17 con su SHA-256, en modo 0600",
      backup.status === 0 &&
        dumpName !== "" &&
        recorded === sha256(readFileSync(dump)) &&
        mode === "600",
      `${backup.ms} ms, ${dumpName ? statSync(dump).size : 0} bytes`,
    );
    const dumpHeader = dumpName ? readFileSync(dump).subarray(0, 5).toString("latin1") : "";
    checks.record("el volcado es del formato propio de PostgreSQL", dumpHeader === "PGDMP");
    checks.record(
      "el volcado no contiene la clave maestra de la custodia",
      dumpName !== "" &&
        !readFileSync(dump).includes(Buffer.from(syntheticMasterKey(source).trim())),
    );

    // Negativas sobre un PostgreSQL vacío de pruebas.
    composeMust(scratch, ["up", "-d", "--wait", "postgres"]);
    const corrupted = join(work, "alterado.dump");
    const bytes = readFileSync(dump);
    bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)]! ^ 0xff;
    writeFileSync(corrupted, bytes, { mode: 0o600 });
    copyFileSync(`${dump}.sha256`, `${corrupted}.sha256`);
    const corruptedRun = script(scratch, RESTORE, [corrupted]);
    const scratchObjects = sql(
      scratch,
      "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%';",
    );
    checks.record(
      "un volcado alterado no pasa la suma y no toca el destino",
      corruptedRun.status === 3 && scratchObjects === "0",
      `código ${corruptedRun.status}, objetos en el destino ${scratchObjects}`,
    );
    const truncated = join(work, "truncado.dump");
    const half = readFileSync(dump).subarray(0, Math.floor(readFileSync(dump).length / 2));
    writeFileSync(truncated, half, { mode: 0o600 });
    writeFileSync(`${truncated}.sha256`, `${sha256(half)}  truncado.dump\n`, { mode: 0o600 });
    const truncatedRun = script(scratch, RESTORE, [truncated]);
    checks.record(
      "un volcado truncado con su suma recalculada hace fallar pg_restore, que lo informa",
      truncatedRun.status === 5 && truncatedRun.stderr.includes("no está recuperada"),
      `código ${truncatedRun.status}`,
    );

    // Destino: un PostgreSQL 17 nuevo e independiente, solo la base de datos.
    composeMust(target, ["up", "-d", "--wait", "postgres"]);
    const restore = script(target, RESTORE, [dump]);
    checks.record(
      "la restauración en una base nueva termina con éxito",
      restore.status === 0,
      `${restore.ms} ms`,
    );
    const restored = compareFingerprints(before, fingerprint(target));
    checks.record(
      "las migraciones y el contenido de cada tabla coinciden con el origen",
      restored.equal,
      restored.equal
        ? `${restored.tables} tablas, ${restored.seeded} con filas`
        : `distintas: ${restored.differing.join(", ")}`,
    );
    const again = script(target, RESTORE, [dump]);
    const afterRefusal = compareFingerprints(before, fingerprint(target));
    checks.record(
      "una segunda restauración sobre la base restaurada se niega y no cambia nada",
      again.status === 4 && afterRefusal.equal,
      `código ${again.status}`,
    );

    const migrate = compose(target, ["up", "--no-build", "--no-deps", "migrate"]);
    const migrateLogs = compose(target, ["logs", "--no-log-prefix", "migrate"]).stdout;
    const afterMigrate = compareFingerprints(before, fingerprint(target));
    checks.record(
      "las migraciones sobre la base restaurada no cambian datos",
      migrate.status === 0 && migrateLogs.includes("No pending migrations") && afterMigrate.equal,
    );

    // La aplicación sobre lo restaurado, con la misma clave maestra sintética del origen.
    setSyntheticMasterKey(target, syntheticMasterKey(source));
    composeMust(target, ["up", "-d", "--no-build"]);
    checks.record(
      "la aplicación arranca sobre la base restaurada y queda lista",
      await waitReady(target),
    );
    const session = await signIn(target, seeded.admin.email, seeded.admin.password);
    const users = await edgeRequest(target, "/api/v1/users", {
      headers: { cookie: session.cookie },
    });
    const logo = await edgeRequest(target, "/api/v1/taxpayer/logo", {
      headers: { cookie: session.cookie },
    });
    checks.record(
      "el administrador, el operador y el logo restaurados se usan por la API",
      session.status === 200 &&
        users.body.toString().includes(seeded.operatorEmail) &&
        sha256(logo.body) === seeded.logoSha,
    );
    const validity = await edgeRequest(target, "/api/v1/signing-certificate/validity", {
      headers: { cookie: session.cookie },
    });
    const sameKey = json<{ data?: { state?: string; usable?: boolean } }>(validity.body).data;
    checks.record(
      "con la misma clave maestra, el certificado custodiado vuelve a estar disponible",
      sameKey?.usable === true,
      `estado ${sameKey?.state}`,
    );
    // El barrido de la portabilidad detecta al arrancar el paquete listo sin su archivo
    // (add-data-portability, design D14): la exportación queda fallida y auditada, nunca se entrega.
    const exportView = await edgeRequest(target, `/api/v1/data-exports/${seeded.exportId}`, {
      headers: { cookie: session.cookie },
    });
    const failed = json<{ data?: { status?: string; errorCode?: string } }>(exportView.body).data;
    const download = await edgeRequest(target, `/api/v1/data-exports/${seeded.exportId}/download`, {
      headers: { cookie: session.cookie },
    });
    const audited = sql(
      target,
      "select count(*) from audit_event where action = 'data_export.failed';",
    );
    checks.record(
      "el paquete sin su archivo queda fallido con DATA_EXPORT_PACKAGE_MISSING, auditado y sin entregarse",
      failed?.status === "FAILED" &&
        failed.errorCode === "DATA_EXPORT_PACKAGE_MISSING" &&
        audited === "1" &&
        download.status !== 200 &&
        download.body.subarray(0, 2).toString() !== "PK",
      `estado ${failed?.status} ${failed?.errorCode}, descarga ${download.status}, auditoría ${audited}`,
    );
    const regenerated = await edgeRequest(target, "/api/v1/data-exports", {
      method: "POST",
      headers: {
        cookie: session.cookie,
        origin: target.publicOrigin,
        "content-type": "application/json",
      },
      body: "{}",
    });
    checks.record(
      "la empresa puede generar una exportación nueva",
      [201, 202].includes(regenerated.status),
      `${regenerated.status}`,
    );

    // Otra clave maestra sintética: la aplicación funciona y la custodia no se abre.
    composeMust(target, ["stop", "--timeout", "30", "backend"]);
    setSyntheticMasterKey(target);
    composeMust(target, ["up", "-d", "--no-build", "--force-recreate", "backend"]);
    const readyWithOtherKey = await waitReady(target);
    const other = await signIn(target, seeded.admin.email, seeded.admin.password);
    const otherValidity = await edgeRequest(target, "/api/v1/signing-certificate/validity", {
      headers: { cookie: other.cookie },
    });
    const otherKey = json<{ data?: { state?: string; usable?: boolean } }>(otherValidity.body).data;
    const backendLogs = compose(target, ["logs", "--no-log-prefix", "backend"]).stdout;
    checks.record(
      "con otra clave maestra, la aplicación queda lista y el certificado aparece no disponible",
      readyWithOtherKey && otherKey?.state === "KEY_UNAVAILABLE" && otherKey.usable === false,
      `estado ${otherKey?.state}`,
    );
    checks.record(
      "el registro solo informa la firma no disponible, sin secretos",
      backendLogs.includes(
        "la firma vigente no se puede abrir con la clave de custodia configurada",
      ) &&
        !backendLogs.includes(FIXTURE_PASSWORD) &&
        !backendLogs.includes(syntheticMasterKey(source).trim()),
    );
    checks.record(
      "SRI_TRANSMISSION_ENABLED=0 y sin salida a Internet en el origen y el destino",
      [source, target].every(
        (d) =>
          run("docker", [
            "network",
            "inspect",
            "-f",
            "{{.Internal}}",
            `${d.project}_app`,
          ]).stdout.trim() === "true" &&
          (
            JSON.parse(composeMust(d, ["config", "--format", "json"]).stdout) as {
              services: Record<string, { environment?: Record<string, string> }>;
            }
          ).services.backend?.environment?.SRI_TRANSMISSION_ENABLED === "0",
      ),
    );
    console.log(
      `duraciones (evidencia, no un RTO ni un RPO): respaldo ${backup.ms} ms, restauración ${restore.ms} ms`,
    );
  } catch (error) {
    checks.record("el ensayo terminó sin errores inesperados", false, String(error).slice(0, 500));
  } finally {
    for (const d of [source, target, scratch]) destroyDeployment(d);
    rmSync(work, { recursive: true, force: true });
  }
  return checks.summary("deployment:recovery");
}

if (import.meta.main) process.exitCode = await main();
