// Apagado ordenado: deja de aceptar conexiones, espera las peticiones en curso y cierra recursos.
import type { Server } from "node:http";
import type { Logger } from "pino";

export type Closer = { name: string; close: () => Promise<void> };

export function createShutdown(options: {
  server: Server;
  closers: Closer[];
  logger: Logger;
  timeoutMs?: number;
}) {
  const { server, closers, logger, timeoutMs = 10_000 } = options;
  let shuttingDown: Promise<void> | undefined;

  return function shutdown(signal: string): Promise<void> {
    shuttingDown ??= (async () => {
      logger.info({ signal }, "apagando");
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          logger.warn("tiempo de apagado agotado; cerrando conexiones abiertas");
          server.closeAllConnections();
          resolve();
        }, timeoutMs).unref(),
      );
      server.closeIdleConnections();
      await Promise.race([closed, timeout]);
      for (const closer of closers) {
        await closer.close();
        logger.info({ resource: closer.name }, "recurso cerrado");
      }
    })();
    return shuttingDown;
  };
}
