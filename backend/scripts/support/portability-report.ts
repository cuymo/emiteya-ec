// Informe en Markdown de `bench:data-portability` (add-data-portability, design D22), a partir de los
// resultados que el benchmark guarda en JSON.
type Summary = { samples: number; p50: number; p95: number; max: number };
type Download = {
  status: number;
  received: number;
  sha256Matches: boolean;
  headersMs: number;
  totalMs: number;
  throughputMiBs: number;
  rssGrowthMiB: Record<string, number>;
};
export type PortabilityBenchResults = {
  seedSeconds: number;
  environment: Record<string, string>;
  volume: Record<string, { rows: number; totalSize: string }>;
  templateBytes: { signed: number; ride: number };
  sameCompany409: number;
  generation: {
    totalSeconds: number;
    queuedToReadySeconds: number;
    phases: Record<string, number>;
    phaseTimeline: { phase: string; at: number; done: number | null; total: number | null }[];
    cpuSeconds: number;
    rssStartMiB: number;
    rssPeakMiB: number;
    diskPeakMiB: number;
    freeMinGiB: number;
    zipBytes: number;
    zipMiB: number;
    entries: number;
    counts: Record<string, number>;
  };
  snapshot: {
    longestTransactionSeconds: number;
    maxXminAge: number;
    churnUpdatesPerSecond: number;
    maxDeadTuplesRetained: number;
  };
  lists: { budgetMs: number; idle: Summary; duringGeneration: Summary };
  lease: { renewalsObserved: number; renewStatement: Summary };
  crossCompanyQueue: { otherStartedAfterFirstFinishedSeconds: number; otherWaitedSeconds: number };
  download: Record<"directCold" | "directWarm" | "nextCold" | "nextWarm", Download>;
  validation: Record<string, unknown>;
  xsd: { sample: number; valid: number };
  recovery: Record<string, unknown>;
  staleWorker: Record<string, unknown>;
  ttlSweep: { sweepIntervalSeconds: number; expiredAndRemovedSeconds: number };
  failures: string[];
};

const cell = (value: unknown) =>
  typeof value === "object" && value !== null ? `\`${JSON.stringify(value)}\`` : String(value);
const table = (rows: [string, unknown][]) =>
  ["| Clave | Valor |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)].join(
    "\n",
  );

export function renderPortabilityReport(r: PortabilityBenchResults, date: string): string {
  const g = r.generation;
  const downloads = Object.entries(r.download).map(
    ([name, d]) =>
      `| ${name} | ${d.status} | ${d.sha256Matches ? "Sí" : "No"} | ${d.headersMs} | ${d.totalMs} | ${d.throughputMiBs} | ${Object.entries(
        d.rssGrowthMiB,
      )
        .map(([process, growth]) => `${process} +${growth} MiB`)
        .join("; ")} |`,
  );
  return `# Benchmark de la portabilidad (${date})

Volumen de Q-26: 100000 comprobantes de los seis tipos en Producción a lo largo de un año y 2000 facturas de Pruebas, con el XML firmado de cada uno y, de cada autorizado, su XML autorizado, su RIDE y dos respuestas del SRI; los bytes son los de una factura real de tres líneas validada contra el XSD y firmada con la firma sintética (${r.templateBytes.signed} bytes) y de su RIDE renderizado (${r.templateBytes.ride} bytes), con la clave de acceso de cada comprobante. Además, 10000 terceros, 10000 productos, 300000 movimientos, 300000 eventos de auditoría, transiciones, entregas, 10 usuarios y las firmas con sus secretos marcados. Siembra por SQL en ${r.seedSeconds} s, con los triggers de su sesión apagados, seguida de \`VACUUM (ANALYZE)\` y un \`CHECKPOINT\`. La generación es la del job real en \`main.ts\`, con la transmisión deshabilitada, el barrido del RIDE apagado y \`DATA_EXPORT_MAX_CONCURRENT\` en 1. Generado por \`bench:data-portability\`; datos en \`data-portability-${date}.json\`.

## Entorno

${table(Object.entries(r.environment))}

## Volumen

| Tabla | Filas | Tamaño total |
| --- | --- | --- |
${Object.entries(r.volume)
  .map(([name, v]) => `| \`${name}\` | ${v.rows} | ${v.totalSize} |`)
  .join("\n")}

