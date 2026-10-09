// Ruta de la descarga del paquete de portabilidad en el mismo origen (add-data-portability, design
// D16): reenvía la cookie al backend con el identificador codificado, devuelve el estado, las
// cabeceras y el cuerpo por streaming, sin las cabeceras de un salto, y responde 405 a HEAD.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, HEAD } from "@/app/api/v1/data-exports/[id]/download/route";

describe("ruta de la descarga del paquete", () => {
  let server: Server;
  let seen: { url: string; headers: IncomingHttpHeaders }[] = [];
  const body = Buffer.alloc(3 * 2 ** 20 + 7, 0x5a);

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? "", headers: req.headers });
      if (req.url?.includes("caducada")) {
        res.writeHead(410, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "DATA_EXPORT_EXPIRED" } }));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-length": String(body.length),
        "content-disposition": 'attachment; filename="datos-20261008-120000.zip"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "keep-alive": "timeout=5",
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.API_INTERNAL_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    delete process.env.API_INTERNAL_URL;
    server.close();
  });

  const call = (id: string) =>
    GET(
      new Request(`http://localhost:3000/api/v1/data-exports/${id}/download`, {
        headers: { cookie: "sesion=abc", host: "localhost:3000", origin: "http://localhost:3000" },
      }),
      { params: Promise.resolve({ id }) },
    );

  it("reenvía la cookie y devuelve el paquete por streaming con sus cabeceras", async () => {
    seen = [];
    const res = await call("e1");
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      "content-type": "application/zip",
      "content-length": String(body.length),
      "content-disposition": 'attachment; filename="datos-20261008-120000.zip"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    expect(res.headers.has("keep-alive")).toBe(false);
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/v1/data-exports/e1/download");
    expect(seen[0]!.headers).toMatchObject({
      cookie: "sesion=abc",
      "x-forwarded-host": "localhost:3000",
    });
  });

  it("devuelve el error del backend tal cual y codifica el identificador", async () => {
    seen = [];
    const res = await call("caducada/../x");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: { code: "DATA_EXPORT_EXPIRED" } });
    expect(seen[0]!.url).toBe("/api/v1/data-exports/caducada%2F..%2Fx/download");
  });

  it("responde 405 a HEAD sin llamar al backend", () => {
    const res = HEAD();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});
