// Sonda del espacio de nombres de red, para `session.ts verify` (docs/quality/sri-egress-allowlist.md).
// Corre dentro de `unshare --user --map-root-user --net` y comprueba, sin generar tráfico fuera de la
// máquina:
// - que la única interfaz es loopback;
// - que no hay ruta a la red: intenta 192.0.2.1:443, TEST-NET-1 de la RFC 5737, una dirección de
//   documentación que nunca se enruta y que no es del SRI;
// - que no hay resolución DNS: usa un nombre `.invalid`, nunca uno del SRI.
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { namespaceInterfaces } from "./inside.ts";

const directConnect = () =>
  new Promise<string>((resolve) => {
    const socket = connect({ host: "192.0.2.1", port: 443, timeout: 3_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve("CONNECTED");
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve("TIMEOUT");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "ERROR"));
  });

const dns = () =>
  lookup("probe.invalid").then(
    () => "RESOLVED",
    (error: NodeJS.ErrnoException) => error.code ?? "ERROR",
  );

console.log(
  JSON.stringify({
    interfaces: namespaceInterfaces(),
    directConnect: await directConnect(),
    dns: await dns(),
  }),
);
