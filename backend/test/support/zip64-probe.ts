// node --conditions=development --expose-gc test/support/zip64-probe.ts <zip> <trabajo> <entradas>
// Escribe un paquete de prueba en un proceso propio (con el heap limitado) e imprime el resultado
// del contenedor y los picos de memoria muestreados mientras escribe.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { openZip64 } from "../../src/modules/data-portability/infrastructure/zip64.ts";

const [path, work, count] = process.argv.slice(2);
let peakHeap = 0;
let peakExternal = 0;
const sample = () => {
  const memory = process.memoryUsage();
  peakHeap = Math.max(peakHeap, memory.heapUsed);
  peakExternal = Math.max(peakExternal, memory.external + memory.arrayBuffers);
};
const timer = setInterval(sample, 20);
const zip = await openZip64(path!, work!);
for (let i = 0; i < Number(count); i++) {
  const folder = `documents/pruebas/01-factura/001-001-${String(i).padStart(9, "0")}`;
  if (i % 2 === 0)
    await zip.addBuffer(
      `${folder}/firmado.xml`,
      Buffer.from(`<factura n="${i}">${"x".repeat(200)}</factura>`),
      "deflate",
    );
  else await zip.addBuffer(`${folder}/ride.pdf`, randomBytes(512), "store");
}
// Justo antes de cerrar, el directorio central ya está en su temporal, salvo el último trozo sin
// volcar: si el contenedor lo guardara en memoria, el temporal estaría vacío.
const directoryOnDisk = (await stat(`${work!}.cd`)).size;
// Lo que el contenedor retiene tras una recolección completa: no depende del asignador ni del
// momento en que el recolector libera los búferes ya soltados.
const gc = (globalThis as { gc?: () => void }).gc;
gc?.();
await new Promise((resolve) => setTimeout(resolve, 200));
gc?.();
const retained = process.memoryUsage();
const retainedExternal = retained.external + retained.arrayBuffers;
const result = await zip.close();
sample();
clearInterval(timer);
const peakRss =
  Number(/VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"))?.[1] ?? 0) * 1024;
console.log(
  JSON.stringify({ result, peakHeap, peakExternal, peakRss, directoryOnDisk, retainedExternal }),
);
