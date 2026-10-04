# Performance

## Measure Before Optimizing

Performance work without measurement is guessing, and guessing produces complexity that
costs more than the speed it buys. Profile first, find the actual bottleneck, fix that one
thing, measure again.

Do not optimize before there is evidence of a problem. Do fix the known anti-patterns below
on sight, because they are defects rather than optimizations.

## Workflow

1. **Measure** a baseline from representative data and hardware.
2. **Identify** the actual bottleneck, not the assumed one.
3. **Fix** that bottleneck only.
4. **Verify** by measuring again, then keep or revert.
5. **Guard** with a budget, a monitor, or a test so the regression cannot return silently.

## Budgets

Defaults until the project sets its own numbers or an ADR changes them:

| Signal                             | Target        |
| ---------------------------------- | ------------- |
| Largest Contentful Paint           | 2.5s or less  |
| Interaction to Next Paint          | 200ms or less |
| Cumulative Layout Shift            | 0.1 or less   |
| API response time, 95th percentile | under 200ms   |
| Initial JavaScript, gzipped        | under 200KB   |
| CSS, gzipped                       | under 50KB    |
| Above-the-fold image               | under 200KB   |

Record the project's real budgets and enforce them in CI when the pipeline supports it.

Presupuestos propios del proyecto:

| Señal | Objetivo | Medición |
| --- | --- | --- |
| Búsquedas de terceros y productos con el volumen de referencia de Q-26 (10 000 de cada uno por empresa) | P95 de 300 ms o menos en el entorno registrado; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:search`, gate dedicado fuera de `verify` (design D16 de `add-parties-and-products`). Resultado del 2026-10-03: P95 máximo de 26 ms (`benchmarks/search-2026-10-03.md`). |
| Emisión local de una factura hasta `SIGNED`, con el volumen de referencia provisional de Q-26 (100 000 facturas por empresa, 10 usuarios concurrentes) | P95 del total de 2 s o menos en el entorno registrado; no es una promesa universal de hardware | `corepack pnpm --filter @facturador/backend bench:emission`, gate dedicado fuera de `verify` (design D16 de `add-invoice-emission`). Mide por separado, con `Server-Timing`, las lecturas y el snapshot, el cálculo, la transacción de la reserva, el XML, el XSD, la firma y la persistencia. Se mide localmente, nunca contra Pruebas del SRI. Resultado del 2026-10-03: P95 del total de 1630 ms (`benchmarks/emission-2026-10-03.md`); una ejecución anterior sobre el mismo código del backend dio 884 ms. |
| Generación del RIDE de una factura autorizada (spike S-4) | P95 menor que 1 s por documento en el entorno registrado; no es una garantía independiente del hardware | `backend/test/spikes/s4-ride/bench.ts` en la rama `spike/s4-ride-pdf`: 50 RIDE (38 de una página y 12 de hasta 6), con calentamiento aparte y etapas separadas, en el runtime de la API y en `node:24.21.0-slim`. Resultado del 2026-10-04: P95 de 200 ms y 192 ms, máximos de 224 ms y 212 ms (`benchmarks/ride-2026-10-04.md`). El cambio 8 lo vuelve un benchmark propio. |

Si un benchmark supera el objetivo, se analiza la causa (en las búsquedas, los planes de consulta; en la emisión, sus etapas) y la corrección se propone con `/opsx:update`; nunca se sube el umbral.

Lectura del benchmark de la emisión del 2026-10-03, con dos ejecuciones sobre el mismo código del
backend (commits `726c488` y `eb185e2`; el informe guardado es la segunda):

| Ejecución | `total` P50 | `total` P95 | `total` máx. | `reservation_tx` P95 | `persist` máx. |
| --- | --- | --- | --- | --- | --- |
| Primera (`726c488`) | 635 ms | 884 ms | 1404 ms | 465 ms | 447 ms |
| Segunda (`eb185e2`) | 603 ms | 1630 ms | 2573 ms | 883 ms | 1923 ms |

- Las dos cumplen el objetivo, pero el margen varía: la cola del total sale de `reservation_tx` y `persist`, es decir, de esperas de bloqueos y confirmaciones, no de las etapas de CPU, que son estables entre ejecuciones.
- La validación XSD domina la mediana: unos 480 a 510 ms por las dos validaciones. Con 10 usuarios y `XSD_VALIDATION_CONCURRENCY=2`, la mayor parte es espera en la cola; S-2 midió 85 ms de p95 por validación en secuencia.
- `reservation_tx` sube de unos 40 ms de mediana a cientos de milisegundos en el P95 porque las emisiones de una empresa se serializan en el bloqueo de la configuración y del contador del punto (design D7). Es el precio buscado de una numeración sin huecos ni duplicados.
- Los artefactos previos son sintéticos de 64 bytes: el benchmark no mide el efecto del volumen real de `BYTEA` y TOAST de 100 000 XML firmados.

## Where To Start

Let the symptom choose the first measurement:

| Symptom                    | Measure first                                               |
| -------------------------- | ----------------------------------------------------------- |
| Slow first load            | Bundle size, then the network waterfall for blocking assets |
| Slow server response       | Time to first byte, then the query log for that route       |
| Interaction feels sluggish | Main-thread long tasks during the interaction               |
| Layout jumps while loading | Which elements shift, and whether they reserve space        |
| One endpoint slow          | Its query count and plan, then its indexes                  |
| Every endpoint slow        | Connection pool, memory, and CPU before touching any query  |
| Intermittent slowness      | Lock contention, external dependencies, and job runners     |

## Backend Anti-Patterns

- **N+1 queries**: loading related records inside a loop. Fetch the relation in one query.
- **Unbounded fetching**: every list endpoint paginates with an explicit limit and deterministic ordering.
- **Unindexed critical queries**: every query on a hot path maps to an index. See `../architecture/database.md`.
- **Oversized payloads**: return the fields the screen uses, not the whole record graph.
- **Synchronous heavy work in the request path**: move it to a persisted background job.
- **Missing cache on read-heavy, rarely-changed data**: when caching, declare the lifetime and who invalidates it.
- **Serial external calls**: parallelize independent provider requests and set explicit timeouts.

## Frontend Anti-Patterns

- **Unstable prop references** recreated on every render, forcing children to re-render.
- **Memoization everywhere**: overusing it costs as much as underusing it. Memoize what a profile shows is expensive.
- **Images without width and height**, without lazy loading below the fold, or without a modern format.
- **No route-level code splitting**, so a rarely used heavy feature loads on first paint.
- **Request waterfalls**: sequential fetches that could run in parallel.
- **Rendering large collections whole** instead of paginating or virtualizing.
- **Blocking the page for a local refresh**. See `../architecture/feedback-and-states.md`.

## Verify: Keep Or Revert

A fix is a hypothesis until it is re-measured. Re-measure the same way as the baseline:
same command, same conditions, same fixed budget of runs. Change one thing at a time; three
optimizations shipped together produce one number that cannot be attributed to any of them.
Compare the delta against run-to-run variance, not against the mean alone.

| Result against baseline          | Action                                                |
| -------------------------------- | ----------------------------------------------------- |
| Beats the threshold, tests green | Keep, with the before and after numbers in the commit |
| Inside run-to-run noise          | Revert                                                |
| Worse                            | Revert                                                |
| Better, but a test went red      | Revert; it is a regression wearing a win's clothing   |

**Neutral is a revert, not a keep.** This is the step that gets skipped: the change is
already written, discarding it feels wasteful, so it lands unmeasured and the codebase
accumulates complexity that never paid for itself. Code that is kept is maintained forever.

**Correctness gates the metric.** A win obtained by dropping work the product needed, such
as skipping a validation, caching something that must be fresh, or removing an await that
was load-bearing, is a regression.

## Attempt Ledger

Reverted work leaves no trace in history, which is why the same dead idea gets retried.
Record every attempt, kept and reverted alike, in the OpenSpec change's design or a project
performance log:

| Attempt       | Baseline to result | Verdict  | Why                               |
| ------------- | ------------------ | -------- | --------------------------------- |
| `{{ATTEMPT}}` | `{{BEFORE→AFTER}}` | kept     | Reason the number moved.          |
| `{{ATTEMPT}}` | `{{BEFORE→AFTER}}` | reverted | Inside noise; not the bottleneck. |

Read the ledger before proposing an experiment so a failed idea is not run twice.

## Rationalizations To Refuse

| Claim                                                | Reality                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| "We will optimize later."                            | Anti-patterns compound. Fix those now; defer only micro-optimizations. |
| "It is fast on my machine."                          | Profile on representative hardware and network conditions.             |
| "This optimization is obvious."                      | If it was not measured, it is not known.                               |
| "It did not help much, but it does not hurt."        | Neutral changes are reverts. Maintenance is paid forever.              |
| "We already wrote it, so we may as well keep it."    | Sunk cost. The measurement does not care how long it took to write.    |
| "The improvement is obvious, no need to re-measure." | Then re-measuring is cheap and settles it.                             |

## Reject The Change When

- an optimization has no profiling data behind it;
- a list endpoint has no pagination;
- data fetching introduces an N+1 pattern;
- several optimizations share one measurement, so none can be attributed;
- a "win" required a test to be changed, skipped, or deleted;
- a neutral result was kept instead of reverted;
- bundle size grew with no review.

## Verification

- [ ] Before and after measurements exist as specific numbers.
- [ ] The result was measured the same way as the baseline.
- [ ] The improvement exceeds run-to-run variance.
- [ ] Results that did not beat the baseline were reverted.
- [ ] Attempts were logged, reverted ones included.
- [ ] The specific bottleneck is named and addressed.
- [ ] No new N+1 pattern or unbounded query was introduced.
- [ ] Budgets still pass.
- [ ] The existing test suite passes.
