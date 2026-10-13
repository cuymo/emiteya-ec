// Ensayo de la topología de producción de referencia (harden-deployment-proxy-and-recovery, design
// D12; spec `production-deployment`). Levanta deploy/compose.yaml en un proyecto propio con puertos
// altos, secretos sintéticos y TLS efímero, comprueba el borde, la red y la persistencia, y lo borra
// todo al terminar. Solo datos sintéticos no fiscales: ninguna emisión, firma ni transmisión, y
// ningún destino fuera de las redes locales de la prueba.
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { Checks, NODE_IMAGE, ROOT, run, sleep, until } from "./docker.ts";
import {
  compose,
  composeMust,
  composeWith,
  createDeployment,
  destroyDeployment,
  edgeRequest,
  execNode,
  syntheticPng,
  SYNTHETIC_TAXPAYER,
  type Deployment,
} from "./fixtures.ts";

const HTTPS_PORT = Number(process.env.DEPLOYMENT_HTTPS_PORT ?? 18443);
const HTTP_PORT = Number(process.env.DEPLOYMENT_HTTP_PORT ?? 18080);
const FIXTURES = join(ROOT, "scripts", "deployment", "fixtures");
const API_LARGEST_DRAFT = 4_000_000;
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Id del contenedor de un servicio del proyecto. */
function containerOf(d: Deployment, service: string): string {
  return composeMust(d, ["ps", "-q", service]).stdout.trim();
}

/** IP de un contenedor en una red del proyecto. */
function ipOn(container: string, network: string): string {
  const out = run("docker", ["inspect", "-f", "{{json .NetworkSettings.Networks}}", container]);
  const networks = JSON.parse(out.stdout || "{}") as Record<string, { IPAddress?: string }>;
  return networks[network]?.IPAddress ?? "";
}

/** Espera la preparación de la API por la red privada. */
async function waitReady(d: Deployment, ms = 180_000): Promise<boolean> {
  return until(
    () =>
      execNode(
        d,
        "backend",
        "fetch('http://127.0.0.1:4000/health/ready').then((r) => process.exit(r.status === 200 ? 0 : 1), () => process.exit(1))",
      ).status === 0,
    ms,
    1_000,
  );
}

async function upAndReady(d: Deployment): Promise<boolean> {
  const up = compose(d, ["up", "-d", "--no-build"]);
  if (up.status !== 0) {
    console.error(up.stderr.slice(-3000));
    return false;
  }
  if (!(await waitReady(d))) return false;
  // El borde también tiene que responder antes de seguir.
  return until(async () => (await edgeRequest(d, "/iniciar-sesion")).status === 200, 60_000);
}

/** Código del sobre de error de la API, sin más datos de la respuesta. */
function errorCode(body: Buffer): string {
  try {
    return (JSON.parse(body.toString("utf8")) as { error?: { code?: string } }).error?.code ?? "";
  } catch {
    return "";
  }
}

type Session = { cookie: string; setCookies: string[]; status: number };

async function signIn(d: Deployment, email: string, password: string): Promise<Session> {
  const res = await edgeRequest(d, "/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: d.publicOrigin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = res.headerValues("set-cookie");
  return {
    status: res.status,
    setCookies,
    cookie: setCookies.map((value) => value.split(";")[0]).join("; "),
  };
}

function isApiEnvelope(body: Buffer): boolean {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { error?: { code?: string } };
    return typeof parsed.error?.code === "string";
  } catch {
    return false;
  }
}

function hstsExact(values: string[]): boolean {
  return values.length === 1 && values[0] === "max-age=31536000";
}

