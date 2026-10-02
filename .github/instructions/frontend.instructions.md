# Frontend Instructions

Apply to frontend files.

- Build actual product screens, not marketing placeholders.
- Answer the screen brief before implementing: user, goal, primary decision, minimum information, single primary action.
- Design from the user's job, never from the database schema, and never show a value only because the backend returns it.
- Keep one primary action per screen and take visual values from the documented spacing, type, color, and motion scales.
- Prefer existing design-system components.
- Choose each control from the user's intent, not from the data type, and never swap an accessible native control for a less accessible custom one.
- Keep forms validated and accessible.
- Avoid loading excessive data into the DOM; use pagination or virtualization for large collections.
- Read `docs/architecture/frontend.md` and the interface-pattern document relevant to the screen before editing.
- Reuse shared data-table, form, dialog, toast, date, tooltip, pagination, and navigation primitives.
- Keep internal identifiers and implementation details out of user-facing labels and inputs.
- Prefer table-first module screens and focused workflows over decorative cards, duplicated summaries, and persistent success banners.
- Use sidebar submodules instead of tabs to separate the pages of a module.
- Route every mutation through the shared feedback helper so no action ends without pending, success, or error feedback.
- Require typed confirmation for irreversible actions and a single step for reversible ones.
- Write copy that addresses the user directly, without third-person narration or internal process detail.
- Verify light/dark themes and desktop/mobile layouts before completion.
- Update frontend documentation when user-visible workflows change.
