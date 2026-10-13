// Fixtures de los ensayos de despliegue (harden-deployment-proxy-and-recovery, design D8 y D12):
// secretos sintéticos aleatorios y un certificado TLS efímero en un directorio temporal fuera del
// repositorio, la invocación de Compose del proyecto y un cliente HTTPS que solo confía en ese
// certificado. Nada de esto se imprime ni se versiona, y todo se borra al terminar.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { ROOT, must, run, type Result } from "./docker.ts";

export const COMPOSE_FILE = join(ROOT, "deploy", "compose.yaml");

export type Deployment = {
  project: string;
  /** Directorio temporal 0700 con los secretos y el archivo de entorno. */
  dir: string;
  envFile: string;
  publicOrigin: string;
  httpsPort: number;
  httpPort: number;
  /** El certificado TLS efímero, en PEM: la única raíz en la que confía el cliente. */
  tlsCertificate: string;
  admin: { email: string; password: string };
  /** Variables de Compose del proyecto, sin secretos (solo rutas y valores no secretos). */
  env: NodeJS.ProcessEnv;
};

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

/**
 * Certificado autofirmado efímero para `localhost`, `127.0.0.1` y `proxy`, generado con la CLI de
 * OpenSSL (como los P12 sintéticos de las pruebas) directamente en el directorio temporal.
 */
function selfSignedCertificate(dir: string): { cert: string } {
  must("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,DNS:proxy,IP:127.0.0.1",
    "-keyout",
    join(dir, "tls_private_key"),
    "-out",
    join(dir, "tls_certificate"),
  ]);
  chmodSync(join(dir, "tls_private_key"), 0o444);
  chmodSync(join(dir, "tls_certificate"), 0o444);
  return { cert: readFileSync(join(dir, "tls_certificate"), "utf8") };
}

/** Escribe un secreto legible por el contenedor dentro del directorio temporal 0700. */
function writeSecret(dir: string, name: string, value: string) {
  const path = join(dir, name);
  writeFileSync(path, value, { mode: 0o600 });
  // El usuario de la API (UID 1000) lo lee por el montaje; el directorio 0700 lo protege en el host.
  chmodSync(path, 0o444);
}