async function edgeChecks(d: Deployment, checks: Checks) {
  const psOut = composeMust(d, ["ps", "--format", "json"]).stdout.trim();
  const ps = JSON.parse(psOut.startsWith("[") ? psOut : `[${psOut.split("\n").join(",")}]`) as {
    Service: string;
    Publishers?: { PublishedPort: number; TargetPort: number }[];
  }[];
  const published = ps.flatMap((c) =>
    (c.Publishers ?? [])
      .filter((p) => p.PublishedPort > 0)
      .map((p) => `${c.Service}:${p.TargetPort}`),
  );
  checks.record(
    "solo el borde publica puertos (443 y 80)",
    [...new Set(published)].sort().join(",") === "proxy:443,proxy:80",
    [...new Set(published)].join(", "),
  );

  // Un cliente externo (otra red de Docker) no alcanza la API ni PostgreSQL por su IP interna.
  const network = `${d.project}_app`;
  const targets = ["backend:4000", "frontend:3000", "postgres:5432"].map((target) => {
    const [service, port] = target.split(":") as [string, string];
    return { service, port, ip: ipOn(containerOf(d, service), network) };
  });
  const reached = targets.filter((target) => {
    const probe = run("docker", [
      "run",
      "--rm",
      "--network",
      "bridge",
      NODE_IMAGE,
      "node",
      "-e",
      `const s = require('node:net').connect(${target.port}, '${target.ip}'); s.setTimeout(3000); s.on('connect', () => process.exit(0)); s.on('timeout', () => process.exit(1)); s.on('error', () => process.exit(1));`,
    ]);
    return probe.status === 0;
  });
  checks.record(
    "un cliente externo no alcanza la interfaz, la API ni PostgreSQL",
    reached.length === 0 && targets.every((target) => target.ip !== ""),
    reached.map((target) => target.service).join(", "),
  );

  const redirect = run("curl", [
    "-s",
    "-o",
    "/dev/null",
    "-D",
    "-",
    `http://127.0.0.1:${d.httpPort}/api/v1/me?x=1`,
  ]).stdout;
  checks.record(
    "HTTP redirige con 301 al mismo recurso en el origen HTTPS canónico, sin HSTS",
    /^HTTP\/1\.1 301/m.test(redirect) &&
      new RegExp(`^location: ${d.publicOrigin}/api/v1/me\\?x=1\\r?$`, "im").test(redirect) &&
      !/strict-transport-security/i.test(redirect),
  );

  const page = await edgeRequest(d, "/iniciar-sesion");
  const api = await edgeRequest(d, "/api/v1/me");
  const auth = await edgeRequest(d, "/api/auth/get-session");
  const tooLarge = await edgeRequest(d, "/api/v1/me", {
    method: "POST",
    headers: { "content-type": "application/json", origin: d.publicOrigin },
    body: Buffer.alloc(8 * 1024 * 1024 + 1024, 0x20),
  });
  const health = await edgeRequest(d, "/health/live");
  checks.record(
    "una sola HSTS exacta en una página, en /api, en un 413 y en un rechazo de salud",
    [page, api, tooLarge, health].every((res) =>
      hstsExact(res.headerValues("strict-transport-security")),
    ),
    [page, api, tooLarge, health].map((res) => res.status).join("/"),
  );
  checks.record(
    "la interfaz atiende las páginas con su CSP",
    page.status === 200 && Boolean(page.header("content-security-policy")),
  );
  checks.record(
    "la API atiende /api/v1 y /api/auth directamente, con su sobre de error",
    api.status === 401 &&
      isApiEnvelope(api.body) &&
      auth.status === 404 &&
      isApiEnvelope(auth.body),
    `${api.status}/${auth.status}`,
  );

  const publicPaths = ["/health/live", "/health/ready", "/metrics"];
  const exposed: string[] = [];
  for (const path of publicPaths) {
    const res = await edgeRequest(d, path);
    if (res.status !== 404 || res.body.toString().includes("process_cpu")) exposed.push(path);
  }
  checks.record("la salud y las métricas no se publican", exposed.length === 0, exposed.join(", "));
  const internal = execNode(
    d,
    "backend",
    "Promise.all(['/health/live', '/health/ready', '/metrics'].map((p) => fetch('http://127.0.0.1:4000' + p).then((r) => r.status))).then((s) => process.exit(s.every((c) => c === 200) ? 0 : 1), () => process.exit(1))",
  );
  checks.record("por la red privada, la salud y las métricas responden", internal.status === 0);
}

async function loginChecks(d: Deployment, checks: Checks): Promise<Session> {
  const session = await signIn(d, d.admin.email, d.admin.password);
  const secure =
    session.setCookies.length > 0 &&
    session.setCookies.every((value) => /;\s*Secure/i.test(value) && /;\s*HttpOnly/i.test(value));
  const me = await edgeRequest(d, "/api/v1/me", { headers: { cookie: session.cookie } });
  checks.record(
    "el inicio de sesión del administrador sintético da cookies Secure y HttpOnly",
    session.status === 200 && secure && me.status === 200,
    `${session.status}, ${session.setCookies.length} cookies, /me ${me.status}`,
  );
  return session;
}

