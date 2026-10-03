# Architecture Index

## Read Order

1. `ARCHITECTURE.md`
   - Emisión fiscal y orquestación SRI: `docs/architecture/fiscal-emission.md`, obligatorio para todo cambio que toque comprobantes, numeración, firma o el SRI.
   - Requisitos no funcionales: `docs/architecture/non-functional-requirements.md`
2. `docs/architecture/stack.md`
3. `docs/architecture/bootstrap.md`
4. `docs/architecture/backend.md`
5. `docs/architecture/frontend.md`
6. `docs/architecture/cognitive-architecture.md`
7. `docs/architecture/design-foundations.md`
8. Frontend pattern required by the task:
   - `docs/architecture/component-selection.md`
   - `docs/architecture/component-system.md`
   - `docs/architecture/interface-design.md`
   - `docs/architecture/data-tables.md`
   - `docs/architecture/forms-and-workflows.md`
   - `docs/architecture/feedback-and-states.md`
   - `docs/architecture/navigation-responsive.md`
9. `docs/architecture/authentication.md`
10. `docs/architecture/database.md`
    - Importes, precios, cantidades y tarifas: `docs/architecture/decimal-policy.md`
11. `docs/architecture/idempotency.md`
12. `docs/architecture/integrations.md`
13. `docs/architecture/deployment.md`
14. `docs/architecture/adr/`

## Architecture Rules

- Document boundaries explicitly.
- Keep dependency direction enforceable.
- Prefer tests or lint rules for critical constraints.
- Record irreversible or costly decisions as ADRs.
- Use the default stack unless an ADR explains why a project deviates.
