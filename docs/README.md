# Documentation Index

Use this directory as the project knowledge base.

## Sections

- `product/`: what the system does and why.
- `architecture/`: how the system is built and constrained.
- `quality/`: change lifecycle, testing, review, version control, performance, observability, technical debt, done criteria, the SRI certification procedure (`sri-certification.md`), its checklist for the Pruebas environment (`sri-test-environment-checklist.md`) and the egress allowlist of the certification session (`sri-egress-allowlist.md`).
- `security/`: security principles, access control, hardening controls, and threat model.
- `generated/`: generated or derived references.

## Maintenance Rule

When code changes behavior, update the relevant document in the same pull request.

For frontend work, answer the screen brief in `architecture/cognitive-architecture.md`
first, then start with `architecture/frontend.md`, open only the relevant interface-pattern
documents, and finish with `quality/frontend-checklist.md`.