/** IP que la API registró para el inicio de sesión fallido con ese requestId. */
function loggedIp(d: Deployment, requestId: string): string | undefined {
  const logs = compose(d, ["logs", "--no-log-prefix", "backend"]).stdout.split("\n");
  for (const line of logs) {
    if (!line.includes(requestId)) continue;
    try {
      const entry = JSON.parse(line) as { event?: string; requestId?: string; ip?: string };
      if (entry.event === "sign_in_failed" && entry.requestId === requestId) return entry.ip;
    } catch {
      // Línea que no es JSON.
    }
  }
  return undefined;
}

const plainIp = (ip: string | undefined) => (ip ?? "").replace(/^::ffff:/, "");

async function clientIpChecks(d: Deployment, checks: Checks) {
  const edge = `${d.project}_edge`;
  const client = `${d.project}-cliente`;
  run("docker", ["rm", "-f", client]);
  run("docker", [
    "run",
    "-d",
    "--name",
    client,
    "--network",
    edge,
    "-v",
    `${join(d.dir, "tls_certificate")}:/ca.pem:ro`,
    NODE_IMAGE,
    "sleep",
    "600",
  ]);
  try {
    const clientIp = ipOn(client, edge);
    const attempt = (requestId: string, spoof?: string) =>
      run("docker", [
        "exec",
        client,
        "node",
        "-e",
        `const req = require('node:https').request({ host: 'proxy', port: 443, servername: 'proxy', ca: require('node:fs').readFileSync('/ca.pem'), method: 'POST', path: '/api/auth/sign-in/email', headers: Object.assign({ origin: '${d.publicOrigin}', 'content-type': 'application/json', 'x-request-id': '${requestId}' }, ${spoof ? `{ 'x-forwarded-for': '${spoof}' }` : "{}"}) }, (res) => { res.resume(); res.on('end', () => process.exit(res.statusCode === 401 ? 0 : 1)); }); req.on('error', () => process.exit(2)); req.end(JSON.stringify({ email: 'nadie-${requestId}@despliegue.test', password: 'contrasena-incorrecta-1' }));`,
      ]).status;
    const plainId = `ip-cliente-${randomBytes(4).toString("hex")}`;
    const spoofId = `ip-falsa-${randomBytes(4).toString("hex")}`;
    const statuses = [attempt(plainId), attempt(spoofId, "203.0.113.77, 198.51.100.9")];
    await sleep(1_000);
    const plain = plainIp(loggedIp(d, plainId));
    const spoofed = plainIp(loggedIp(d, spoofId));
    checks.record(
      "la API atribuye la petición a la IP que observó el borde",
      statuses[0] === 0 && clientIp !== "" && plain === clientIp,
      `cliente ${clientIp}, registrada ${plain || "ninguna"}`,
    );
    checks.record(
      "un X-Forwarded-For falsificado por el cliente se ignora",
      statuses[1] === 0 && spoofed === clientIp,
      `registrada ${spoofed || "ninguna"}`,
    );

    // Otro servicio interno, directo a la API con la cabecera: no es un proxy de confianza.
    const directId = `ip-interna-${randomBytes(4).toString("hex")}`;
    const frontendIp = ipOn(containerOf(d, "frontend"), `${d.project}_app`);
    const direct = execNode(
      d,
      "frontend",
      `fetch('http://backend:4000/api/auth/sign-in/email', { method: 'POST', headers: { origin: '${d.publicOrigin}', 'content-type': 'application/json', 'x-request-id': '${directId}', 'x-forwarded-for': '203.0.113.88' }, body: JSON.stringify({ email: 'nadie-${directId}@despliegue.test', password: 'contrasena-incorrecta-1' }) }).then((r) => process.exit(r.status === 401 ? 0 : 1), () => process.exit(2))`,
    );
    await sleep(1_000);
    const internal = plainIp(loggedIp(d, directId));
    checks.record(
      "otro servicio interno se atribuye a su propia IP, sin confiar en su cabecera",
      direct.status === 0 && internal === frontendIp,
      `interfaz ${frontendIp}, registrada ${internal || "ninguna"}`,
    );
  } finally {
    run("docker", ["rm", "-f", client]);
  }
}

