---
name: commit-changes
description: Use when committing work, branching, or opening a pull request. Guides splitting a diff into small reviewable commits with short descriptive messages.
---

# Commit Changes

## Context To Load

Read:

- `docs/quality/version-control.md`
- `docs/quality/definition-of-done.md`
- `AGENTS.md`

## Workflow

1. Read the full diff before staging anything.
2. Group the diff into coherent units: one feature, one fix, or one refactor per unit.
3. Order the units by dependency: schema, then API, then interface.
4. State the planned split when the work covers several units.
5. Stage one unit and confirm the staged diff contains only that unit.
6. Run the project verification commands.
7. Write `type(scope): imperative subject`, under 72 characters, naming what changed.
8. Add a body only when the reason is not obvious, at most three short lines.
9. Repeat for the next unit.
10. Push or open a pull request only when the user asks.

## Guardrails

- Do not batch a whole session into a single commit.
- Do not mix a refactor with a behavior change.
- Do not separate tests or documentation from the behavior they describe.
- Do not stage everything without reading what it picked up.
- Do not list changed files or paste verification output into the message.
- Do not commit secrets, environment files, build output, or dependency directories.
- Do not commit to the default branch when the project reviews through pull requests.
- Do not rewrite published history without an explicit request.
- Do not describe work in a message that a later commit will actually do.
