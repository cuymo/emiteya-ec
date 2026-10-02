---
name: optimize-performance
description: Use when a performance requirement exists, when load times or query times regress, or when profiling is needed. Enforces measuring before optimizing and reverting changes that do not beat the baseline.
---

# Optimize Performance

## Context To Load

Read:

- `docs/quality/performance.md`
- Relevant architecture document for the layer being measured.
- `docs/architecture/database.md` for query and index work.
- The project's performance ledger or the OpenSpec change's design, to avoid repeating a failed attempt.

## Workflow

1. State the symptom and the user-visible cost. Refuse to optimize without one.
2. Measure a baseline on representative data and hardware, and record the exact command and conditions.
3. Identify the bottleneck from the measurement, not from assumption.
4. Change one thing.
5. Re-measure the same way as the baseline.
6. Keep only if the result beats run-to-run variance and the suite stays green. Otherwise revert.
7. Record the attempt with its numbers and verdict, including reverted attempts.
8. Add a budget, monitor, or test so the regression cannot return unnoticed.

## Guardrails

- Do not optimize without evidence of a problem.
- Do not bundle several optimizations into one measurement.
- Do not keep a change that landed inside the noise; neutral is a revert.
- Do not accept a win that required changing, skipping, or deleting a test.
- Do not gain speed by dropping work the product needs.
- Do not add memoization, caching, or indirection that no profile justified.
- Do not leave a list endpoint unpaginated or a relation loaded inside a loop.