async function bodyChecks(d: Deployment, checks: Checks) {
  const draft = await edgeRequest(d, "/api/v1/purchase-settlements/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", origin: d.publicOrigin },
    body: `{"relleno":"${"x".repeat(API_LARGEST_DRAFT)}"}`,
  });
  checks.record(
    "un cuerpo de 4 MB llega a la API, que responde con su sobre",
    draft.status !== 413 && isApiEnvelope(draft.body),
    `${draft.status}`,
  );
  const api = await edgeRequest(d, "/api/v1/purchase-settlements/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", origin: d.publicOrigin },
    body: Buffer.alloc(8 * 1024 * 1024 + 1, 0x20),
  });
  checks.record(
    "más de 8 MiB en /api/ recibe 413 del borde",
    api.status === 413 && !isApiEnvelope(api.body),
  );
  const web = await edgeRequest(d, "/iniciar-sesion", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: Buffer.alloc(1024 * 1024 + 1, 0x20),
  });
  checks.record("más de 1 MiB fuera de /api/ recibe 413 del borde", web.status === 413);
}

function egressChecks(d: Deployment, checks: Checks) {
  const internal = run("docker", ["network", "inspect", "-f", "{{.Internal}}", `${d.project}_app`]);
  checks.record("la red de la aplicación es interna", internal.stdout.trim() === "true");
  const edge = `${d.project}_edge`;
  const trap = `${d.project}-trampa`;
  run("docker", ["rm", "-f", trap]);
  run("docker", [
    "run",
    "-d",
    "--name",
    trap,
    "--network",
    edge,
    NODE_IMAGE,
    "node",
    "-e",
    "let hits = 0; require('node:http').createServer((req, res) => { hits++; console.log('conexion'); res.end('x'); }).listen(8080);",
  ]);
  try {
    const trapIp = ipOn(trap, edge);
    const attempt = (service: string) =>
      execNode(
        d,
        service,
        `fetch('http://${trapIp}:8080/', { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))`,
      ).status;
    const results = ["backend", "frontend"].map((service) => [service, attempt(service)] as const);
    const hits = run("docker", ["logs", trap])
      .stdout.split("\n")
      .filter((line) => line === "conexion").length;
    checks.record(
      "la API y la interfaz no tienen salida: la trampa no recibe conexiones",
      trapIp !== "" && results.every(([, status]) => status !== 0) && hits === 0,
      `${hits} conexiones`,
    );
  } finally {
    run("docker", ["rm", "-f", trap]);
  }
}

function privilegeChecks(d: Deployment, checks: Checks) {
  for (const service of ["backend", "frontend"]) {
    const status = compose(d, ["exec", "-T", service, "cat", "/proc/1/status"]).stdout;
    const uid = /^Uid:\s+(\d+)/m.exec(status)?.[1];
    const capEff = /^CapEff:\s+([0-9a-f]+)/m.exec(status)?.[1];
    checks.record(
      `${service} corre sin root y sin capacidades`,
      uid !== undefined && uid !== "0" && capEff === "0000000000000000",
      `UID ${uid}, CapEff ${capEff}`,
    );
    const readOnly = run("docker", [
      "inspect",
      "-f",
      "{{.HostConfig.ReadonlyRootfs}}",
      containerOf(d, service),
    ]);
    checks.record(
      `${service} corre con la raíz de solo lectura`,
      readOnly.stdout.trim() === "true",
    );
  }
  const proxyStatus = compose(d, ["exec", "-T", "proxy", "cat", "/proc/1/status"]).stdout;
  checks.record(
    "nginx conserva su modelo oficial con el mínimo de capacidades medido",
    /^CapEff:\s+([0-9a-f]+)/m.exec(proxyStatus)?.[1] === "00000000000004c1",
    `CapEff ${/^CapEff:\s+([0-9a-f]+)/m.exec(proxyStatus)?.[1]}`,
  );
}