/** Crea los secretos sintéticos y la configuración de un proyecto de Compose aislado. */
export function createDeployment(options: {
  project: string;
  httpsPort: number;
  httpPort: number;
  extra?: NodeJS.ProcessEnv;
}): Deployment {
  const dir = mkdtempSync(join(tmpdir(), `${options.project}-`));
  chmodSync(dir, 0o700);
  const postgresPassword = hex(24);
  const tls = selfSignedCertificate(dir);
  writeSecret(dir, "postgres_password", postgresPassword);
  writeSecret(dir, "certificate_master_key", randomBytes(32).toString("base64"));
  const admin = { email: "administracion@despliegue.test", password: `humo-${hex(12)}` };
  const envFile = join(dir, "emiteya.env");
  writeFileSync(
    envFile,
    [
      `DATABASE_URL=postgresql://emiteya:${postgresPassword}@postgres:5432/emiteya`,
      `BETTER_AUTH_SECRET=${hex(32)}`,
      `INITIAL_USER_EMAIL=${admin.email}`,
      `INITIAL_USER_PASSWORD=${admin.password}`,
      "LOG_LEVEL=info",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const publicOrigin = `https://localhost:${options.httpsPort}`;
  return {
    project: options.project,
    dir,
    envFile,
    publicOrigin,
    httpsPort: options.httpsPort,
    httpPort: options.httpPort,
    tlsCertificate: tls.cert,
    admin,
    env: {
      ...process.env,
      EMITEYA_PROJECT: options.project,
      EMITEYA_ENV_FILE: envFile,
      EMITEYA_SECRETS_DIR: dir,
      PUBLIC_ORIGIN: publicOrigin,
      EDGE_HTTPS_PORT: String(options.httpsPort),
      EDGE_HTTP_PORT: String(options.httpPort),
      EMITEYA_IMAGE_TAG: process.env.EMITEYA_IMAGE_TAG ?? "deployment-check",
      ...options.extra,
    },
  };
}

/** La clave maestra sintética del despliegue, solo para copiarla a otro; nunca se imprime. */
export function syntheticMasterKey(deployment: Deployment): string {
  return readFileSync(join(deployment.dir, "certificate_master_key"), "utf8");
}

/** Sustituye la clave maestra sintética del despliegue (por la de otro, o por una aleatoria nueva). */
export function setSyntheticMasterKey(
  deployment: Deployment,
  value = randomBytes(32).toString("base64"),
) {
  chmodSync(join(deployment.dir, "certificate_master_key"), 0o600);
  writeSecret(deployment.dir, "certificate_master_key", value);
}

/** Ejecuta `docker compose` con los archivos dados (sin el de producción), para el proyecto. */
export function composeWith(
  deployment: Deployment,
  files: string[],
  args: string[],
  input?: string | Buffer,
): Result {
  const fileArgs = files.flatMap((file) => ["-f", file]);
  return run("docker", ["compose", ...fileArgs, "-p", deployment.project, ...args], {
    env: deployment.env,
    ...(input === undefined ? {} : { input }),
  });
}

/** Ejecuta `docker compose` sobre el archivo de producción y los extra, para el proyecto dado. */
export function compose(
  deployment: Deployment,
  args: string[],
  files: string[] = [],
  input?: string | Buffer,
): Result {
  return composeWith(deployment, [COMPOSE_FILE, ...files], args, input);
}

export function composeMust(deployment: Deployment, args: string[], files: string[] = []): Result {
  const result = compose(deployment, args, files);
  if (result.status !== 0) {
    throw new Error(
      `docker compose ${args.slice(0, 3).join(" ")}… terminó con ${result.status}: ${result.stderr.slice(-3000)}`,
    );
  }
  return result;
}

/** Baja el proyecto con sus volúmenes y borra el directorio temporal de los secretos. */
export function destroyDeployment(deployment: Deployment) {
  compose(deployment, ["down", "--volumes", "--remove-orphans", "--timeout", "30"]);
  rmSync(deployment.dir, { recursive: true, force: true });
}

export type HttpsResponse = {
  status: number;
  /** Cabeceras crudas, para detectar las repetidas. */
  rawHeaders: string[];
  header: (name: string) => string | undefined;
  headerValues: (name: string) => string[];
  body: Buffer;
};

/** Petición HTTPS al borde local que confía solo en el certificado efímero del despliegue. */
export function edgeRequest(
  deployment: Deployment,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: deployment.httpsPort,
        servername: "localhost",
        ca: deployment.tlsCertificate,
        path,
        method: options.method ?? "GET",
        headers: { host: `localhost:${deployment.httpsPort}`, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const values = (name: string) => {
            const found: string[] = [];
            for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
              if (res.rawHeaders[i]!.toLowerCase() === name) found.push(res.rawHeaders[i + 1]!);
            }
            return found;
          };
          resolve({
            status: res.statusCode ?? 0,
            rawHeaders: res.rawHeaders,
            header: (name) => values(name.toLowerCase())[0],
            headerValues: (name) => values(name.toLowerCase()),
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(240_000, () => req.destroy(new Error("sin respuesta del borde")));
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Un PNG sintético válido de `size`×`size` píxeles, con contenido aleatorio (un logo de prueba). */
export function syntheticPng(size = 32): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.concat(
    Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), randomBytes(size * 3)])),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Ejecuta `node -e` dentro de un servicio (para llamadas por la red privada). */
export function execNode(deployment: Deployment, service: string, script: string): Result {
  return compose(deployment, ["exec", "-T", service, "node", "-e", script]);
}

export { must };
