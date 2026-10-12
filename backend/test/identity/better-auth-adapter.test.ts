// Paridad del adaptador acotado de Better Auth con `toNodeHandler` (enforce-api-origin-and-body-limits,
// tarea 2.1, design D6): un manejador simulado recibe la petición web y devuelve la respuesta, sin
// base de datos.
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { boundedAuthHandler } from "../../src/modules/identity/infrastructure/better-auth/http.ts";
import { createLogger } from "../../src/platform/logging/logger.ts";
import { createMetrics } from "../../src/platform/metrics/metrics.ts";
import { listenRaw } from "../support/raw-http.ts";

const ORIGIN = "https://facturas.ejemplo.test";

type Received = Readonly<{
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer | null;
}>;

async function adapterServer(respond: () => Response = () => Response.json({ ok: true })) {
  const received: Received[] = [];
  const lines: string[] = [];
  const app = createApp({
    logger: createLogger("info", { write: (line: string) => void lines.push(line) }),
    metrics: createMetrics(),
    readiness: () => Promise.resolve(true),
    requestOrigin: { canonical: ORIGIN },
    mountBeforeBodyParser: (express) =>
      express.all(
        "/api/auth/{*any}",
        ...boundedAuthHandler(async (request) => {
          received.push({
            method: request.method,
            url: request.url,
            headers: Object.fromEntries(request.headers),
            body: request.body ? Buffer.from(await request.arrayBuffer()) : null,
          });
          return respond();
        }, ORIGIN),
      ),
  });
  const server = await listenRaw(app);
  return { ...server, received, logs: () => lines.join("") };
}

