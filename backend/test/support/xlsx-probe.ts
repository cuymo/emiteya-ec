// node --conditions=development test/support/xlsx-probe.ts <archivo> <filas>
// Escribe el libro de prueba en un proceso propio (otra zona horaria o un heap limitado) y imprime
// los picos de memoria muestreados mientras escribe.
import { writeXlsx } from "../../src/platform/xlsx/xlsx-writer.ts";
import { fixtureSheets } from "./xlsx-fixture.ts";

const [path, rows] = process.argv.slice(2);
let peakHeap = 0;
let peakExternal = 0;
const sample = () => {
  const memory = process.memoryUsage();
  peakHeap = Math.max(peakHeap, memory.heapUsed);
  peakExternal = Math.max(peakExternal, memory.external + memory.arrayBuffers);
};
const timer = setInterval(sample, 20);
const counts = await writeXlsx(path!, fixtureSheets(Number(rows)));
sample();
clearInterval(timer);
console.log(JSON.stringify({ counts, peakHeap, peakExternal }));