function renderedConfigChecks(d: Deployment, checks: Checks) {
  const config = compose(d, ["exec", "-T", "proxy", "nginx", "-T"]).stdout;
  const download =
    /location ~ \^\/api\/v1\/data-exports\/\[\^\/\]\+\/download\$ \{([^}]*)\}/.exec(config)?.[1] ??
    "";
  const server = config.slice(config.indexOf("listen 443"));
  checks.record(
    "la descarga de portabilidad espera 180 s, sin almacenar la respuesta",
    /proxy_read_timeout 180s;/.test(download) &&
      /proxy_buffering off;/.test(download) &&
      /proxy_max_temp_file_size 0;/.test(download),
  );
  checks.record(
    "el resto de rutas espera 60 s",
    /\n {2}proxy_read_timeout 60s;/.test(server) &&
      (config.match(/proxy_read_timeout 180s;/g) ?? []).length === 1,
  );
}

async function edgeTimeoutBehavior(checks: Checks) {
  const d = createDeployment({
    project: "emiteya-espera-borde",
    httpsPort: HTTPS_PORT + 1,
    httpPort: HTTP_PORT + 1,
    extra: {
      FIRST_BYTE_DELAY_MS: "4000",
      NGINX_PROXY_READ_TIMEOUT: "2s",
      NGINX_DOWNLOAD_READ_TIMEOUT: "8s",
    },
  });
  const file = join(FIXTURES, "edge-timeout.compose.yaml");
  try {
    const up = composeWith(d, [file], ["up", "-d", "--wait"]);
    if (up.status !== 0) throw new Error(up.stderr.slice(-2000));
    await until(async () => (await edgeRequest(d, "/api/v1/x")).status > 0, 30_000);
    const download = await edgeRequest(d, "/api/v1/data-exports/paquete-de-prueba/download");
    const other = await edgeRequest(d, "/api/v1/otra-ruta");
    checks.record(
      "con esperas escaladas, la descarga tardía se entrega completa y otra ruta recibe 504",
      download.status === 200 &&
        download.body.toString() === "respuesta-tardia" &&
        other.status === 504,
      `${download.status}/${other.status}`,
    );
  } finally {
    composeWith(d, [file], ["down", "--volumes", "--remove-orphans"]);
    destroyDeployment(d);
  }
}

function migrationFailure(checks: Checks) {
  const d = createDeployment({
    project: "emiteya-migracion-fallida",
    subnet: 246,
    httpsPort: HTTPS_PORT + 2,
    httpPort: HTTP_PORT + 2,
  });
  const override = join(FIXTURES, "migrate-failure.compose.yaml");
  try {
    const up = compose(d, ["up", "-d", "--no-build", "backend"], [override]);
    const backend = compose(
      d,
      ["ps", "-a", "--format", "{{.State}}", "backend"],
      [override],
    ).stdout.trim();
    const migrate = compose(
      d,
      ["ps", "-a", "--format", "{{.State}} {{.ExitCode}}", "migrate"],
      [override],
    ).stdout.trim();
    checks.record(
      "con una migración fallida, el despliegue falla y el backend no arranca",
      up.status !== 0 &&
        backend !== "running" &&
        migrate.startsWith("exited") &&
        !migrate.endsWith(" 0"),
      `up ${up.status}, migrate ${migrate}, backend ${backend || "sin contenedor"}`,
    );
  } finally {
    compose(d, ["down", "--volumes", "--remove-orphans"], [override]);
    destroyDeployment(d);
  }
}

