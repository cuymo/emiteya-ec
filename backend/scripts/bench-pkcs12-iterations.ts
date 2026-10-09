// Coste de abrir un PKCS#12 según sus iteraciones (support-security-data-pkcs12-iteration-profile).
// Es un gate dedicado: no forma parte de `verify` ni de la suite de pruebas.
//
//   corepack pnpm --filter @facturador/backend bench:pkcs12-iterations [salida.json]
//
// Usa el código real dentro del pool criptográfico real, con el tamaño y el timeout por defecto de
// producción (CRYPTO_WORKERS=2, CRYPTO_TASK_TIMEOUT_MS=30000):
//   - el importador: la tarea `inspect-and-test-sign`, que aplica el techo de iteraciones, inspecciona
//     el P12 y lo abre otra vez para la firma de prueba;
//   - la firma de cada emisión: la tarea `sign-xml`, que abre el P12 una vez y no aplica el techo, de
//     modo que mide el coste de una apertura en todos los perfiles, también por encima del techo.
// Informa mediana y máximo (con 7 muestras, el P95 por rango más cercano es el máximo), CPU del
// proceso (hilo principal y workers), RSS máximo del proceso, dos importaciones simultáneas y el
// retraso máximo del event loop del hilo principal. Comprueba además que el timeout del pool corta
// un P12 abusivo con muchos contenedores dentro del tamaño máximo de subida.
//
// Solo usa P12 SINTÉTICOS, generados aquí con OpenSSL. La «forma Security Data» es la del perfil
// observado: PKCS#12 legado, MAC SHA-1 con N iteraciones, clave 3DES y certificados RC2-40 con N/2.
// Ningún certificado real.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { CERTIFICATE_MAX_BYTES_DEFAULT } from "@facturador/contracts";
import {
  certificateTasksEntry,
  createCertificateInspector,
} from "../src/modules/signing/infrastructure/certificate-inspector.ts";
import { MAX_PKCS12_ITERATIONS } from "../src/modules/signing/infrastructure/pkcs12/pkcs12-reader.ts";
import { createXmlSigningTask } from "../src/modules/signing/infrastructure/xml-signing-task.ts";
import { createXmlSigner } from "../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import {
  CryptoTimeoutError,
  createCryptoWorkerPool,
} from "../src/platform/workers/crypto-worker-pool.ts";
import {
  FIXTURE_PASSWORD,
  generateP12Fixtures,
  iterationCountsOf,
  legacyP12,
  withRepeatedContainers,
} from "../test/support/p12-fixtures.ts";

const ITERATIONS = [100_000, 102_400, 120_000, 131_072, 150_000, 200_000];
const REPETITIONS = 7;
const POOL = { size: 2, timeoutMs: 30_000 };
const output = process.argv[2] ?? "../docs/quality/benchmarks/pkcs12-iterations-2026-10-09.json";

const work = mkdtempSync(join(tmpdir(), "bench-pkcs12-"));
const fixtures = join(work, "p12");

type Profile = { name: string; key: string; mac: number; encryption: number; modern: boolean };

/** Legado con el MAC recalculado, o moderno uniforme (PBES2 y MAC SHA-256) exportado por OpenSSL. */
function build(profile: Profile): Buffer {
  let der: Buffer;
  if (profile.modern) {
    const out = join(work, `${profile.name}.p12`);
    execFileSync(
      "openssl",
      [
        "pkcs12",
        "-export",
        "-iter",
        String(profile.encryption),
        "-inkey",
        join(fixtures, `${profile.key}.key`),
        "-in",
        join(fixtures, `${profile.key}.crt`),
        "-certfile",
        join(fixtures, "ca.crt"),
        "-passout",
        `pass:${FIXTURE_PASSWORD}`,
        "-out",
        out,
      ],
      { stdio: "ignore" },
    );
    der = readFileSync(out);
  } else {
    der = legacyP12(fixtures, profile.key, profile.mac, profile.encryption);
  }
  verifiedByOpenssl(der, profile.modern);
  const counts = iterationCountsOf(der);
  if (counts[0] !== profile.mac || !counts.slice(1).every((c) => c === profile.encryption))
    throw new Error(`${profile.name}: contadores ${counts.join(",")}`);
  return der;
}

