---
name: create-migration
description: Use when changing database schema, persistence models, generated schema docs, or data migration behavior.
---

# Create Migration

## Context To Load

Read:

- `docs/architecture/database.md`
- `docs/architecture/stack.md`
- The OpenSpec change's design.
- `docs/security/principles.md`
- Current migration policy for the project.

## Workflow

1. Understand the data model change and affected workflows.
2. Decide whether the migration is additive, destructive, or data-transforming.
3. Add schema changes using the project's migration tool. Give tenant-owned tables a tenant column, indexes that lead with it, and composite foreign keys for tenant-owned children.
4. Express critical invariants as unique and check constraints; add `CHECK` constraints and Row-Level Security policies to the migration SQL.
5. Update repositories and application DTOs.
6. Update generated database documentation.
7. Validate with typecheck/tests/migration verification.

## Guardrails

- Destructive changes require an explicit data plan.
- A tenant-owned table never ships without its tenant column.
- Production credentials should not stay overprivileged after initial setup.
- Generated database clients or schema references must be regenerated, not hand edited.
- PostgreSQL is the production target.
- Prisma migrations are the default schema-change mechanism.
