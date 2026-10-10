// Proceso hijo de `soap-transport-proxy.contract.test.ts`: el transporte real del producto con el
// proxy del entorno (`NODE_USE_ENV_PROXY`, `HTTPS_PROXY`), que Node solo lee al arrancar, como en la
// sesión de certificación. Imprime cada resultado sin contenido: clase, código, cabeceras y
// diagnóstico.
//
//   node --conditions=development proxy-transport-child.ts <url> <solicitudes> <bytes del sobre>
import { resolveSriEndpoints } from "../../src/modules/sri-engine/infrastructure/endpoints.ts";
import { createSoapTransport } from "../../src/modules/sri-engine/infrastructure/soap-transport.ts";

const [url = "", count = "1", size = "13812"] = process.argv.slice(2);
const transport = createSoapTransport({
  endpoints: resolveSriEndpoints({ SRI_ENDPOINT_TEST_RECEPTION: url }),
  requestTimeoutMs: 15_000,
  bodyTimeoutMs: 15_000,
  maxResponseBytes: 64 * 1024,
});
const envelope = Buffer.alloc(Number(size), 0x61);
for (let i = 0; i < Number(count); i++) {
  const { outcome } = await transport.exchange({
    environment: "TEST",
    service: "RECEPTION",
    envelope,
  });
  console.log(
    JSON.stringify({
      kind: outcome.kind,
      errorCode: outcome.kind === "RESPONSE" ? null : outcome.errorCode,
      httpStatus: outcome.kind === "RESPONSE" ? outcome.httpStatus : null,
      headers: outcome.headersAt !== null,
      ms: outcome.completedAt.getTime() - outcome.startedAt.getTime(),
      diagnostic: outcome.kind === "RESPONSE" ? null : (outcome.diagnostic ?? null),
    }),
  );
}
process.exit(0);
