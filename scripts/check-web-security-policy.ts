/// <reference lib="dom" />
// Comprobación del build de producción del frontend en un navegador real
// (enforce-frontend-security-headers-csp, design D9). Arranca el backend con el arnés end-to-end, un
// SRI SIMULADO y la firma sintética de las pruebas, y `next start` del build en el origen de las
// pruebas. Recorre los flujos legítimos en Chrome, recoge las violaciones de la política y falla ante
// cualquiera inesperada. Nunca contacta el SRI real: el SRI simulado vive en un host que no resuelve
// por DNS y solo se alcanza por su proxy local. Con la sesión abierta, dos páginas atacantes en el
// puerto 3001 comprueban además el origen de /api/v1 (enforce-api-origin-and-body-limits, design D10).
//
// Uso, después de `corepack pnpm build`:
//   corepack pnpm check:web-security-policy                  comprobación completa
//   corepack pnpm check:web-security-policy --measure-styles  añade la medición de estilos (design D4)
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type RequestListener,
  type Server,
} from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from "playwright-core";
import { pngBytes } from "../backend/test/fixtures/images.ts";
import {
  createMigratedSchema,
  requireTestDatabase,
  type MigratedSchema,
} from "../backend/test/integration/database.ts";
import {
  E2E_ORIGIN,
  startE2eBackend,
  type E2eBackend,
} from "../backend/test/integration/e2e-backend.ts";
import {
  FIXTURE_PASSWORD,
  FIXTURE_RUC,
  generateP12Fixtures,
  readFixture,
} from "../backend/test/support/p12-fixtures.ts";
import {
  SRI_HOST,
  listen,
  outboundProxy,
  simulatedSri,
} from "../backend/test/support/simulated-sri.ts";

const ROOT = join(import.meta.dirname, "..");
const FRONTEND = join(ROOT, "frontend");
const ADMIN = { email: "admin@csp.check", password: "contrasena-admin-csp-1" };
const STEP_TIMEOUT_MS = 30_000;
/** Puerto de las páginas atacantes: `localhost` es del mismo sitio que el origen, `127.0.0.1` no. */
const ATTACKER_PORT = 3001;
const measureStyles = process.argv.includes("--measure-styles");

type Violation = {
  directive: string;
  blocked: string;
  disposition: string;
  sample: string;
  source: string;
  phase: string;
};
type Result = { name: string; ok: boolean; detail: string };

const results: Result[] = [];
const startedAt = Date.now();
const timings: string[] = [];
/** Tiempo transcurrido por fase, para vigilar la duración de la comprobación en la CI. */
function mark(label: string): void {
  timings.push(`${label} ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
}
function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(true))
      .listen(port, () => server.close(() => resolve(false)));
  });
}

/** Puerto del backend al que el build reenvía `/api`, leído del manifiesto de rutas de Next.js. */
function apiPortOfBuild(): number {
  const manifest = JSON.parse(
    readFileSync(join(FRONTEND, ".next", "routes-manifest.json"), "utf8"),
  ) as { rewrites: { fallback?: { source: string; destination: string }[] } };
  const rule = manifest.rewrites.fallback?.find((r) => r.source === "/api/:path*");
  const target = rule ? new URL(rule.destination.replace("/api/:path*", "/")) : undefined;
  if (!target || !["127.0.0.1", "localhost"].includes(target.hostname)) {
    throw new Error("el build no reenvía /api a un backend local");
  }
  return Number(target.port || 80);
}

/** Petición GET con las cabeceras crudas: permite contar cuántas veces llega una cabecera. */
function rawGet(
  url: string,
): Promise<{ status: number; raw: string[]; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    httpRequest(url, { method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) {
          headers[name] = Array.isArray(value) ? value.join(", ") : (value ?? "");
        }
        resolve({ status: res.statusCode ?? 0, raw: res.rawHeaders, headers, body });
      });
    })
      .on("error", reject)
      .end();
  });
}

const nonceOf = (policy: string | undefined) => /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;
const directivesOf = (policy: string) =>
  new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/);
      return [name, sources] as const;
    }),
  );

async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no se cumplió a tiempo: ${what}`);
}

/** Variantes de estilos que mide `--measure-styles` como políticas solo informativas (design D4). */
const STYLE_VARIANTS = {
  A: (nonce: string) => `style-src-elem 'self' 'nonce-${nonce}'; style-src-attr 'none'`,
  B: () => "style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none'",
} as const;

