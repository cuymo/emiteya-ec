// Operaciones con el SRI sobre el transporte (add-sri-transmission, tarea 5.3, design D6, D10 y
// D15): cada una usa su servicio y su sobre oficial; con el breaker abierto no hay llamada. La
// consulta de validez se prueba contra un SRI simulado con el ejemplo oficial de la ficha.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import {
  isBreakerOpen,
  type SriExchangeRequest,
  type SriTransport,
} from "../../src/modules/sri-engine/application/transport.ts";
import { createCircuitBreaker } from "../../src/modules/sri-engine/infrastructure/circuit-breaker.ts";
import { resolveSriEndpoints } from "../../src/modules/sri-engine/infrastructure/endpoints.ts";
import { createSoapTransport } from "../../src/modules/sri-engine/infrastructure/soap-transport.ts";
import { createSriGateway } from "../../src/modules/sri-engine/infrastructure/sri-gateway.ts";

const KEY = "2111202405176001321000110010010000001241234567810";
const at = new Date(0);

function recording(kind: "RESPONSE" | "NOT_SENT" = "RESPONSE") {
  const calls: SriExchangeRequest[] = [];
  const transport: SriTransport = {
    exchange: (request) => {
      calls.push(request);
      return Promise.resolve({
        ...request,
        endpoint: `simulado:${request.service}`,
        outcome:
          kind === "RESPONSE"
            ? {
                kind,
                httpStatus: 200,
                headers: {},
                body: Buffer.from("<ok/>"),
                truncated: false,
                startedAt: at,
                headersAt: at,
                completedAt: at,
              }
            : { kind, errorCode: "ECONNREFUSED", startedAt: at, headersAt: null, completedAt: at },
      });
    },
  };
  return { transport, calls };
}

let server: Server | undefined;
afterAll(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
});

describe("operaciones con el SRI", () => {
  it("cada operación usa su servicio y su sobre", async () => {
    const { transport, calls } = recording();
    const gateway = createSriGateway({
      transport,
      breaker: createCircuitBreaker({ failures: 3, cooldownMs: 1_000 }),
    });
    await gateway.submit("TEST", Buffer.from("<factura/>"));
    await gateway.queryAuthorization("PRODUCTION", KEY);
    await gateway.queryValidity("TEST", KEY);
    expect(calls.map((call) => [call.environment, call.service])).toEqual([
      ["TEST", "RECEPTION"],
      ["PRODUCTION", "AUTHORIZATION"],
      ["TEST", "VALIDITY"],
    ]);
    expect(calls[0]!.envelope.toString()).toContain(
      `<xml>${Buffer.from("<factura/>").toString("base64")}</xml>`,
    );
    expect(calls[1]!.envelope.toString()).toContain(`<claveAccesoComprobante>${KEY}<`);
    expect(calls[2]!.envelope.toString()).toContain(`<claveAcceso>${KEY}</claveAcceso>`);
  });

  it("con el breaker abierto no llama y devuelve cuándo reintentar", async () => {
    const { transport, calls } = recording("NOT_SENT");
    const gateway = createSriGateway({
      transport,
      breaker: createCircuitBreaker({ failures: 2, cooldownMs: 60_000 }),
    });
    await gateway.submit("TEST", Buffer.from("x"));
    await gateway.submit("TEST", Buffer.from("x"));
    const blocked = await gateway.submit("TEST", Buffer.from("x"));
    expect(isBreakerOpen(blocked)).toBe(true);
    expect(calls).toHaveLength(2);
    // El circuito es por servicio: la autorización sigue llamando.
    expect(isBreakerOpen(await gateway.queryAuthorization("TEST", KEY))).toBe(false);
  });

  it("la consulta de validez habla con ConsultaComprobante según su contrato oficial", async () => {
    // Respuesta del ejemplo oficial de la ficha v2.34, §8.2.3 (comprobante autorizado).
    const official = Buffer.from(
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
        '<ns2:consultarEstadoAutorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.consultas">' +
        `<EstadoAutorizacionComprobante><claveAcceso>${KEY}</claveAcceso><mensajes/>` +
        "<estadoAutorizacion>AUTORIZADO</estadoAutorizacion><tipoComprobante>Nota de Débito</tipoComprobante>" +
        "<rucEmisor>1760013210001</rucEmisor><fechaAutorizacion>2024-12-12T10:49:37-05:00</fechaAutorizacion>" +
        "</EstadoAutorizacionComprobante></ns2:consultarEstadoAutorizacionComprobanteResponse></soap:Body></soap:Envelope>",
    );
    const received: string[] = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        received.push(`${req.url} ${body}`);
        res.writeHead(200, { "content-type": "text/xml;charset=UTF-8" });
        res.end(official);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const gateway = createSriGateway({
      transport: createSoapTransport({
        endpoints: resolveSriEndpoints({
          SRI_ENDPOINT_TEST_VALIDITY: `${base}/ConsultaComprobante`,
        }),
        requestTimeoutMs: 2_000,
        bodyTimeoutMs: 2_000,
        maxResponseBytes: 1024 * 1024,
      }),
      breaker: createCircuitBreaker({ failures: 3, cooldownMs: 1_000 }),
    });
    const exchange = await gateway.queryValidity("TEST", KEY);
    if (isBreakerOpen(exchange)) throw new Error("breaker abierto");
    expect(exchange.endpoint).toBe(`${base}/ConsultaComprobante`);
    expect(exchange.outcome).toMatchObject({ kind: "RESPONSE", httpStatus: 200 });
    expect((exchange.outcome as { body: Buffer }).body.equals(official)).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("/ConsultaComprobante ");
    expect(received[0]).toContain(
      `<ec:consultarEstadoAutorizacionComprobante><claveAcceso>${KEY}</claveAcceso>`,
    );
  });
});