/** OpenSSL abre el P12 y verifica su MAC, de forma independiente de node-forge. */
function verifiedByOpenssl(der: Buffer, modern: boolean) {
  const file = join(work, "check.p12");
  writeFileSync(file, der);
  execFileSync(
    "openssl",
    [
      "pkcs12",
      ...(modern ? [] : ["-legacy"]),
      "-in",
      file,
      "-noout",
      "-passin",
      `pass:${FIXTURE_PASSWORD}`,
    ],
    { stdio: "ignore" },
  );
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
const ms = (value: number) => Math.round(value);

type Sample = { wallMs: number; cpuMs: number };

async function timed<T>(run: () => Promise<T>): Promise<Sample & { value: T }> {
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  const value = await run();
  const used = process.cpuUsage(cpuStart);
  return { value, wallMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000 };
}

const summary = (samples: Sample[]) => ({
  wallMs: {
    median: ms(median(samples.map((s) => s.wallMs))),
    max: ms(Math.max(...samples.map((s) => s.wallMs))),
  },
  cpuMs: {
    median: ms(median(samples.map((s) => s.cpuMs))),
    max: ms(Math.max(...samples.map((s) => s.cpuMs))),
  },
});

async function measure(profile: Profile, der: Buffer, fingerprint: string, xml: string) {
  const pool = createCryptoWorkerPool({ entry: certificateTasksEntry(), ...POOL });
  const importer = createCertificateInspector(pool);
  const signing = createXmlSigningTask(pool);
  // Cada llamada recibe su copia: la tarea de firma pone a cero el buffer que recibe.
  const importOnce = () => importer.inspect(Buffer.from(der), FIXTURE_PASSWORD);
  const signOnce = () =>
    signing.sign({
      xml,
      documentType: "01",
      p12: Buffer.from(der),
      password: FIXTURE_PASSWORD,
      fingerprint,
    });
  let peakRss = 0;
  const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 10);
  try {
    // Calentamiento de los dos workers.
    await Promise.all([importOnce(), signOnce()]);
    const first = await importOnce();
    const accepted = first.ok;
    const imports: Sample[] = [];
    const signs: Sample[] = [];
    for (let i = 0; i < REPETITIONS; i++) {
      const imported = await timed(importOnce);
      if (imported.value.ok !== accepted) throw new Error(`${profile.name}: importación inestable`);
      imports.push(imported);
      const signed = await timed(signOnce);
      if (!signed.value.ok) throw new Error(`${profile.name}: firma ${signed.value.code}`);
      signs.push(signed);
    }
    // Dos importaciones a la vez, una por worker del pool.
    const pair = await timed(() => Promise.all([importOnce(), importOnce()]));
    return {
      profile: profile.name,
      key: profile.key,
      scheme: profile.modern
        ? "PBES2 (AES-256-CBC, PBKDF2-HMAC-SHA256), MAC SHA-256"
        : "legado: MAC SHA-1, clave 3DES, certificados RC2-40",
      macIterations: profile.mac,
      encryptionIterations: profile.encryption,
      bytes: der.length,
      importer: {
        outcome: accepted
          ? "ACCEPTED"
          : `${first.code}${"reason" in first && first.reason ? `:${first.reason}` : ""}`,
        ...summary(imports),
        twoConcurrentWallMs: ms(pair.wallMs),
      },
      signXml: summary(signs),
      peakRssMiB: Math.round(peakRss / 1024 / 1024),
    };
  } finally {
    clearInterval(sampler);
    await pool.close();
  }
}