describe("adaptador acotado de Better Auth", () => {
  it("entrega el método, la ruta, la consulta, las cookies, las cabeceras y los bytes exactos", async () => {
    const server = await adapterServer();
    try {
      const body = Buffer.from('{"email":"operador@ejemplo.test","password":"ñandú 🔑"}', "utf8");
      const res = await server.send({
        path: "/api/auth/sign-in/email?redirect=%2Finicio&a=1",
        headers: {
          "content-type": "application/json; charset=utf-8",
          cookie: "sesion=valor; otra=2",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          accept: "application/json",
          "user-agent": "prueba-paridad",
          "x-app-client-ip": "203.0.113.7",
          "x-cabecera-propia": "se-conserva",
        },
        body,
      });
      expect(res.status).toBe(200);
      const [request] = server.received;
      expect(request).toMatchObject({
        method: "POST",
        url: `${ORIGIN}/api/auth/sign-in/email?redirect=%2Finicio&a=1`,
        headers: {
          "content-type": "application/json; charset=utf-8",
          cookie: "sesion=valor; otra=2",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
          accept: "application/json",
          "user-agent": "prueba-paridad",
          "x-app-client-ip": "203.0.113.7",
          "x-cabecera-propia": "se-conserva",
        },
      });
      expect(request!.body?.equals(body)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("arma la URL con el origen canónico aunque lleguen Host y X-Forwarded-* falsificados", async () => {
    const server = await adapterServer();
    try {
      await server.send({
        path: "/api/auth/sign-out",
        headers: {
          host: "atacante.ejemplo",
          "x-forwarded-host": "atacante.ejemplo",
          "x-forwarded-proto": "http",
          forwarded: "host=atacante.ejemplo;proto=http",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(server.received[0]!.url).toBe(`${ORIGIN}/api/auth/sign-out`);
    } finally {
      await server.close();
    }
  });

  it("sin cuerpo, Better Auth recibe la petición sin cuerpo", async () => {
    const server = await adapterServer();
    try {
      expect((await server.send({ path: "/api/auth/sign-out" })).status).toBe(200);
      expect(
        (await server.send({ path: "/api/auth/sign-out", headers: { "content-length": "0" } }))
          .status,
      ).toBe(200);
      expect(server.received.map((r) => r.body)).toEqual([null, null]);
    } finally {
      await server.close();
    }
  });

  it("descarta las cabeceras de salto a salto, las de encuadre y las nombradas en Connection", async () => {
    const server = await adapterServer();
    try {
      await server.send({
        path: "/api/auth/sign-out",
        headers: {
          "content-type": "application/json",
          connection: "keep-alive, x-salto-propio",
          "keep-alive": "timeout=5",
          "x-salto-propio": "no-debe-llegar",
          te: "trailers",
          trailer: "x-final",
          upgrade: "websocket",
          "proxy-authorization": "Basic no-debe-llegar",
          "proxy-authenticate": "Basic",
          "x-normal": "llega",
        },
        body: ['{"a":', "1}"],
      });
      const headers = server.received[0]!.headers;
      for (const name of [
        "connection",
        "keep-alive",
        "x-salto-propio",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
        "proxy-authorization",
        "proxy-authenticate",
        "content-length",
      ]) {
        expect(headers, name).not.toHaveProperty(name);
      }
      expect(headers["x-normal"]).toBe("llega");
      expect(server.received[0]!.body?.toString()).toBe('{"a":1}');
    } finally {
      await server.close();
    }
  });

  it("no reenvía el Content-Length del mensaje recibido: el cuerpo reconstruido define su tamaño", async () => {
    const server = await adapterServer();
    try {
      const json = '{"email":"operador@ejemplo.test"}';
      await server.send({
        path: "/api/auth/sign-in/email",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(json)),
        },
        body: json,
      });
      const [request] = server.received;
      expect(request!.headers).not.toHaveProperty("content-length");
      expect(request!.headers).not.toHaveProperty("transfer-encoding");
      expect(request!.body?.toString()).toBe(json);
    } finally {
      await server.close();
    }
  });

  it("un cuerpo comprimido llega descomprimido, sin el Content-Length ni el content-encoding del mensaje, y su tamaño real cuenta", async () => {
    const server = await adapterServer();
    try {
      const json = `{"email":"operador@ejemplo.test","relleno":"${"x".repeat(500)}"}`;
      const compressed = gzipSync(json);
      // El Content-Length recibido describe los bytes comprimidos, no el cuerpo que recibe Better Auth.
      expect(compressed.length).not.toBe(Buffer.byteLength(json));
      const res = await server.send({
        path: "/api/auth/sign-in/email",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": String(compressed.length),
        },
        body: compressed,
      });
      expect(res.status).toBe(200);
      const [request] = server.received;
      expect(request!.body?.toString()).toBe(json);
      for (const name of ["content-length", "content-encoding", "transfer-encoding"]) {
        expect(request!.headers, name).not.toHaveProperty(name);
      }

      const bomb = gzipSync(`{"relleno":"${"x".repeat(20_000)}"}`);
      expect(bomb.length).toBeLessThan(8192);
      const over = await server.send({
        path: "/api/auth/sign-in/email",
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: bomb,
      });
      expect(over.status).toBe(413);
      expect(server.received).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("devuelve el estado, el cuerpo, el tipo de contenido, cada Set-Cookie y las demás cabeceras", async () => {
    const server = await adapterServer(() => {
      const headers = new Headers({
        "content-type": "application/json; charset=utf-8",
        "x-propia-de-auth": "valor",
        "cache-control": "no-store",
      });
      headers.append("set-cookie", "uno=1; Path=/; HttpOnly; SameSite=Lax");
      headers.append("set-cookie", "dos=2; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT");
      return new Response('{"code":"PRUEBA","message":"cuerpo de Better Auth"}', {
        status: 401,
        headers,
      });
    });
    try {
      const res = await server.send({
        path: "/api/auth/sign-in/email",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ code: "PRUEBA", message: "cuerpo de Better Auth" });
      expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
      expect(res.headers["set-cookie"]).toEqual([
        "uno=1; Path=/; HttpOnly; SameSite=Lax",
        "dos=2; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT",
      ]);
      expect(res.headers["x-propia-de-auth"]).toBe("valor");
      expect(res.headers["cache-control"]).toBe("no-store");
    } finally {
      await server.close();
    }
  });

  it("una petición cortada antes de terminar el cuerpo no llega al manejador", async () => {
    const server = await adapterServer();
    try {
      await server.cut({
        path: "/api/auth/sign-in/email",
        headers: { "content-type": "application/json", "content-length": "200" },
        sent: '{"email":"cortado',
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(server.received).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("un error del manejador responde con el sobre genérico, sin datos del cuerpo", async () => {
    const marker = "contrasena-que-no-debe-aparecer";
    const server = await adapterServer(() => {
      throw new Error("fallo interno de prueba");
    });
    try {
      const res = await server.send({
        path: "/api/auth/sign-in/email",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: marker }),
      });
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body)).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
      expect(res.body).not.toContain(marker);
      expect(server.logs()).not.toContain(marker);
    } finally {
      await server.close();
    }
  });
});
