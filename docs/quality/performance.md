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
| Generación del RIDE de una factura autorizada (`add-document-archive`) | P95 del render menor que 1 s por documento en el entorno registrado, sin la espera de cola; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:ride`, gate dedicado fuera de `verify` (design D15). 50 RIDE de facturas reales (una página y hasta 4) con calentamiento aparte, por el código real: runner, handler, `RideWorkerPool` con 2 workers y persistencia. Informa por separado el render en el worker, la espera de cola y el job, y el retraso máximo del event loop. Resultado del 2026-10-04: P95 del render de 173 ms en el host y 178 ms en `node:24.21.0-slim`, con un retraso máximo del event loop de 10 y 8 ms, y los 50 PDF idénticos byte a byte en los dos entornos (`benchmarks/ride-render-2026-10-04.md`). El spike S-4 había medido 200 y 192 ms con el prototipo (`benchmarks/ride-2026-10-04.md`). |
| Inventario (`add-minimal-inventory`): lista con y sin filtro, detalle, kárdex (primera página y filtrado por fechas), entrada manual y salida automática de una factura de varias líneas, con 10 000 productos inicializados y el kárdex de 100 000 facturas | ERS RNF-005: P95 menor que 2 s por operación en el entorno registrado; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:inventory`, gate dedicado fuera de `verify` (design D15). Siembra por SQL, con los triggers de integridad activos, 10 000 productos inicializados (más 1 000 marcados sin inicializar y 1 000 sin marca) y 251 990 movimientos; mide desde el cliente HTTP las consultas y la entrada, y en proceso el seguidor real en su transacción; termina con la reconciliación diagnóstica. Resultado del 2026-10-04 sobre el commit final del cambio: P95 máximo de 71 ms (la lista sin filtro, que pasa a la lectura de productos los 10 000 identificadores inicializados), kárdex de 9 ms con 20 013 movimientos en el producto, entrada de 34 ms, salida de una factura de 5 líneas de 14 ms y la reconciliación sin diferencias (`benchmarks/inventory-2026-10-04.md`). |
| Notas de crédito (`add-credit-notes`): facturas elegibles, vista previa del borrador, emisión con su reserva sin y con créditos previos, cálculo de una devolución parcial de 100 líneas, reservas que compiten por la misma factura y simultáneas de facturas distintas, y el RIDE de la nota, con 100 000 facturas y 10 000 con créditos previos | ERS RNF-005: P95 menor que 2 s por operación, y el P95 del render del RIDE menor que 1 s, en el entorno registrado; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:credit-notes`, gate dedicado fuera de `verify` (design D21). Siembra por SQL, con los triggers de la capacidad activos, 100 000 facturas autorizadas de 5 líneas y 10 000 notas previas de 2 líneas (aplicadas o reservadas); mide desde el cliente HTTP contra `main.ts`, con las etapas de `Server-Timing` de la emisión (`EMISSION_STAGE_TIMINGS`), el cálculo en proceso y el RIDE en `RideWorkerPool`; para la contención, 10 rondas de 10 emisiones simultáneas con el rendimiento y la espera por bloqueos; termina con la reconciliación de las dos capacidades. Resultado del 2026-10-05 sobre el commit final del cambio: facturas elegibles con P95 de 867 ms (el más alto de las consultas), vista previa de 12 a 24 ms, cálculo de 100 líneas de 6 ms, emisión de 437 ms sin créditos previos y 561 ms con ellos, con `reservation_tx` de 109 y 120 ms; 10 simultáneas con un total de 1556 ms (misma factura) y 1110 ms (facturas distintas), 9,5 y 9,8 reservas por segundo y una espera por bloqueos de 929 y 716 ms en el P95; RIDE de 94 ms y la reconciliación sin diferencias. Dos máximos aislados superan 2 s (una emisión en serie de 2585 ms y una simultánea de 2257 ms); el P95 cumple (`benchmarks/credit-notes-2026-10-05.md`). |
| Notas de débito (`add-debit-notes`): facturas elegibles, vista previa de un borrador de 1 y de 100 conceptos, cálculo de 100 conceptos de un tratamiento y de cinco, emisión con su reserva, reservas simultáneas de una misma factura y de facturas distintas, y el RIDE de la nota, con 100 000 facturas | ERS RNF-005: P95 menor que 2 s por operación, y el P95 del render del RIDE menor que 1 s, en el entorno registrado; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:debit-notes`, gate dedicado fuera de `verify` (design D25). Siembra por SQL 100 000 facturas autorizadas de 5 líneas en dos tratamientos de IVA (15 % y 0 %); mide desde el cliente HTTP contra `main.ts`, con las etapas de `Server-Timing` de la emisión (`EMISSION_STAGE_TIMINGS`), el cálculo en proceso y el RIDE en `RideWorkerPool`; para la contención, 10 rondas de 10 emisiones simultáneas con el rendimiento y la espera por bloqueos; termina comprobando que las notas no tocaron la capacidad acreditable ni el inventario. Resultado del 2026-10-05 sobre el commit final del cambio (`66787e9`), con el barrido del RIDE apagado para no encolar el RIDE de las facturas sembradas: facturas elegibles con P95 de 709 a 840 ms (el más alto de las consultas), vista previa de 13,7 ms (1 concepto) y 16,9 ms (100 conceptos), cálculo de 100 conceptos de 0,9 y 1 ms, emisión de 263,6 ms con `reservation_tx` de 29,5 ms; 10 simultáneas con un total de 763 ms (misma factura) y 766 ms (facturas distintas), 12,9 y 13 reservas por segundo y una espera por bloqueos de 250 y 244 ms en el P95: la misma factura no serializa más que facturas distintas, porque la nota no la bloquea; RIDE de 100,7 ms; 311 notas sin filas de capacidad acreditable ni movimientos de inventario (`benchmarks/debit-notes-2026-10-05.md`). |
| Comprobantes de retención (`add-withholding-receipts`): búsqueda de proveedores, resolución de los catálogos, creación y vista previa del borrador del peor caso (límites por defecto y máximos absolutos), cálculo de 50 y de 300 retenciones, emisión con su reserva en serie y del peor caso, reservas simultáneas para un mismo proveedor y para proveedores distintos, lista y búsqueda de retenciones, y el RIDE de una retención y del máximo de filas, con 10 000 proveedores y 100 000 retenciones | ERS RNF-005: P95 menor que 2 s por operación, y el P95 del render del RIDE menor que 1 s, en el entorno registrado; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:withholding-receipts`, gate dedicado fuera de `verify` (design D27). Siembra por SQL 10 000 proveedores y 100 000 retenciones autorizadas de dos retenciones en doce períodos; mide desde el cliente HTTP contra `main.ts` con los límites de recursos en sus máximos absolutos, con las etapas de `Server-Timing` de la emisión, el CPU y la memoria residente del proceso del backend, el cálculo en proceso y el RIDE en `RideWorkerPool`; para la contención, 10 rondas de 10 emisiones simultáneas; termina comprobando que las retenciones no tocaron la capacidad acreditable ni el inventario. Resultado del 2026-10-06 sobre el commit final de la implementación (`e39c915`), con el barrido del RIDE apagado: proveedores con P95 de 11,5 a 14,9 ms, opciones de 25,2 ms, lista y búsqueda de retenciones de 25 a 77 ms; peor caso por defecto (10 documentos × 5 retenciones, 5 impuestos y 5 pagos): vista previa de 26,9 ms y emisión de 341,1 ms con `reservation_tx` de 81,6 ms, 22,2 ms de CPU del backend por petición del borrador y 92 MiB más de memoria residente (761,4 → 853 MiB); máximos absolutos (30 × 10 × 10 × 10): vista previa de 28,7 ms y emisión de 558,3 ms con `reservation_tx` de 196,6 ms y 106 MiB más (853 → 958,5 MiB); cálculo de 300 retenciones de 3,4 ms; emisión en serie de 277,3 ms con `reservation_tx` de 49,4 ms; 10 simultáneas con un total de 890 ms (mismo proveedor) y 833 ms (proveedores distintos), 11,2 y 11,8 reservas por segundo: el mismo proveedor no serializa más; RIDE de 96,5 ms (una retención) y 319,4 ms (300 retenciones, 15 páginas); 100 333 retenciones sin filas de capacidad acreditable ni movimientos de inventario. Los valores por defecto de design D25 quedan confirmados. El XML firmado del peor caso mide 46 614 bytes con los límites por defecto y 230 114 con los máximos absolutos: **solo una medición de recursos**, sin relación con Q-47 ni con ningún límite del SRI (`benchmarks/withholding-receipts-2026-10-06.md`). |
| Guías de remisión (`add-shipping-guides`): búsqueda de transportistas, de destinatarios y de facturas elegibles, mercancías sugeridas de una factura de 5 y de 100 líneas, creación y vista previa del borrador del peor caso (límites por defecto y máximos absolutos), emisión con su reserva en serie y del peor caso, 10 emisiones simultáneas sobre la misma factura y sobre facturas distintas, lista y búsqueda de guías, bandeja filtrada por la identificación de un destinatario, y el RIDE de una guía y del máximo de filas, con 10 000 terceros, 10 000 productos, 20 000 facturas y 100 000 guías | ERS RNF-005: P95 menor que 2 s por operación, y el P95 del render del RIDE menor que 1 s, en el entorno registrado; no es una garantía independiente del hardware | `corepack pnpm --filter @facturador/backend bench:shipping-guides`, gate dedicado fuera de `verify` (design D28). Siembra por SQL 10 000 terceros (2 000 transportistas), 10 000 productos, 20 000 facturas autorizadas de 5 líneas y 100 000 guías autorizadas de uno a tres destinatarios, y asienta la base con `VACUUM (ANALYZE)` y un `CHECKPOINT`; mide desde el cliente HTTP contra `main.ts` con los límites de recursos en sus máximos absolutos, con las etapas de `Server-Timing` de la emisión, el CPU y la memoria residente del proceso del backend y el RIDE en `RideWorkerPool`; para la contención, 10 rondas de 10 emisiones simultáneas; termina comprobando que las guías no crearon movimientos de inventario ni cambiaron una factura, sus XML o los roles de un tercero. Resultado del 2026-10-06 sobre el commit final de la implementación (`051e501`), con el barrido del RIDE apagado (cuarta ejecución; lectura abajo): transportistas y destinatarios con P95 de 8,6 a 10,3 ms, facturas elegibles de 14,2 a 33,8 ms, mercancías sugeridas de 9,2 ms (5 líneas) y 83,6 ms (100 líneas); peor caso por defecto (10 destinatarios × 10 detalles, textos de 300, cuerpo de 54,7 KiB): creación de 47,1 ms, vista previa de 18 ms y emisión de 338,5 ms con `reservation_tx` de 67,6 ms, 19 ms de CPU del backend por petición del borrador y 63 MiB más de memoria residente (666,1 → 729 MiB); máximos absolutos (50 × 6 = 300 detalles, textos de 100, cuerpo de 97,4 KiB): creación de 144,9 ms, vista previa de 51,1 ms y emisión de 441,2 ms con `reservation_tx` de 145,2 ms y 105 MiB más (728,9 → 833,9 MiB); emisión en serie de 220,1 ms con `reservation_tx` de 26 ms; 10 simultáneas con un total de 859,6 ms (misma factura) y 697,1 ms (facturas distintas), 12,7 y 14,2 reservas por segundo; lista de guías de 21 ms y filtro por estado de 41,7 ms; búsqueda de guías por número, destinatario o transportista de 573,3 a 601,7 ms; bandeja filtrada por la identificación de un destinatario de 375,1 ms; RIDE de 96,5 ms (una guía) y 559,7 ms (300 detalles, 26 páginas); 100 333 guías sin movimientos de inventario y con las facturas, sus XML y los roles sin cambios. Los valores por defecto de design D23 quedan confirmados. El XML firmado del peor caso mide 78 827 bytes con los límites por defecto y 168 062 con los máximos absolutos (textos de 100): **solo una medición de recursos**, sin relación con Q-47 ni con ningún límite del SRI (`benchmarks/shipping-guides-2026-10-06.md`). |

Si un benchmark supera el objetivo, se analiza la causa (en las búsquedas, los planes de consulta; en la emisión, sus etapas) y la corrección se propone con `/opsx:update`; nunca se sube el umbral.

Lectura del benchmark de las guías de remisión del 2026-10-06, con cuatro ejecuciones: tres sobre el
código del backend de `1d2940a` y la cuarta sobre el commit final (`051e501`), que solo le añade la
cantidad cero guardable en el borrador y los rechazos que nombran su destinatario y su detalle; el
informe guardado es la cuarta:

| Ejecución | Peor caso máximo: total P95 | Su `persist` máx. | Facturas distintas, 10 simultáneas: total P95 | Su `reservation_tx` máx. |
| --- | --- | --- | --- | --- |
| Primera (solo `ANALYZE`) | 1806,8 ms | 1288,8 ms | 1758,8 ms | 2876 ms |
| Segunda (solo `ANALYZE`) | 3405,2 ms (fuera del objetivo) | 2938,6 ms | 1003 ms | 775,1 ms |
| Tercera (`VACUUM (ANALYZE)` y `CHECKPOINT`) | 464,6 ms | 17,8 ms | 689,4 ms | 295,8 ms |
| Cuarta, commit final (`VACUUM (ANALYZE)` y `CHECKPOINT`) | 441,2 ms | 16,5 ms | 697,1 ms | 310,6 ms |

- Las colas de las dos primeras salieron de `persist` y de `reservation_tx`, es decir, de esperas de confirmación y de bloqueos, nunca de las etapas de CPU (`xml`, `xsd`, `sign`), que fueron estables. Coincidieron con los checkpoints que PostgreSQL disparó por WAL para volcar la siembra masiva (`checkpoint starting: wal` en su log, con escrituras de 95 a 270 s): en la segunda, las mediciones empezaron con uno de ellos en curso, y la emisión del peor caso con los máximos absolutos superó el objetivo en una de sus 10 muestras. La tercera y la cuarta asientan la base después de sembrar y las colas desaparecen; el objetivo no cambió. Entre la misma factura y facturas distintas no hay una diferencia sistemática: la más lenta cambia de una ejecución a otra.
- La búsqueda de guías por número, destinatario o transportista es la consulta más lenta (P95 de 552 a 639 ms en las cuatro ejecuciones) y no depende de cuántas coinciden; la bandeja filtrada por la identificación de un destinatario tarda de 368 a 402 ms. La hipótesis, sin medir todavía, es que el `contains` (`LIKE '%…%'`) sobre el número, el transportista y los destinatarios, unidos por `OR` y sin índice de trigramas, recorre los 100 000 comprobantes y los 200 000 destinatarios, y que en la bandeja el `OR` entre el comprador y el `EXISTS` de los destinatarios impide usar un solo índice. Las dos cumplen el objetivo y este change no añade índices; si el volumen crece, se analizan primero sus planes.
- **Límite del cuerpo JSON:** en esta ejecución, con los máximos absolutos (50 destinatarios, 300 detalles) y todos los textos en 300 caracteres, el cuerpo del borrador medía 185,1 KiB, más que el límite global de 100 KB de `express.json`, y la API respondía `413 PAYLOAD_TOO_LARGE` antes de aplicar los límites de la guía; por eso el benchmark midió los máximos absolutos con textos de 100 (97,4 KiB). El `/opsx:update` posterior dio a crear y actualizar un borrador un límite propio de 2 MiB (design D23, segunda capa), que hace alcanzables esos máximos también con textos multibyte; el resto de la API conserva los 100 KB. El script conserva la forma medida para que los resultados sigan siendo comparables.
- El RIDE del máximo de filas (300 detalles, 26 páginas) tarda de 529 a 667 ms de P95 en las cuatro ejecuciones, dentro del objetivo de 1 s.

Lectura del benchmark de las notas de crédito del 2026-10-05:

- El rendimiento con contención es casi el mismo en la misma factura que en facturas distintas (9,5 y 9,8 reservas por segundo): lo limita la serialización de la empresa en el bloqueo de la configuración y en el contador del punto, como en la factura, no el bloqueo de la capacidad de una factura. La espera por bloqueos del P95 (de 716 a 929 ms sobre una mediana en serie de 52 ms) sale de ahí.
- La búsqueda de facturas elegibles es la consulta más lenta (P95 de 820 a 867 ms con 100 000 facturas, de una a toda la empresa) y no depende de cuántas coinciden. La hipótesis, sin medir todavía, es que el filtro de consumidor final lee el snapshot JSON de cada factura en la consulta de la página y en la del conteo; una columna o un índice lo evitarían. Cumple el objetivo; si crece, se analiza con su plan y se propone con `/opsx:update`.

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
