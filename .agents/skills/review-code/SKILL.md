---
name: review-code
description: Use when reviewing changes for bugs, security risks, architecture drift, missing tests, and documentation gaps.
---

# Review Code

## Context To Load

Read:

- `AGENTS.md`
- `docs/quality/code-review.md`
- `docs/security/hardening.md`
- `docs/security/access-control.md`
- `docs/architecture/idempotency.md`
- `docs/quality/performance.md`
- Relevant architecture docs.
- The OpenSpec change under review: its proposal, specs, design, and tasks.
- `docs/architecture/stack.md`

## Review Stance

Lead with findings. Prioritize:

1. Bugs and data loss.
2. Security and auth issues.
3. Behavioral regressions.
4. Missing tests or verification.
5. Architecture drift.

Stack-specific checks:

- Auth uses Better Auth instead of custom password/session logic.
- Identity, tenant, and role come from the session, and private queries are scoped by tenant and ownership.
- Critical mutations are idempotent, webhooks are deduplicated, and money or inventory changes are transactional.
- Database changes use Prisma migrations and PostgreSQL-compatible assumptions.
- Package manager usage stays on pnpm/Corepack.
- External HTTP calls are server-side, typed, and use Axios when tokens are involved.
- Frontend forms use React Hook Form and Zod.

## Output Format

- Findings first, ordered by severity.
- Label each finding Critical, Required, Consider, Nit, or FYI, so the author knows what blocks merge.
- Name the structural remedy when the finding is structural; do not report complexity without a move.
- Include file and line references.
- Add open questions after findings.
- Keep summaries secondary.

If no issues are found, say so clearly and mention residual risk.
