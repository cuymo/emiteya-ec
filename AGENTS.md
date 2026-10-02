# Project Agent Guide

## Project

`facturadorsri-opensource` is a self-hosted, open source electronic invoicing application for
Ecuadorian taxpayers. It configures one taxpayer and issues, stores, and exports the six SRI
electronic documents in the off-line scheme. It is not an ERP, POS, or accounting system.

It is a TypeScript application built with:

- Node.js.
- Express.js REST API.
- Next.js frontend.
- Better Auth for authentication.
- PostgreSQL as the primary database.
- Prisma for ORM and migrations.
- Tailwind CSS and shadcn/ui for UI.
- React Hook Form and Zod for forms.
- Axios for external HTTP integrations.
- pnpm through Corepack as the only package manager.

## Read Before Working

- Product overview: `docs/product/overview.md`
- Capabilities and change sequence: `docs/product/capabilities.md`
- Domain model and business rules: `docs/product/domain-model.md`
- Open questions; check before proposing a change: `docs/product/open-questions.md`
- Source material, never edited: `docs/product/project-requirements.md` (ERS) and `docs/product/project-sri-integration.md` (CTX)
- Fiscal emission and SRI integration, required for any fiscal change: `docs/architecture/fiscal-emission.md`
- Architecture map: `ARCHITECTURE.md`
- Architecture details: `docs/architecture/index.md`
- Stack baseline: `docs/architecture/stack.md`
- Authentication: `docs/architecture/authentication.md`
- Frontend architecture: `docs/architecture/frontend.md`
- Cognitive architecture: `docs/architecture/cognitive-architecture.md`
- Design foundations: `docs/architecture/design-foundations.md`
- Component selection: `docs/architecture/component-selection.md`
- Interface design: `docs/architecture/interface-design.md`
- Current behavior: `openspec/specs/`
- Changes in progress: `openspec/changes/`
- Change lifecycle: `docs/quality/change-lifecycle.md`
- Definition of done: `docs/quality/definition-of-done.md`
- Version control: `docs/quality/version-control.md`
- Frontend review checklist: `docs/quality/frontend-checklist.md`
- Security principles: `docs/security/principles.md`
- Access control: `docs/security/access-control.md`
- Idempotency and concurrency: `docs/architecture/idempotency.md`
- Security hardening: `docs/security/hardening.md`
- Performance: `docs/quality/performance.md`

## Workflow

1. Read this file and the nearest `AGENTS.md` for the files you will touch.
2. Open only the relevant docs for the current task.
3. For non-trivial behavior changes, work through an OpenSpec change: explore, propose, review, apply, verify, and archive. See `docs/quality/change-lifecycle.md`.
4. Implement the smallest coherent change.
5. Update documentation when behavior, architecture, API, data, or decisions change.
6. Run the project's verification commands before calling work complete.
7. Commit each coherent unit separately, with a short descriptive message.

## Required Verification

Use pnpm through Corepack. These are the project's actual scripts; `verify` also runs `check:versions`, `openapi:check` and `check:dev-start`, and needs PostgreSQL running (`docker compose up -d --wait`):

- Install: `corepack pnpm install`
- Format: `corepack pnpm format`
- Lint: `corepack pnpm lint`
- Test: `corepack pnpm test`
- Typecheck: `corepack pnpm typecheck`
- Build: `corepack pnpm build`
- Full validation: `corepack pnpm verify`

## Constraints

- Do not put product or architecture knowledge in `.codex/`.
- Always use pnpm through Corepack; never use npm or yarn in this repository.
- Use Better Auth for authentication; do not hand-roll password hashing, login flows, or session storage.
- Use PostgreSQL as the primary production database.
- Use Prisma migrations for database schema changes.
- Use environment variables for configuration and validate them at startup.
- Keep provider tokens and secrets server-side.
- Do not introduce production dependencies without documenting why.
- Do not modify generated files manually, including the OpenSpec skills, commands, and prompts; regenerate them with `openspec update`.
- Describe current behavior only in `openspec/specs/`, and change it only through an OpenSpec change.
- Do not bypass validation at HTTP, environment, auth, database, or external-service boundaries.
- Enforce authorization server-side for each record; a frontend permission gate is presentation only.
- Derive identity, tenant, and role from the session; never trust user IDs, tenant IDs, or roles sent by the client.
- Scope every query on private data by tenant and ownership; knowing an identifier is not authorization.
- Make mutations whose repetition would duplicate an effect idempotent, and enforce critical invariants with database constraints.
- Measure before optimizing, and revert any optimization that does not beat its baseline.
- Do not mark work complete while verification is failing.
- Keep secrets out of committed files.
- Commit one coherent unit at a time; never batch a whole working session into one commit.
- Write commit subjects as `type(scope): imperative subject` under 72 characters, and keep bodies to three short lines at most.
- Commit and push only when asked, and never rewrite published history without an explicit request.
- Answer the screen brief before implementing an interface: user, goal, primary decision, minimum information, and single primary action.
- Do not design a screen from the database schema, and do not display a value only because the backend returns it.
- Keep one primary action per screen, and take spacing, type, color, radius, and motion values from the documented scales.
- Choose each UI control from the user's intent, not from the data type, and never add a component that does not improve the experience.
- Do not expose internal IDs, provider names, storage paths, auth implementation details, or other technical references in product UI when a business-facing label or automatic backend value is possible.
- Reuse the documented table, form, dialog, feedback, navigation, and responsive patterns instead of inventing a different interaction model per module.
- Optimize operational screens for scanning and repeated work. Remove redundant summaries, duplicated headings, explanatory boxes, and nested cards that do not help the user decide or act.
- Separate a module's areas as sidebar submodules, not as tabs inside one page.
- Route every mutation through the shared feedback helper; no action ends without pending, success, or error feedback.
- Confirm irreversible actions by typing the record name, and keep reversible ones to a single step.

## Definition Of Done

Implementation, verification, documentation, and the OpenSpec specs must agree.
