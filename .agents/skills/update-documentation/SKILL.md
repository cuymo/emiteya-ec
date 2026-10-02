---
name: update-documentation
description: Use when behavior, API routes, architecture decisions, database schema, quality rules, or security constraints change.
---

# Update Documentation

## Context To Load

Read the document closest to the changed behavior:

- Product: `docs/product/`
- Architecture: `docs/architecture/`
- Current behavior: `openspec/specs/`, updated only by archiving or syncing an OpenSpec change, never edited directly
- Quality: `docs/quality/`
- Security: `docs/security/`
- Generated references: `docs/generated/`

## Workflow

1. Identify what changed.
2. Update the source-of-truth document.
3. Update generated or derived references if contracts changed.
4. Record decisions when tradeoffs were made.
5. Keep docs concise and navigable.

## Guardrails

- Do not bury important rules in long prose.
- Prefer checklists and tables where agents need to scan.
- Do not duplicate large specs; link to the source of truth.