## Generación

${table([
  ["Total, desde la solicitud (s)", g.totalSeconds],
  ["En cola hasta lista (s)", g.queuedToReadySeconds],
  ["Fases (s, `data_export_phase_duration_seconds`)", g.phases],
  ["CPU de main.ts (s)", g.cpuSeconds],
  ["Memoria residente de main.ts: inicial y máxima (MiB)", `${g.rssStartMiB} y ${g.rssPeakMiB}`],
  ["Disco máximo del directorio (MiB)", g.diskPeakMiB],
  ["Espacio libre mínimo (GiB)", g.freeMinGiB],
  ["Tamaño del ZIP (bytes)", g.zipBytes],
  ["Tamaño del ZIP (MiB)", g.zipMiB],
  ["Entradas del ZIP", g.entries],
  ["Conteos", g.counts],
])}

Progreso por fase (ms desde la solicitud):

| Fase | Desde (ms) | Comprobantes |
| --- | --- | --- |
${g.phaseTimeline
  .map((p) => `| ${p.phase} | ${p.at} | ${p.total === null ? "—" : `${p.done} de ${p.total}`} |`)
  .join("\n")}

## Fase 1: transacción de solo lectura

${table([
  ["Transacción más larga en la base (s)", r.snapshot.longestTransactionSeconds],
  ["Edad máxima de `backend_xmin` (transacciones)", r.snapshot.maxXminAge],
  ["Escrituras de la tabla de prueba por segundo", r.snapshot.churnUpdatesPerSecond],
  ["Tuplas muertas que VACUUM no pudo quitar (máximo)", r.snapshot.maxDeadTuplesRetained],
])}

## Listas de la API (ERS RNF-005, P95 < ${r.lists.budgetMs} ms)

| Momento | Muestras | P50 (ms) | P95 (ms) | Máx. (ms) |
| --- | --- | --- | --- | --- |
| En reposo | ${r.lists.idle.samples} | ${r.lists.idle.p50} | ${r.lists.idle.p95} | ${r.lists.idle.max} |
| Durante la generación | ${r.lists.duringGeneration.samples} | ${r.lists.duringGeneration.p50} | ${r.lists.duringGeneration.p95} | ${r.lists.duringGeneration.max} |

## Lease

${table([
  ["Renovaciones observadas", r.lease.renewalsObserved],
  ["Sentencia de renovación sobre el job real (ms)", r.lease.renewStatement],
])}

## Concurrencia

${table([
  ["Segunda solicitud de la misma empresa", r.sameCompany409],
  [
    "La otra empresa empezó después de terminar la primera (s)",
    r.crossCompanyQueue.otherStartedAfterFirstFinishedSeconds,
  ],
  ["Espera de la otra empresa en la cola (s)", r.crossCompanyQueue.otherWaitedSeconds],
])}

## Verificación previa y descarga

| Camino | Estado | SHA-256 | Cabeceras (ms) | Total (ms) | MiB/s | Crecimiento de la memoria |
| --- | --- | --- | --- | --- | --- | --- |
${downloads.join("\n")}

## Validación independiente del paquete

${table([...Object.entries(r.validation), ["XSD (muestra de facturas)", `${r.xsd.valid} de ${r.xsd.sample}`]])}

## Recuperación tras matar main.ts

${table(Object.entries(r.recovery))}

## Worker obsoleto con dos instancias

${table(Object.entries(r.staleWorker))}

## Caducidad con el barrido

${table([
  ["Intervalo del barrido (s)", r.ttlSweep.sweepIntervalSeconds],
  ["Caducado y borrado en (s)", r.ttlSweep.expiredAndRemovedSeconds],
])}

## Fallas

${r.failures.length === 0 ? "Ninguna." : r.failures.map((f) => `- ${f}`).join("\n")}
`;
}