/** El P12 abusivo, importado con el pool de producción: el timeout lo corta o termina antes. */
async function abuse(der: Buffer, copies: number, iterations: number) {
  const pool = createCryptoWorkerPool({ entry: certificateTasksEntry(), ...POOL });
  try {
    const started = performance.now();
    let outcome: string;
    try {
      const result = await createCertificateInspector(pool).inspect(
        Buffer.from(der),
        FIXTURE_PASSWORD,
      );
      outcome = result.ok ? "ACCEPTED" : result.code;
    } catch (error) {
      outcome = error instanceof CryptoTimeoutError ? "CRYPTO_TIMEOUT" : "ERROR";
    }
    const wallMs = ms(performance.now() - started);
    // El worker reemplazado sigue sirviendo.
    const after = await createCertificateInspector(pool).inspect(
      Buffer.from(readFileSync(join(fixtures, "sd-utf8.legacy.p12"))),
      FIXTURE_PASSWORD,
    );
    return { iterations, copies, bytes: der.length, outcome, wallMs, poolServesAfter: after.ok };
  } finally {
    await pool.close();
  }
}

const loop = monitorEventLoopDelay({ resolution: 10 });
try {
  generateP12Fixtures(fixtures);
  const xml = createXmlSigner().testDocument();
  const fingerprintOf = (key: string) =>
    new X509Certificate(readFileSync(join(fixtures, `${key}.crt`))).fingerprint256
      .replaceAll(":", "")
      .toLowerCase();
  const profiles: Profile[] = [];
  for (const n of ITERATIONS) {
    profiles.push({ name: `sd-${n}`, key: "sd-utf8", mac: n, encryption: n / 2, modern: false });
    profiles.push({
      name: `legado-uniforme-${n}`,
      key: "sd-utf8",
      mac: n,
      encryption: n,
      modern: false,
    });
    profiles.push({
      name: `moderno-uniforme-${n}`,
      key: "sd-utf8",
      mac: n,
      encryption: n,
      modern: true,
    });
  }
  for (const n of [102_400, 131_072])
    profiles.push({
      name: `sd-${n}-rsa4096`,
      key: "rsa4096",
      mac: n,
      encryption: n / 2,
      modern: false,
    });

  // Los P12 se construyen antes de medir: su MAC se recalcula aquí, en el hilo principal.
  const built = profiles.map((profile) => ({ profile, der: build(profile) }));
  const abusiveDer = withRepeatedContainers(
    legacyP12(fixtures, "sd-utf8", MAX_PKCS12_ITERATIONS, MAX_PKCS12_ITERATIONS),
    MAX_PKCS12_ITERATIONS,
  );
  verifiedByOpenssl(abusiveDer, false);
  // Contadores: el MAC, el de la clave y uno por cada contenido cifrado de los certificados.
  const copies = iterationCountsOf(abusiveDer).length - 2;

  // Solo se mide el event loop mientras los workers trabajan.
  loop.enable();
  const rows = [];
  for (const { profile, der } of built) {
    const row = await measure(profile, der, fingerprintOf(profile.key), xml);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const abusive = await abuse(abusiveDer, copies, MAX_PKCS12_ITERATIONS);
  loop.disable();
  console.log(JSON.stringify({ abusive }));

  const result = {
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      os: release(),
      cpu: cpus()[0]?.model ?? "desconocida",
      cpuCount: cpus().length,
      memoryGiB: Math.round(totalmem() / 1024 ** 3),
      loadAverage: loadavg().map((v) => Number(v.toFixed(2))),
    },
    pool: POOL,
    maxPkcs12Iterations: MAX_PKCS12_ITERATIONS,
    certificateMaxBytes: CERTIFICATE_MAX_BYTES_DEFAULT,
    repetitions: REPETITIONS,
    mainThreadEventLoopMaxDelayMs: ms(loop.max / 1e6),
    rows,
    abusive,
  };
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({ output, mainThreadEventLoopMaxDelayMs: result.mainThreadEventLoopMaxDelayMs }),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
