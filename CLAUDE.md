# Claude Project Memory

This file mirrors the high-level guidance in `AGENTS.md` for Claude-based workflows.

## Required First Reads

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/product/overview.md`
- `docs/quality/definition-of-done.md`
- `docs/quality/change-lifecycle.md`

## Working Rules

- Keep this file short.
- Use `docs/` for detailed project knowledge.
- Use an OpenSpec change under `openspec/changes/` for non-trivial behavior changes; `openspec/specs/` describes current behavior.
- Update docs in the same change that updates behavior.
- Commit each coherent unit separately, with a short descriptive message.
- Do not expose secrets or environment values in summaries.

