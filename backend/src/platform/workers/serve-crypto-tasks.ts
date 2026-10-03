// Lado del worker del pool criptográfico (design D18). Ejecuta la tarea pedida y responde
// `{ ok: true, value }` o `{ ok: false, code }`. Un error que no sea CryptoTaskError se responde
// como INTERNAL, sin su mensaje: podría citar datos de la tarea.
import { parentPort } from "node:worker_threads";

export class CryptoTaskError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "CryptoTaskError";
    this.code = code;
  }
}

export type CryptoTaskHandlers = Record<string, (payload: never) => unknown>;

export function serveCryptoTasks(handlers: CryptoTaskHandlers): void {
  if (!parentPort) throw new Error("serveCryptoTasks solo se ejecuta dentro de un worker.");
  const port = parentPort;
  port.on("message", (message: { task: string; payload: never }) => {
    void (async () => {
      const handler = handlers[message.task];
      if (!handler) return port.postMessage({ ok: false, code: "UNKNOWN_TASK" });
      try {
        port.postMessage({ ok: true, value: await handler(message.payload) });
      } catch (error) {
        port.postMessage({
          ok: false,
          code: error instanceof CryptoTaskError ? error.code : "INTERNAL",
        });
      }
    })();
  });
}
