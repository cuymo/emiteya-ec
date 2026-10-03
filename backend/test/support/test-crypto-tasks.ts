// Worker de prueba del pool criptográfico: tareas que simulan éxito, CPU, error tipado, fallo
// inesperado, cuelgue y la puesta a cero del buffer transferido.
import {
  CryptoTaskError,
  serveCryptoTasks,
} from "../../src/platform/workers/serve-crypto-tasks.ts";

const busy = (ms: number) => {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
};

serveCryptoTasks({
  echo: (payload: { value: string }) => ({ echoed: payload.value }),
  busy: (payload: { ms: number }) => ({ spent: busy(payload.ms) > 0 }),
  typed: () => {
    throw new CryptoTaskError("CERTIFICATE_PASSWORD_INVALID");
  },
  unexpected: (payload: { secret: string }) => {
    throw new Error(`fallo con ${payload.secret}`);
  },
  hang: () => {
    for (;;) busy(1000);
  },
  crash: () => process.exit(3),
  wipe: (payload: { bytes: ArrayBuffer }) => {
    const view = new Uint8Array(payload.bytes);
    const sum = view.reduce((a, b) => a + b, 0);
    view.fill(0);
    return { sum, zeroed: view.every((b) => b === 0) };
  },
});
