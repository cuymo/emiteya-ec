// Tiempos por etapa de una solicitud (add-invoice-emission, design D16): alimentan el histograma de
// la emisión y, solo con EMISSION_STAGE_TIMINGS=1, la cabecera `Server-Timing`. Una etapa medida con
// `measure` excluye las etapas anidadas en ella; una medida con `envelope` (`total`,
// `reservation_tx`) cuenta su tiempo completo. Una etapa medida varias veces acumula su duración.
// Supone las etapas de una sola solicitud, en secuencia.

export type StageTimings = {
  measure<T>(stage: string, work: () => Promise<T>): Promise<T>;
  measureSync<T>(stage: string, work: () => T): T;
  envelope<T>(stage: string, work: () => Promise<T>): Promise<T>;
  /** Etapas en el orden en que empezaron, con su duración en milisegundos. */
  entries(): readonly StageTiming[];
};

export type StageTiming = Readonly<{ stage: string; ms: number }>;

export function createStageTimings(clock: () => number = () => performance.now()): StageTimings {
  const totals = new Map<string, number>();
  const open: { started: number; nested: number }[] = [];
  const reserve = (stage: string) => {
    if (!totals.has(stage)) totals.set(stage, 0);
  };
  const add = (stage: string, ms: number) => totals.set(stage, (totals.get(stage) ?? 0) + ms);
  const begin = (stage: string) => {
    reserve(stage);
    const frame = { started: clock(), nested: 0 };
    open.push(frame);
    return frame;
  };
  const end = (stage: string, frame: { started: number; nested: number }) => {
    const elapsed = clock() - frame.started;
    open.splice(open.lastIndexOf(frame), 1);
    const parent = open.at(-1);
    if (parent) parent.nested += elapsed;
    add(stage, elapsed - frame.nested);
  };
  return {
    async measure(stage, work) {
      const frame = begin(stage);
      try {
        return await work();
      } finally {
        end(stage, frame);
      }
    },
    measureSync(stage, work) {
      const frame = begin(stage);
      try {
        return work();
      } finally {
        end(stage, frame);
      }
    },
    async envelope(stage, work) {
      reserve(stage);
      const started = clock();
      try {
        return await work();
      } finally {
        add(stage, clock() - started);
      }
    },
    entries: () => [...totals].map(([stage, ms]) => ({ stage, ms })),
  };
}

/** Sin medición: ejecuta el trabajo tal cual. */
export const NO_TIMINGS: StageTimings = {
  measure: (_stage, work) => work(),
  measureSync: (_stage, work) => work(),
  envelope: (_stage, work) => work(),
  entries: () => [],
};

/** Valor de `Server-Timing`: `etapa;dur=12.3, …`. */
export const serverTimingHeader = (entries: readonly StageTiming[]) =>
  entries.map(({ stage, ms }) => `${stage};dur=${ms.toFixed(1)}`).join(", ");
