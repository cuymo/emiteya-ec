// Tiempos por etapa de la emisión (add-invoice-emission, design D16): etapas exclusivas, envolventes
// completas, acumulación y formato de `Server-Timing`, con un reloj controlado.
import { describe, expect, it } from "vitest";
import {
  NO_TIMINGS,
  createStageTimings,
  serverTimingHeader,
} from "../../src/platform/metrics/stage-timings.ts";

function manualClock() {
  let now = 0;
  return { clock: () => now, advance: (ms: number) => (now += ms) };
}

describe("tiempos por etapa", () => {
  it("excluye de una etapa las anidadas, acumula las repetidas y deja completas las envolventes", async () => {
    const { clock, advance } = manualClock();
    const timings = createStageTimings(clock);
    await timings.envelope("total", async () => {
      await timings.envelope("reservation_tx", async () => {
        advance(2);
        await timings.measure("validation_snapshot", () => {
          advance(5);
          timings.measureSync("arithmetic", () => advance(3));
          return Promise.resolve(advance(1));
        });
        await timings.measure("validation_snapshot", () => Promise.resolve(advance(4)));
        advance(10);
      });
      await timings.measure("xsd", () => Promise.resolve(advance(7)));
      await timings.measure("sign", () => Promise.resolve(advance(20)));
      await timings.measure("xsd", () => Promise.resolve(advance(6)));
    });
    expect(timings.entries()).toEqual([
      { stage: "total", ms: 58 },
      { stage: "reservation_tx", ms: 25 },
      { stage: "validation_snapshot", ms: 10 },
      { stage: "arithmetic", ms: 3 },
      { stage: "xsd", ms: 13 },
      { stage: "sign", ms: 20 },
    ]);
  });

  it("registra la etapa aunque el trabajo falle", async () => {
    const { clock, advance } = manualClock();
    const timings = createStageTimings(clock);
    await expect(
      timings.envelope("total", () =>
        timings.measure("xml", () => {
          advance(4);
          return Promise.reject(new Error("fallo"));
        }),
      ),
    ).rejects.toThrow("fallo");
    expect(timings.entries()).toEqual([
      { stage: "total", ms: 4 },
      { stage: "xml", ms: 4 },
    ]);
  });

  it("forma la cabecera Server-Timing con un decimal y no mide sin instrumentación", async () => {
    expect(
      serverTimingHeader([
        { stage: "total", ms: 12.345 },
        { stage: "sign", ms: 3 },
      ]),
    ).toBe("total;dur=12.3, sign;dur=3.0");
    expect(await NO_TIMINGS.measure("xml", () => Promise.resolve(1))).toBe(1);
    expect(NO_TIMINGS.entries()).toEqual([]);
  });
});
