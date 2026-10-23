// Servidor SMTP falso en proceso para las pruebas del correo (ADR 0029; add-email-delivery). Guarda
// cada mensaje aceptado con su sobre. Para TLS, una autoridad y un certificado efímeros para
// «localhost», generados en la prueba con openssl: el repositorio no guarda claves.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMTPServer, type SMTPServerOptions } from "smtp-server";

export type ReceivedMail = { from: string; to: string[]; raw: string };

export type SmtpTestServer = {
  port: number;
  messages: ReceivedMail[];
  /** Usuarios con los que alguien intentó autenticarse (para comprobar que no viajó nada). */
  authAttempts: string[];
  close: () => Promise<void>;
};

export async function startSmtpServer(options: SMTPServerOptions = {}): Promise<SmtpTestServer> {
  const messages: ReceivedMail[] = [];
  const authAttempts: string[] = [];
  const server = new SMTPServer({
    logger: false,
    disableReverseLookup: true,
    authOptional: true,
    ...options,
    onAuth: (auth, session, callback) => {
      authAttempts.push(auth.username ?? "");
      if (options.onAuth) options.onAuth(auth, session, callback);
      else callback(null, { user: auth.username });
    },
    onData: (stream, session, callback) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        messages.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          raw: Buffer.concat(chunks).toString("utf8"),
        });
        callback();
      });
    },
  });
  // Los fallos del lado del servidor (un cliente que corta el TLS) son lo esperado en las pruebas.
  server.on("error", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;
  return {
    port,
    messages,
    authAttempts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Un error SMTP con su código, como lo espera smtp-server en sus ganchos. */
export function smtpError(message: string, responseCode: number): Error {
  return Object.assign(new Error(message), { responseCode });
}

/** Un puerto libre en el que nadie escucha: la conexión se rechaza. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Acepta la conexión TCP y nunca saluda: el cliente agota su espera. */
export async function silentServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Autoridad efímera y certificado de «localhost» firmado por ella, más uno autofirmado, con
 * `openssl` en un directorio temporal que se borra al terminar (como los P12 de prueba).
 */
export function testCertificates(): {
  ca: string;
  key: string;
  cert: string;
  selfSigned: string;
  selfSignedKey: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "facturador-smtp-tls-"));
  const run = (args: string[]) => {
    const result = spawnSync("openssl", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`openssl ${args[0]}: ${result.stderr}`);
  };
  try {
    writeFileSync(
      join(dir, "leaf.ext"),
      "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n",
    );
    run([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "1",
      "-subj",
      "/CN=Autoridad de prueba del correo",
    ]);
    run([
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "leaf.key",
      "-out",
      "leaf.csr",
      "-subj",
      "/CN=localhost",
    ]);
    run([
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "leaf.crt",
      "-days",
      "1",
      "-extfile",
      "leaf.ext",
    ]);
    run([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "self.key",
      "-out",
      "self.crt",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ]);
    const read = (name: string) => readFileSync(join(dir, name), "utf8");
    return {
      ca: read("ca.crt"),
      key: read("leaf.key"),
      cert: read("leaf.crt"),
      selfSigned: read("self.crt"),
      selfSignedKey: read("self.key"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
