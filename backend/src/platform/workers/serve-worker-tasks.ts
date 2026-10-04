// Lado del worker de la primitiva de pool (design D18 de add-signing-certificate y D6 de
// add-document-archive). Ejecuta la tarea pedida y responde `{ ok: true, value }` o
// `{ ok: false, code }`. Un error que no sea WorkerTaskError se responde como INTERNAL, sin su
// mensaje: podría citar datos de la tarea.
import { parentPort } from "node:worker_threads";

/** Error tipado de una tarea: solo su código cruza al hilo principal. */
export class WorkerTaskError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "WorkerTaskError";
    this.code = code;
  }
}

export type WorkerTaskHandlers = Record<string, (payload: never) => unknown>;

export function serveWorkerTasks(handlers: WorkerTaskHandlers): void {
  if (!parentPort) throw new Error("serveWorkerTasks solo se ejecuta dentro de un worker.");
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
          code: error instanceof WorkerTaskError ? error.code : "INTERNAL",
        });
      }
    })();
  });
}