async function persistenceChecks(d: Deployment, checks: Checks) {
  let session = await signIn(d, d.admin.email, d.admin.password);
  const mutate = (path: string, method: string, body: Buffer | string, type = "application/json") =>
    edgeRequest(d, path, {
      method,
      headers: { cookie: session.cookie, origin: d.publicOrigin, "content-type": type },
      body,
    });
  const operatorEmail = "operacion@despliegue.test";
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
  // Configuración sintética de la empresa: el logo exige la versión de una configuración registrada.
  const taxpayer = await mutate("/api/v1/taxpayer", "PUT", JSON.stringify(SYNTHETIC_TAXPAYER));
  const version = (JSON.parse(taxpayer.body.toString() || "{}") as { data?: { version?: number } })
    .data?.version;
  const logo = syntheticPng();
  const upload = await mutate(
    `/api/v1/taxpayer/logo?expectedVersion=${version ?? 0}`,
    "PUT",
    logo,
    "image/png",
  );
  const report = await edgeRequest(d, "/api/v1/reports/parties/export", {
    headers: { cookie: session.cookie },
  });
  checks.record(
    "la exportación de un reporte escribe sus temporales con la raíz de solo lectura",
    report.status === 200 && report.body.subarray(0, 2).toString() === "PK",
    `${report.status}`,
  );
  const requested = await mutate("/api/v1/data-exports", "POST", "{}");
  const exportId =
    (JSON.parse(requested.body.toString() || "{}") as { data?: { id?: string } }).data?.id ?? "";
  const ready = await until(
    async () => {
      const res = await edgeRequest(d, `/api/v1/data-exports/${exportId}`, {
        headers: { cookie: session.cookie },
      });
      return (
        (JSON.parse(res.body.toString() || "{}") as { data?: { status?: string } }).data?.status ===
        "READY"
      );
    },
    180_000,
    2_000,
  );
  const before = await edgeRequest(d, `/api/v1/data-exports/${exportId}/download`, {
    headers: { cookie: session.cookie },
  });
  checks.record(
    "datos sintéticos sembrados: operador, logo y exportación lista",
    operator.status === 201 && [200, 201].includes(upload.status) && ready && before.status === 200,
    `operador ${operator.status}, logo ${upload.status} ${errorCode(upload.body)}, exportación ${ready ? "READY" : "no lista"}, descarga ${before.status}`,
  );

  composeMust(d, ["down", "--timeout", "30"]);
  const back = await upAndReady(d);
  session = await signIn(d, d.admin.email, d.admin.password);
  const users = await edgeRequest(d, "/api/v1/users", { headers: { cookie: session.cookie } });
  const storedLogo = await edgeRequest(d, "/api/v1/taxpayer/logo", {
    headers: { cookie: session.cookie },
  });
  const after = await edgeRequest(d, `/api/v1/data-exports/${exportId}/download`, {
    headers: { cookie: session.cookie },
  });
  checks.record(
    "tras recrear los contenedores sin borrar volúmenes, los datos siguen",
    back &&
      users.body.toString().includes(operatorEmail) &&
      sha256(storedLogo.body) === sha256(logo),
  );
  checks.record(
    "el paquete listo sigue descargable con el mismo SHA-256",
    after.status === 200 && sha256(after.body) === sha256(before.body),
    `${after.status}`,
  );
}

function shutdownCheck(d: Deployment, checks: Checks) {
  const container = containerOf(d, "backend");
  const started = Date.now();
  compose(d, ["stop", "--timeout", "30", "backend"]);
  const elapsed = Date.now() - started;
  const exitCode = run("docker", ["inspect", "-f", "{{.State.ExitCode}}", container]).stdout.trim();
  const logs = run("docker", ["logs", container]).stdout;
  checks.record(
    "el backend se detiene con código 0, cierra sus recursos y no agota el plazo de gracia",
    exitCode === "0" &&
      logs.includes('"msg":"apagando"') &&
      logs.includes('"msg":"recurso cerrado"') &&
      elapsed < 30_000,
    `código ${exitCode}, ${elapsed} ms`,
  );
}

export async function main(): Promise<number> {
  const checks = new Checks();
  const d = createDeployment({
    project: "emiteya-topologia",
    httpsPort: HTTPS_PORT,
    httpPort: HTTP_PORT,
  });
  try {
    if (!process.env.DEPLOYMENT_SKIP_BUILD) composeMust(d, ["build"]);
    migrationFailure(checks);
    checks.record("la topología arranca en orden y la API queda lista", await upAndReady(d));
    await edgeChecks(d, checks);
    await loginChecks(d, checks);
    await clientIpChecks(d, checks);
    await bodyChecks(d, checks);
    egressChecks(d, checks);
    privilegeChecks(d, checks);
    renderedConfigChecks(d, checks);
    await persistenceChecks(d, checks);
    shutdownCheck(d, checks);
    await edgeTimeoutBehavior(checks);
    const rendered = JSON.parse(composeMust(d, ["config", "--format", "json"]).stdout) as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    checks.record(
      "SRI_TRANSMISSION_ENABLED=0 en toda la ejecución",
      rendered.services.backend?.environment?.SRI_TRANSMISSION_ENABLED === "0",
    );
  } catch (error) {
    checks.record("el ensayo terminó sin errores inesperados", false, String(error).slice(0, 500));
  } finally {
    destroyDeployment(d);
  }
  return checks.summary("deployment:topology");
}

if (import.meta.main) process.exitCode = await main();
