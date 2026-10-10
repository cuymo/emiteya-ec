// Puentes entre el espacio de nombres de red de la certificación y el anfitrión
// (docs/quality/sri-egress-allowlist.md). Los sockets Unix con ruta cruzan los espacios de nombres de
// red, que no comparten interfaces: así el proceso aislado alcanza solo el proxy de salida, la base
// de datos y su propia API, sin ninguna ruta a la red.
import { chmodSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";

/** Conexiones abiertas de cada servidor, para cerrarlas sin esperar a que el cliente las suelte. */
const open = new WeakMap<Server, Set<Socket>>();

function track(server: Server): Server {
  const sockets = new Set<Socket>();
  open.set(server, sockets);
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return server;
}

function pipeBoth(client: Socket, upstream: Socket) {
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
}

const listening = (server: Server, listen: (done: () => void) => void) =>
  new Promise<Server>((resolve, reject) => {
    server.once("error", reject);
    listen(() => {
      server.off("error", reject);
      resolve(server);
    });
  });

/** Escucha en 127.0.0.1:`port` y lleva cada conexión al socket Unix `unixPath`. */
export function relayTcpToUnix(port: number, unixPath: string): Promise<Server> {
  const server = track(createServer((client) => pipeBoth(client, connect(unixPath))));
  return listening(server, (done) => server.listen(port, "127.0.0.1", done));
}

/** Escucha en el socket Unix `unixPath`, solo para su dueño, y lleva cada conexión a `host:port`. */
export function relayUnixToTcp(unixPath: string, host: string, port: number): Promise<Server> {
  const server = track(createServer((client) => pipeBoth(client, connect({ host, port }))));
  return listening(server, (done) =>
    server.listen(unixPath, () => {
      chmodSync(unixPath, 0o600);
      done();
    }),
  );
}

/** Escucha en el socket Unix `unixPath`, solo para su dueño. */
export function listenUnix(server: Server, unixPath: string): Promise<Server> {
  track(server);
  return listening(server, (done) =>
    server.listen(unixPath, () => {
      chmodSync(unixPath, 0o600);
      done();
    }),
  );
}

/** Cierra el servidor y corta sus conexiones abiertas, sin esperar a los clientes. */
export const closeServer = (server: Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    for (const socket of open.get(server) ?? []) socket.destroy();
  });
