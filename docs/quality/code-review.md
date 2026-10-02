# Code Review Guide

Review for bugs first.

## Approval Standard

Approve a change when it clearly improves the health of the codebase, even if it is not
perfect. Do not block a change because it is not written the way you would have written it.
Do block a change that degrades correctness, security, or structure.

## Priority Order

1. Correctness and data integrity.
2. Security and permission boundaries.
3. Behavioral regressions.
4. Missing tests or verification.
5. Architecture drift.
6. Maintainability.
7. Interface consistency and visual workload.

## The Five Axes

### Correctness

Does it match the specification? Are null, empty, and boundary values handled? Are error
paths handled and not only the happy path? Do the tests exercise the behavior the change
claims, so that a regression would fail them?

### Readability

Are names specific and consistent with the project? Is the control flow straightforward?
Could this be shorter? Does each abstraction earn its complexity, or is it generalizing
before the third use? Is dead code left behind, such as unused variables, compatibility
shims, or commented-out blocks?

Two structural smells deserve findings rather than nits:

- a new conditional bolted onto an unrelated flow, which signals logic that wants its own helper, state, or policy;
- repeated conditionals on the same shape, which signal a missing model or dispatcher. A temporary branch is usually permanent.

### Architecture

Does it follow an existing pattern, and if it introduces a new one, is that justified? Does
the dependency direction in `ARCHITECTURE.md` still hold? Is feature-specific logic leaking
into a shared module? Is there a near-duplicate of an existing canonical helper?

Ask whether a refactor **reduces** complexity or merely relocates it. Count the concepts a
reader must hold. If the count is unchanged, the structure did not improve. Prefer the
restructuring that makes whole branches or layers disappear, and prefer deleting an
abstraction over polishing it.

Question loose type boundaries and silent fallbacks that paper over an unclear invariant.
Making the boundary explicit usually simplifies the control flow around it.

### Security

Apply `../security/hardening.md`. Confirm input is validated at boundaries, queries are
parameterized, authorization is enforced server-side per record, secrets stay out of code
and logs, output is encoded, and data from external sources is treated as untrusted.

Hunt the patterns listed in `../security/access-control.md`: lookups by a client-supplied ID
without a tenant scope, identity read from the payload, payloads passed to the ORM, and
permissions enforced only in the interface. Then ask what happens when each request arrives
twice or concurrently: critical `POST` operations, webhooks, and balance or inventory changes
must be idempotent and transactional. See `../architecture/idempotency.md`.

### Performance

Apply `performance.md`. Look for N+1 patterns, unbounded queries, list endpoints without
pagination, synchronous heavy work in the request path, and avoidable re-renders.

## Finding Severity

Label every finding so the author knows what is required:

| Label        | Meaning          | Expected action                                   |
| ------------ | ---------------- | ------------------------------------------------- |
| **Critical** | Blocks merge     | Security hole, data loss, or broken functionality |
| *(no label)* | Required         | Must be addressed before merge                    |
| **Consider** | Suggestion       | Worth weighing, not required                      |
| **Nit**      | Style preference | The author may decline                            |
| **FYI**      | Context only     | No action                                         |

Lead with what matters. Order findings by leverage: correctness and security, then
structural regressions, then everything else. If there is one structural problem and ten
nits, the structural problem is the review. A few high-conviction findings beat a long list.

## Structural Remedies

When flagging a structural problem, name the move. A finding that only says "this is
complex" leaves the author guessing:

- replace a chain of conditionals with a typed model or an explicit dispatcher;
- collapse duplicate branches into one flow;
- separate orchestration from business logic;
- move feature-specific logic into the module that owns the concept;
- reuse the canonical helper instead of a near-duplicate;
- make a type boundary explicit so downstream branching disappears;
- delete a pass-through wrapper that adds indirection without clarifying the API;
- extract a helper or split an oversized file.

Prefer the remedy that removes moving pieces over one that spreads the same complexity around.

## Size And Decomposition

Commit and pull request sizing lives in `version-control.md`. Review adds one more
dimension: a small diff can still push a file past a healthy boundary. When a change
materially grows an already-large file, ask whether to extract helpers or modules first.
Decompose, then add. A component or module that keeps growing is a finding, not a nit.

## Dead Code

After a refactor or a replacement, list what became unreachable and ask before deleting it:

```text
Now unused:
- helper replaced by its successor
- component replaced by the shared primitive
- constant with no remaining references
Safe to remove?
```

Do not leave dead code behind, and do not silently delete something whose use is uncertain.

## Dependency Review

Before adding a dependency: confirm the existing stack does not already solve it, check its
size, maintenance, known vulnerabilities, and license. Prefer existing utilities. See
`../security/hardening.md` for supply-chain checks.

Upgrading is a code change like any other, and bulk bumps are the riskiest:

- read the changelog, not the version number; a patch release can carry behavior changes;
- upgrade one dependency per change, so a broken build names its cause and the revert stays clean;
- require a green suite before and after; thin coverage around the dependency is itself the finding;
- review the lockfile diff, never hand-edit it, and always commit it.

## Honesty

- Do not approve without evidence of having reviewed.
- Do not soften a real defect into a "minor concern".
- Quantify when possible: name the added latency or the failing input rather than saying it could be slow.
- Push back on an approach with clear problems and propose the alternative.
- Comment on the code, not the author, and defer gracefully when the author has fuller context.
- Do not accept "we will clean it up later". Require the cleanup now or a recorded item in `technical-debt.md`.

## Review Output

Findings should include:

- Severity.
- File and line reference.
- Why it matters.
- Suggested direction.

If there are no findings, say that clearly and mention residual risk or untested areas.

For frontend reviews, use `frontend-checklist.md`. Report duplicated surfaces, inconsistent
table behavior, technical language, missing states, overflow, inaccessible controls, and
visual fatigue as real product defects rather than cosmetic preferences.

## Cambios fiscales

Todo cambio que toque el motor fiscal responde las quince preguntas del checklist de PR
fiscal de CTX §65: fuente oficial y versión, y efecto en XSD, clave de acceso, firma,
catálogos, cálculos, RIDE, secuenciales, estados y reintentos, fixtures, pruebas,
certificación en Pruebas, casos especiales y migraciones. Un cambio fiscal sin fuente
oficial citada se rechaza.

## Reject The Change When

- it merges without any review, or with approval but no evidence of review;
- a bug fix arrives without a regression test;
- a refactor relocates complexity instead of reducing it;
- feature logic was added to a shared module;
- a bespoke helper duplicates an existing canonical one;
- a silent fallback hides an unclear invariant;
- a private record is reachable through a client-supplied ID without a tenant scope;
- a critical mutation can run twice with no idempotency key, natural key, or guarded update;
- dependencies were bumped in bulk with no changelog review or lockfile diff;
- it is too large to review properly. Ask for the split instead of skimming.