async function main(): Promise<number> {
  if (!existsSync(join(FRONTEND, ".next", "BUILD_ID"))) {
    console.error(
      "check:web-security-policy: falta el build del frontend; ejecuta antes `corepack pnpm build`.",
    );
    return 1;
  }
  if (await portInUse(3000)) {
    console.error(
      `check:web-security-policy: el puerto 3000 está ocupado; el origen de las pruebas es ${E2E_ORIGIN}.`,
    );
    return 1;
  }
  if (await portInUse(ATTACKER_PORT)) {
    console.error(
      `check:web-security-policy: el puerto ${ATTACKER_PORT} de las páginas atacantes está ocupado.`,
    );
    return 1;
  }
  await requireTestDatabase();

  const fixtures = mkdtempSync(join(tmpdir(), "facturador-csp-p12-"));
  const sri = simulatedSri();
  const proxy = outboundProxy(await listen(sri.server));
  const proxyUrl = `http://127.0.0.1:${await listen(proxy.server)}`;
  let db: MigratedSchema | undefined;
  let backend: E2eBackend | undefined;
  let next: ChildProcess | undefined;
  let nextOutput = "";
  let browserClose: (() => Promise<void>) | undefined;

  try {
    generateP12Fixtures(fixtures);
    mark("firma sintética");
    db = await createMigratedSchema("web_security_policy");
    mark("esquema migrado");
    // El reenvío de `/api` queda fijado en el build (`next.config.ts` lee API_INTERNAL_URL al
    // compilar): el backend escucha en el puerto que dice el manifiesto de rutas.
    const backendPort = apiPortOfBuild();
    if (await portInUse(backendPort)) {
      throw new Error(`el puerto ${backendPort} del reenvío de /api está ocupado`);
    }
    backend = await startE2eBackend({
      label: "web_security_policy",
      admin: ADMIN,
      db,
      port: backendPort,
      env: {
        CERTIFICATE_CUSTODY: "enabled",
        CERTIFICATE_MASTER_KEY: randomBytes(32).toString("base64"),
        NODE_USE_ENV_PROXY: "1",
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        SRI_TRANSMISSION_ENABLED: "1",
        SRI_JOB_POLL_INTERVAL_MS: "200",
        SRI_AUTHORIZATION_FIRST_DELAY_SECONDS: "0",
        SRI_POLL_BACKOFF_BASE_SECONDS: "1",
        SRI_POLL_BACKOFF_CAP_SECONDS: "2",
        SRI_ENDPOINT_TEST_RECEPTION: `http://${SRI_HOST}/comprobantes-electronicos-ws/RecepcionComprobantesOffline`,
        SRI_ENDPOINT_TEST_AUTHORIZATION: `http://${SRI_HOST}/comprobantes-electronicos-ws/AutorizacionComprobantesOffline`,
        SRI_ENDPOINT_TEST_VALIDITY: `http://${SRI_HOST}/comprobantes-electronicos-ws/ConsultaComprobante`,
      },
    });
    mark("backend listo");
    const invoice = await prepareCompany(backend, db, fixtures);
    mark("factura autorizada con su RIDE");

    next = spawn(join(FRONTEND, "node_modules", ".bin", "next"), ["start", "--port", "3000"], {
      cwd: FRONTEND,
      env: { PATH: process.env.PATH, API_INTERNAL_URL: `http://127.0.0.1:${backendPort}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    next.stdout?.on("data", (chunk: Buffer) => (nextOutput += chunk.toString()));
    next.stderr?.on("data", (chunk: Buffer) => (nextOutput += chunk.toString()));
    await until(
      () =>
        fetch(`${E2E_ORIGIN}/iniciar-sesion`).then(
          (res) => res.ok,
          () => false,
        ),
      "next start responde",
    );

    mark("next start listo");
    const nonces = new Set<string>();
    await checkHeaders(invoice.id, nonces);

    const browser = await chromium.launch({ channel: "chrome", headless: true });
    browserClose = () => browser.close();
    const context = await browser.newContext({ baseURL: E2E_ORIGIN, acceptDownloads: true });
    const violations: Violation[] = [];
    const state = { phase: "carga" };
    await watchViolations(context, violations, state, nonces);
    mark("cabeceras");
    await checkBrowserFlows(context, invoice, violations, state);
    mark("flujos");
    await checkProvokedViolations(context, violations, state);
    mark("violaciones provocadas");
    await context.close();

    const unexpected = violations.filter(
      (v) => v.disposition === "enforce" && !v.phase.startsWith("provocada:"),
    );
    check(
      "20. Ninguna violación inesperada de la política",
      unexpected.length === 0,
      unexpected.length === 0
        ? "0 violaciones fuera de las provocadas"
        : unexpected
            .map((v) => `${v.phase}: ${v.directive} ${v.blocked} (${v.source})`)
            .join(" | "),
    );

    await checkCrossSiteRequests(browser, invoice, backend, db);
    mark("origen de /api/v1");

    if (measureStyles) await measureStyleVariants(browser, invoice.number);

    check(
      "Nonce fuera de la salida de next start",
      [...nonces].every((nonce) => !nextOutput.includes(nonce)),
      `${nonces.size} nonces observados; ninguno en la salida`,
    );
  } catch (error) {
    check(
      "Ejecución de la comprobación",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    await browserClose?.().catch(() => undefined);
    if (next && next.exitCode === null) {
      const exited = new Promise((resolve) => next!.once("exit", resolve));
      next.kill("SIGTERM");
      await exited;
    }
    await backend?.stop().catch(() => undefined);
    await db?.drop().catch(() => undefined);
    sri.server.close();
    proxy.server.close();
    rmSync(fixtures, { recursive: true, force: true });
  }

  for (const result of results) {
    console.log(
      `${result.ok ? "  OK  " : "  FAIL"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`,
    );
  }
  mark("fin");
  console.log(`  Tiempos: ${timings.join(" · ")}`);
  const failed = results.filter((result) => !result.ok).length;
  console.log(
    failed === 0
      ? `check:web-security-policy: ${results.length} comprobaciones en verde.`
      : `check:web-security-policy: ${failed} de ${results.length} comprobaciones fallaron.`,
  );
  return failed === 0 ? 0 : 1;
}

/** Empresa lista para emitir y una factura autorizada por el SRI simulado, con su RIDE. */
async function prepareCompany(backend: E2eBackend, db: MigratedSchema, fixtures: string) {
  const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
  const api = async <T>(method: string, path: string, body?: unknown) => {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T };
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    return json.data;
  };
  const taxpayer = await api<{ version: number | null }>("PUT", "/taxpayer", {
    ruc: FIXTURE_RUC,
    legalName: "COMERCIAL ANDINA S.A.",
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    accountingRequired: true,
    expectedVersion: null,
  });
  const logo = await fetch(
    `${backend.base}/api/v1/taxpayer/logo?expectedVersion=${taxpayer.version ?? 1}`,
    {
      method: "PUT",
      headers: { cookie, origin: E2E_ORIGIN, "content-type": "image/png" },
      body: new Uint8Array(pngBytes(80, 40, 9)),
    },
  );
  if (logo.status !== 200) throw new Error(`PUT /taxpayer/logo: ${logo.status}`);
  const establishment = await api<{ id: string }>("POST", "/establishments", {
    code: "001",
    address: "Av. 6 de Diciembre, Quito",
  });
  const point = await api<{ id: string }>(
    "POST",
    `/establishments/${establishment.id}/emission-points`,
    { code: "001" },
  );
  await api("PUT", "/signing-certificate", {
    file: readFixture(fixtures, "sd-utf8.modern.p12").toString("base64"),
    password: FIXTURE_PASSWORD,
    expectedCurrentId: null,
  });
  const customer = await api<{ id: string }>("POST", "/parties", {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "FERRETERÍA EL PERNO CÍA. LTDA.",
    address: "Guayaquil",
    roles: ["CUSTOMER"],
  });
  const product = await api<{ id: string }>("POST", "/products", {
    kind: "GOOD",
    mainCode: "CEM-50",
    name: "Cemento 50 kg",
    unitPrice: "8.75",
    taxes: { iva: "4" },
  });
  const draft = await api<{ id: string; version: number }>("POST", "/invoices/drafts", {
    emissionPointId: point.id,
    buyerPartyId: customer.id,
    lines: [{ productId: product.id, quantity: "3", discount: "1.25" }],
    payments: [{ paymentMethod: "01" }],
  });
  const emitted = await fetch(`${backend.base}/api/v1/invoices`, {
    method: "POST",
    headers: {
      cookie,
      origin: E2E_ORIGIN,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ draftId: draft.id, expectedVersion: draft.version }),
  });
  if (emitted.status !== 201) throw new Error(`POST /invoices: ${emitted.status}`);
  const invoice = ((await emitted.json()) as { data: { id: string; documentNumber: string } }).data;
  const prisma = db.database.prisma;
  await until(
    async () =>
      (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: invoice.id } })).state ===
      "AUTHORIZED",
    "factura autorizada por el SRI simulado",
  );
  await until(
    async () =>
      (await prisma.documentArtifact.findFirst({
        where: { documentId: invoice.id, kind: "RIDE_PDF" },
      })) !== null,
    "RIDE generado",
  );
  return { id: invoice.id, number: invoice.documentNumber };
}

/** Cabeceras, caché y nonce de los documentos, contra el servidor del build (design D9). */
async function checkHeaders(invoiceId: string, nonces: Set<string>): Promise<void> {
  const paths = ["/iniciar-sesion", "/facturas", `/facturas/${invoiceId}`];
  const documents = [];
  for (const path of paths) documents.push({ path, ...(await rawGet(`${E2E_ORIGIN}${path}`)) });
  const again = await rawGet(`${E2E_ORIGIN}/facturas`);

  const policies = documents.map((doc) => doc.headers["content-security-policy"] ?? "");
  const cspCounts = documents.map(
    (doc) =>
      doc.raw.filter(
        (_, i) => i % 2 === 0 && doc.raw[i]!.toLowerCase() === "content-security-policy",
      ).length,
  );
  check("1. La cabecera CSP existe", policies.every(Boolean), paths.join(", "));
  check(
    "2. La CSP se aplica, no solo informa",
    documents.every((doc) => !doc.headers["content-security-policy-report-only"]),
    "sin Content-Security-Policy-Report-Only",
  );
  check(
    "3. Exactamente una CSP",
    cspCounts.every((count) => count === 1) &&
      documents.every(
        (doc) => !/<meta[^>]+http-equiv=["']?content-security-policy/i.test(doc.body),
      ),
    `cabeceras por documento: ${cspCounts.join(", ")}; sin meta http-equiv`,
  );

  const docNonces = documents.map((doc) => nonceOf(doc.headers["content-security-policy"]));
  const repeated = nonceOf(again.headers["content-security-policy"]);
  for (const nonce of [...docNonces, repeated]) if (nonce) nonces.add(nonce);
  const decoded = docNonces.map((nonce) => (nonce ? Buffer.from(nonce, "base64").length : 0));
  check(
    "4. Cada documento recibe un nonce distinto",
    docNonces.every(Boolean) &&
      repeated !== docNonces[1] &&
      new Set([...docNonces, repeated]).size === docNonces.length + 1 &&
      decoded.every((bytes) => bytes >= 16),
    `bytes decodificados: ${decoded.join(", ")}; la segunda petición a /facturas usa otro`,
  );
  const scriptsWithNonce = documents.map((doc, i) => {
    const tags = [...doc.body.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    return {
      total: tags.length,
      matching: tags.filter((tag) => tag.includes(`nonce="${docNonces[i]}"`)).length,
    };
  });
  check(
    "Un mismo nonce por respuesta en todos los scripts",
    scriptsWithNonce.every((s) => s.total > 0 && s.total === s.matching),
    scriptsWithNonce.map((s) => `${s.matching}/${s.total}`).join(", "),
  );

  const policy = directivesOf(policies[0] ?? "");
  const scriptSrc = policy.get("script-src") ?? [];
  check(
    "7. Sin unsafe-inline en script-src",
    !scriptSrc.includes("'unsafe-inline'"),
    scriptSrc.join(" "),
  );
  check(
    "8. Sin unsafe-eval en script-src en producción",
    !scriptSrc.includes("'unsafe-eval'") && scriptSrc.includes("'strict-dynamic'"),
    "con 'strict-dynamic'",
  );
  check("9. script-src-attr 'none'", policy.get("script-src-attr")?.join(" ") === "'none'");
  check(
    "10a. frame-ancestors 'none' declarado",
    policy.get("frame-ancestors")?.join(" ") === "'none'",
  );
  check("11. object-src 'none'", policy.get("object-src")?.join(" ") === "'none'");
  check(
    "form-action 'none' y base-uri 'self'",
    policy.get("form-action")?.join(" ") === "'none'" &&
      policy.get("base-uri")?.join(" ") === "'self'",
  );
  check(
    "Excepción de estilos acotada a los elementos <style>",
    [...policy].every(
      ([name, sources]) => name === "style-src-elem" || !sources.includes("'unsafe-inline'"),
    ) && policy.get("style-src-attr")?.join(" ") === "'none'",
    `style-src-elem ${policy.get("style-src-elem")?.join(" ") ?? ""}; style-src-attr ${policy.get("style-src-attr")?.join(" ") ?? ""}`,
  );
  check(
    "blob: solo en frame-src, sin comodines",
    [...policy].every(
      ([name, sources]) =>
        !sources.includes("*") &&
        !sources.includes("https:") &&
        !sources.includes("http:") &&
        (name === "frame-src" || !sources.includes("blob:")),
    ),
  );
  const first = documents[0]!.headers;
  check(
    "12. X-Content-Type-Options: nosniff",
    documents.every((d) => d.headers["x-content-type-options"] === "nosniff"),
  );
  check(
    "13. Referrer-Policy: same-origin",
    documents.every((d) => d.headers["referrer-policy"] === "same-origin"),
  );
  check(
    "14. Permissions-Policy niega cámara, micrófono, geolocalización y pago",
    ["camera=()", "microphone=()", "geolocation=()", "payment=()"].every((f) =>
      (first["permissions-policy"] ?? "").includes(f),
    ),
    first["permissions-policy"] ?? "",
  );
  check(
    "15a. Cross-Origin-Opener-Policy: same-origin",
    documents.every((d) => d.headers["cross-origin-opener-policy"] === "same-origin"),
  );
  check(
    "21. Nada de desarrollo en producción",
    policies.every((p) => !p.includes("'unsafe-eval'")),
    "ninguna política con 'unsafe-eval'",
  );
  check(
    "Sin Strict-Transport-Security",
    documents.every((d) => !d.headers["strict-transport-security"]),
    "HSTS pertenece al proxy TLS",
  );
  const caches = documents.map((d) => d.headers["cache-control"] ?? "");
  check(
    "22. HTML con nonce fuera de cachés compartidas",
    caches.every((c) => /private/.test(c) && /no-store/.test(c) && !/public|s-maxage/.test(c)),
    caches[0] ?? "",
  );
  const asset = /<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/.exec(documents[0]!.body)?.[1];
  const assetResponse = asset ? await rawGet(`${E2E_ORIGIN}${asset}`) : undefined;
  const assetCache = assetResponse?.headers["cache-control"] ?? "";
  check(
    "23. /_next/static sigue cacheable",
    assetResponse?.status === 200 &&
      /public/.test(assetCache) &&
      /immutable/.test(assetCache) &&
      /max-age=31536000/.test(assetCache),
    assetCache,
  );
  const manifest = JSON.parse(
    readFileSync(join(FRONTEND, ".next", "prerender-manifest.json"), "utf8"),
  ) as {
    routes: Record<string, unknown>;
  };
  // `/_global-error` es la página interna de Next.js para un fallo del layout raíz; no es una ruta
  // de la aplicación.
  const prerendered = Object.keys(manifest.routes).filter((route) => route !== "/_global-error");
  check(
    "Ninguna página prerenderada",
    prerendered.length === 0,
    prerendered.join(", ") || "solo /_global-error",
  );
}

/** Registra en cada documento y marco las violaciones de la política, con la fase en curso. */
async function watchViolations(
  context: BrowserContext,
  violations: Violation[],
  state: { phase: string },
  nonces: Set<string>,
): Promise<void> {
  await context.exposeBinding("__cspReport", (_source, v: Omit<Violation, "phase">) => {
    violations.push({ ...v, phase: state.phase });
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __cspReport: (v: unknown) => void }).__cspReport({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        disposition: event.disposition,
        sample: event.sample,
        source: `${event.sourceFile}:${event.lineNumber}`,
      });
    });
  });
  context.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    const nonce = nonceOf(response.headers()["content-security-policy"]);
    if (nonce) nonces.add(nonce);
  });
}

async function step<T>(
  name: string,
  state: { phase: string },
  run: () => Promise<T>,
  page?: Page,
): Promise<T | undefined> {
  state.phase = name;
  try {
    return await run();
  } catch (error) {
    // Diagnóstico sin datos sensibles: la ruta y el comienzo del texto visible de la página.
    const where = page
      ? ` [en ${new URL(page.url()).pathname}: ${(
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        )
          .replace(/\s+/g, " ")
          .slice(0, 160)}]`
      : "";
    check(
      name,
      false,
      `${error instanceof Error ? error.message.split("\n")[0] : String(error)}${where}`,
    );
    return undefined;
  }
}

async function signInThroughForm(page: Page): Promise<void> {
  await page.goto("/iniciar-sesion");
  await page.getByLabel("Correo").fill(ADMIN.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.getByRole("button", { name: /^Cuenta de / }).waitFor({ timeout: STEP_TIMEOUT_MS });
}

/** Flujos legítimos con la política y COOP activas (design D9, puntos 5, 15 a 19). */
async function checkBrowserFlows(
  context: BrowserContext,
  invoice: { id: string; number: string },
  violations: Violation[],
  state: { phase: string },
): Promise<void> {
  const page = await context.newPage();
  const at = (phase: string) => violations.filter((v) => v.phase === phase).length;

  await step(
    "5. Arranque e hidratación correctos",
    state,
    async () => {
      // La aplicación hidratada toma el envío del formulario; sin JavaScript, el envío nativo se
      // bloquea por form-action y la sesión no empieza.
      await signInThroughForm(page);
      check(
        "5. Arranque e hidratación correctos",
        at("5. Arranque e hidratación correctos") === 0,
        "la página hidrató y tomó el formulario",
      );
      check("17. El flujo de /api/auth funciona", true, "inicio de sesión y sesión activa");
    },
    page,
  );

  await step(
    "16. /api/v1 en el mismo origen funciona",
    state,
    async () => {
      await page.getByRole("link", { name: "Archivo de comprobantes" }).first().click();
      await page.waitForURL("**/comprobantes");
      await page.getByText(invoice.number).first().waitFor({ timeout: STEP_TIMEOUT_MS });
      check(
        "16. /api/v1 en el mismo origen funciona",
        true,
        "la bandeja lista la factura del backend de prueba",
      );
    },
    page,
  );

  await step(
    "18. La impresión del RIDE con blob: funciona",
    state,
    async () => {
      // Pestaña propia para la descarga y la impresión: el print() del Chrome sin interfaz puede
      // tumbar la pestaña en la navegación siguiente, y eso no es parte de la política.
      const page = await context.newPage();
      try {
        // Las descargas viven en la pestaña «RIDE y XML» del detalle (decisión del propietario,
        // 2026-10-16).
        await page.goto(`/facturas/${invoice.id}?seccion=documentos`);
        const downloadButton = page.getByRole("button", { name: "Descargar RIDE" });
        await downloadButton.waitFor({ timeout: STEP_TIMEOUT_MS });
        const download = page.waitForEvent("download", { timeout: STEP_TIMEOUT_MS });
        await downloadButton.click();
        const file = await download;
        check(
          "Descarga con blob:",
          file.suggestedFilename().endsWith(".pdf"),
          file.suggestedFilename(),
        );
        await page
          .getByText(/^Descargaste /)
          .first()
          .waitFor({ timeout: STEP_TIMEOUT_MS });
        check("Aviso visible", true, "el aviso de la descarga se mostró");
        await page.getByRole("button", { name: "Imprimir" }).click();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("iframe")].some((frame) => frame.src.startsWith("blob:")),
          undefined,
          { timeout: STEP_TIMEOUT_MS },
        );
        await until(
          () => page.frames().some((frame) => frame.url().startsWith("blob:")),
          "el iframe del RIDE carga su blob:",
        );
        await page
          .getByText("Abrimos el RIDE para imprimir.")
          .first()
          .waitFor({ timeout: STEP_TIMEOUT_MS });
        const blocked = violations.filter(
          (v) => v.phase === state.phase && v.directive === "frame-src",
        );
        check(
          "18. La impresión del RIDE con blob: funciona",
          blocked.length === 0,
          "el iframe con blob: cargó sin violaciones",
        );
      } finally {
        await page.close();
      }
    },
    page,
  );

  await step(
    "Diálogo y logo",
    state,
    async () => {
      // Configuración es un solo enlace al pie de la barra lateral, que lleva a su primera pestaña:
      // Usuarios para el administrador (decisión del propietario, 2026-10-16).
      const nav = page.getByRole("navigation", { name: "Navegación principal" });
      await nav.getByRole("link", { name: "Configuración" }).click();
      await page.waitForURL("**/configuracion/usuarios");
      await page.getByRole("button", { name: "Crear usuario" }).click();
      await page.getByRole("dialog").waitFor({ timeout: STEP_TIMEOUT_MS });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden", timeout: STEP_TIMEOUT_MS });
      // Sin cambio de tema: la interfaz siempre va en claro (decisión del propietario, 2026-10-22).
      await page.goto("/configuracion/empresa");
      const logo = page.getByAltText("Logo vigente de la empresa");
      await logo.waitFor({ timeout: STEP_TIMEOUT_MS });
      await page.waitForFunction(
        () =>
          (document.querySelector<HTMLImageElement>('img[alt="Logo vigente de la empresa"]')
            ?.naturalWidth ?? 0) > 0,
      );
      check("19. Los recursos necesarios cargan", true, "JavaScript, CSS, el diálogo y el logo");
    },
    page,
  );

  // Shell premium (adopt-premium-design-foundation-and-shell, design D7): la paleta de comandos, el
  // colapso de la barra lateral y la creación rápida, sin ninguna violación de la política. La
  // comprobación 20 cuenta cualquier violación de estos pasos.
  await step(
    "Paleta, barra lateral y creación rápida",
    state,
    async () => {
      await page.keyboard.press("Control+KeyK");
      const palette = page.getByRole("dialog", { name: "Paleta de comandos" });
      await palette.waitFor({ timeout: STEP_TIMEOUT_MS });
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden", timeout: STEP_TIMEOUT_MS });
      await page.getByRole("button", { name: "Contraer barra lateral" }).click();
      await page.getByRole("button", { name: "Expandir barra lateral" }).click();
      await page
        .getByRole("button", { name: "Contraer barra lateral" })
        .waitFor({ timeout: STEP_TIMEOUT_MS });
      // La creación rápida vive en la paleta de comandos (add-brand-logo).
      await page.keyboard.press("Control+KeyK");
      await palette.waitFor({ timeout: STEP_TIMEOUT_MS });
      await palette.getByRole("combobox").fill("nueva");
      await palette
        .getByRole("option", { name: "Nueva factura" })
        .waitFor({ timeout: STEP_TIMEOUT_MS });
      await page.keyboard.press("Escape");
      await palette.waitFor({ state: "hidden", timeout: STEP_TIMEOUT_MS });
      check(
        "27. El shell funciona con la política",
        true,
        "paleta de comandos, colapso de la barra lateral y creación rápida",
      );
    },
    page,
  );

  await step(
    "15. COOP no rompe la aplicación",
    state,
    async () => {
      await page.getByRole("button", { name: /^Cuenta de / }).click();
      await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
      await page.waitForURL("**/iniciar-sesion");
      check(
        "15. COOP no rompe la aplicación",
        true,
        "inicio de sesión, navegación, impresión y cierre de sesión con la cabecera",
      );
    },
    page,
  );
  await page.close();
}

/**
 * Páginas atacantes en el puerto 3001: una solicitud de impresión, un `POST` sin cuerpo que el
 * navegador envía sin preflight, y una navegación de nivel superior a la exportación de un reporte.
 */
async function attackerPages(documentId: string): Promise<() => Promise<void>> {
  const pages: Record<string, string> = {
    "/impresion": `fetch(${JSON.stringify(`${E2E_ORIGIN}/api/v1/documents/${documentId}/print-requests`)}, { method: "POST", mode: "no-cors", credentials: "include" });`,
    "/exportacion": `location.href = ${JSON.stringify(`${E2E_ORIGIN}/api/v1/reports/issued-documents/export`)};`,
  };
  const handler: RequestListener = (req, res) => {
    const script = pages[req.url ?? ""];
    res.writeHead(script ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(
      script ? `<!doctype html><title>Página atacante</title><script>${script}</script>` : "",
    );
  };
  const servers: Server[] = [];
  // `localhost` puede resolver a ::1 o a 127.0.0.1; sin IPv6 basta 127.0.0.1.
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createHttpServer(handler);
    const listening = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(ATTACKER_PORT, host, () => resolve(true));
    });
    if (listening) servers.push(server);
    else if (host === "127.0.0.1") throw new Error("las páginas atacantes no pudieron escuchar");
  }
  return async () => {
    await Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
    );
  };
}

/**
 * Origen de /api/v1 en el navegador (H-03, puntos 24 a 26): con la sesión del administrador abierta,
 * un sitio hermano y otro sitio no registran una impresión ni una exportación. Sin la guarda, la
 * cookie `Lax` viajaría desde el sitio hermano y la impresión quedaría registrada. Usa un contexto
 * propio: sus páginas no son de la aplicación y no cuentan para las violaciones de la política.
 */
async function checkCrossSiteRequests(
  browser: Browser,
  invoice: { id: string },
  backend: E2eBackend,
  db: MigratedSchema,
): Promise<void> {
  const close = await attackerPages(invoice.id);
  const context = await browser.newContext({ baseURL: E2E_ORIGIN, acceptDownloads: true });
  const state = { phase: "origen de /api/v1" };
  try {
    const { cookie } = await backend.signIn(ADMIN.email, ADMIN.password);
    const counts = async () => {
      const deliveries = await backend.fetchApi(
        "GET",
        `/documents/${invoice.id}/deliveries`,
        cookie,
      );
      if (!deliveries.ok) throw new Error(`GET deliveries: ${deliveries.status}`);
      const { data } = (await deliveries.json()) as { data: { items: { event: string }[] } };
      return {
        prints: data.items.filter((e) => e.event === "PRINT_REQUESTED").length,
        // El rastro de auditoría no tiene API de lectura: se cuenta en la base.
        exports: await db.database.prisma.auditEvent.count({
          where: { action: "report.exported" },
        }),
      };
    };
    await step("Sesión para el origen de /api/v1", state, async () => {
      await signInThroughForm(await context.newPage());
    });
    const before = await counts();

    // El `POST` va en modo no-cors: Chrome descarta la respuesta JSON opaca (ORB), y Playwright no ve
    // su estado ni sus cabeceras completas. El rechazo se confirma en el registro de seguridad del
    // backend, cuyo motivo dice qué `Sec-Fetch-Site` recibió la API.
    const rejections = (reason: string, route: string) =>
      backend
        .output()
        .split("\n")
        .filter(
          (line) =>
            line.includes('"event":"request_origin_rejected"') &&
            line.includes(`"reason":"${reason}"`) &&
            line.includes(`"route":"${route}"`),
        ).length;
    const headersOf = (request: Request) =>
      Promise.race([
        request.allHeaders(),
        new Promise<Record<string, string>>((resolve) =>
          setTimeout(() => resolve(request.headers()), 5_000),
        ),
      ]);
    for (const [name, origin, site] of [
      [
        "24. Un sitio hermano no imprime ni exporta con la sesión",
        `http://localhost:${ATTACKER_PORT}`,
        "same-site",
      ],
      [
        "25. Otro sitio no imprime ni exporta con la sesión",
        `http://127.0.0.1:${ATTACKER_PORT}`,
        "cross-site",
      ],
    ] as const) {
      await step(name, state, async () => {
        const reason = site === "same-site" ? "fetch_site_same_site" : "fetch_site_cross_site";
        const page = await context.newPage();
        try {
          const printsRejected = rejections(reason, "documents");
          const print = page.waitForRequest(
            (req) => req.url().endsWith(`/documents/${invoice.id}/print-requests`),
            { timeout: STEP_TIMEOUT_MS },
          );
          await page.goto(`${origin}/impresion`);
          await print;
          await until(
            () => rejections(reason, "documents") > printsRejected,
            `la API rechaza la impresión (${reason})`,
          );

          const exportsRejected = rejections(reason, "reports");
          const exported = page.waitForResponse(
            (res) => res.url().endsWith("/reports/issued-documents/export"),
            { timeout: STEP_TIMEOUT_MS },
          );
          await page.goto(`${origin}/exportacion`).catch(() => undefined);
          const exportResponse = await exported;
          const exportHeaders = await headersOf(exportResponse.request());
          const exportSite = exportHeaders["sec-fetch-site"];
          await until(
            () => rejections(reason, "reports") > exportsRejected,
            `la API rechaza la exportación (${reason})`,
          );
          check(
            name,
            exportResponse.status() === 403 && exportSite === site,
            `impresión rechazada en la API por ${reason}; exportación ${exportResponse.status()} (${exportSite}, cookie ${"cookie" in exportHeaders ? "enviada" : "no enviada"})`,
          );
        } finally {
          await page.close();
        }
      });
    }

    const after = await counts();
    check(
      "26. Ninguna impresión ni exportación registrada desde otro origen",
      after.prints === before.prints && after.exports === before.exports,
      `impresiones ${before.prints} → ${after.prints}; exportaciones ${before.exports} → ${after.exports}`,
    );
  } finally {
    await context.close();
    await close();
  }
}

/** Violaciones provocadas a propósito: deben bloquearse y quedar registradas (puntos 6, 9 y 10). */
async function checkProvokedViolations(
  context: BrowserContext,
  violations: Violation[],
  state: { phase: string },
): Promise<void> {
  const page = await context.newPage();
  await page.goto("/iniciar-sesion");
  await page.getByLabel("Correo").waitFor();
  const provoked = async (
    name: string,
    directive: string,
    run: (page: Page) => Promise<boolean>,
  ) => {
    state.phase = `provocada:${name}`;
    const notExecuted = await run(page);
    await until(
      () => violations.some((v) => v.phase === state.phase && v.directive === directive),
      `violación ${directive} registrada`,
    ).catch(() => undefined);
    const recorded = violations.some((v) => v.phase === state.phase && v.directive === directive);
    check(
      name,
      notExecuted && recorded,
      `bloqueado: ${notExecuted}; violación ${directive} registrada: ${recorded}`,
    );
  };

  await provoked("9b. Un manejador onclick en atributo no se ejecuta", "script-src-attr", (p) =>
    p.evaluate(() => {
      const button = document.createElement("button");
      button.setAttribute("onclick", "window.__clicked = true");
      document.body.append(button);
      button.click();
      return (window as unknown as { __clicked?: boolean }).__clicked === undefined;
    }),
  );
  await provoked("El envío nativo de un formulario se bloquea", "form-action", async (p) => {
    await p.evaluate(() => {
      const form = document.createElement("form");
      form.method = "get";
      form.action = "/iniciar-sesion";
      const input = document.createElement("input");
      input.name = "sonda";
      input.value = "x";
      form.append(input);
      document.body.append(form);
      HTMLFormElement.prototype.submit.call(form);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return !p.url().includes("sonda=");
  });
  await page.close();

  // Un script inyectado en el marcado del documento, como el de una inyección almacenada o reflejada:
  // el analizador lo inserta sin el nonce de la respuesta. Un script creado con `createElement` por
  // un script ya autorizado no sirve de prueba: `'strict-dynamic'` le extiende la confianza a
  // propósito.
  state.phase = "provocada:script inyectado";
  const injected = await context.newPage();
  await injected.route("**/iniciar-sesion", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "<head>",
      "<head><script>window.__injected = true</script>",
    );
    await route.fulfill({ response, body });
  });
  await injected.goto("/iniciar-sesion");
  await injected.getByLabel("Correo").waitFor();
  const notExecuted = await injected.evaluate(
    () => (window as unknown as { __injected?: boolean }).__injected === undefined,
  );
  await until(
    () => violations.some((v) => v.phase === state.phase && v.directive === "script-src-elem"),
    "violación script-src-elem registrada",
  ).catch(() => undefined);
  const recorded = violations.some(
    (v) => v.phase === state.phase && v.directive === "script-src-elem",
  );
  check(
    "6. Un script no autorizado no se ejecuta",
    notExecuted && recorded,
    `script en el marcado sin nonce bloqueado: ${notExecuted}; violación script-src-elem registrada: ${recorded}`,
  );
  await injected.close();

  state.phase = "provocada:enmarcado";
  const framing = await context.newPage();
  const messages: string[] = [];
  framing.on("console", (message) => messages.push(message.text()));
  await framing.setContent(`<iframe src="${E2E_ORIGIN}/iniciar-sesion"></iframe>`);
  await until(
    () =>
      messages.some((m) => m.includes("frame-ancestors")) ||
      framing.frames().some((f) => f.url().startsWith("chrome-error://")),
    "el navegador rechaza el enmarcado",
  ).catch(() => undefined);
  const child = framing.frames().find((f) => f !== framing.mainFrame());
  const shown = child
    ? await child
        .locator("form")
        .count()
        .catch(() => 0)
    : 0;
  check(
    "10. frame-ancestors impide el enmarcado",
    shown === 0,
    messages.some((m) => m.includes("frame-ancestors"))
      ? "Chrome rechazó el marco por frame-ancestors"
      : `formularios visibles en el marco: ${shown}`,
  );
  await framing.close();
}

/**
 * Medición de estilos (design D4): con la política de la aplicación activa, añade a cada documento
 * una política solo informativa por variante y recorre los flujos con estilos en tiempo de ejecución.
 */
async function measureStyleVariants(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  invoiceNumber: string,
): Promise<void> {
  for (const [variant, build] of Object.entries(STYLE_VARIANTS)) {
    const context = await browser.newContext({ baseURL: E2E_ORIGIN, acceptDownloads: true });
    const violations: Violation[] = [];
    const state = { phase: `medición ${variant}` };
    await watchViolations(context, violations, state, new Set());
    await context.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const response = await route.fetch();
      const headers = response.headers();
      const nonce = nonceOf(headers["content-security-policy"]) ?? "";
      await route.fulfill({
        response,
        headers: { ...headers, "content-security-policy-report-only": build(nonce) },
      });
    });
    const page = await context.newPage();
    await page.goto("/iniciar-sesion");
    await page.getByLabel("Correo").fill(ADMIN.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.getByRole("button", { name: /^Cuenta de / }).waitFor({ timeout: STEP_TIMEOUT_MS });
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Configuración" })
      .click();
    await page.getByRole("button", { name: "Crear usuario" }).click();
    await page.getByRole("dialog").waitFor({ timeout: STEP_TIMEOUT_MS });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Cuenta de / }).click();
    await page.keyboard.press("Escape");
    await page.goto("/comprobantes");
    await page.getByText(invoiceNumber).first().waitFor({ timeout: STEP_TIMEOUT_MS });
    await page
      .getByRole("button", { name: /^Descargar el RIDE de / })
      .first()
      .click();
    await page
      .getByText(/^Descargaste /)
      .first()
      .waitFor({ timeout: STEP_TIMEOUT_MS });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const reports = violations.filter((v) => v.disposition === "report");
    const byDirective = new Map<string, number>();
    for (const v of reports) byDirective.set(v.directive, (byDirective.get(v.directive) ?? 0) + 1);
    console.log(
      `  MEDICIÓN variante ${variant}: ${reports.length} violaciones informativas — ${
        [...byDirective].map(([d, n]) => `${d}: ${n}`).join(", ") || "ninguna"
      }${reports.length ? ` | muestras: ${[...new Set(reports.map((v) => v.sample.slice(0, 40)))].join(" · ")}` : ""}`,
    );
    await context.close();
  }
}

process.exitCode = await main();
