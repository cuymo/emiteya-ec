# Feedback And Interface States

## Feedback Principle

Every user action receives timely, semantic, human-readable feedback. The message should
say what happened and what the user can do next, without raw exceptions, metadata,
transport errors, or framework terminology.

Timely means the interface reacts within about 100ms, even when the result takes longer.
Every interactive control also carries its own visible states: default, hover,
focus-visible, active, disabled, and loading. See `design-foundations.md` for the state
matrix, durations, and easing.

## Choose The Feedback Surface

| State                                                          | Preferred surface                          |
| -------------------------------------------------------------- | ------------------------------------------ |
| Routine save, update, export start, or completion              | Toast                                      |
| Validation tied to one field                                   | Inline field message                       |
| Collection loading or refresh                                  | Skeleton inside the surface                |
| Empty collection                                               | Empty state inside the surface             |
| Recoverable module load failure                                | Compact inline state with retry            |
| Persistent account, permission, outage, or configuration block | Page-level notice                          |
| Destructive confirmation                                       | Alert dialog                               |
| Durable background job                                         | Progress surface plus toast on transitions |

Do not use persistent success banners for routine actions. Do not use a toast as the only
place to explain how to correct a specific invalid field.

## Toast Contract

Use one global toast component with semantic variants:

- success;
- error;
- warning;
- information;
- loading/promise.

Requirements:

- theme-aware opaque background and readable contrast;
- centered icon and close button;
- enough viewport margin that borders and controls are not clipped;
- no decorative accent strip unless it is part of the global design system;
- responsive width with wrapping text;
- concise title and optional one-sentence detail;
- optional retry/action when safe;
- an undo action for reversible changes, with enough time to use it and no dismissal while it has focus;
- deduplication for repeated identical events.

Map known backend error codes to business messages. Unknown errors receive a safe generic
message and a correlation reference only when support can use it.

## Bind Feedback To The Mutation

Route every create, update, delete, upload, and state change through one shared mutation
helper that owns feedback. Whether the user hears back should not depend on each module
remembering to add it.

The shared helper owns:

- the pending state of the initiating control and duplicate-submit prevention;
- the idempotency key for mutations the API declares idempotent: one key per user intent, reused on retry, renewed when the payload changes;
- the success toast and the data invalidation that follows it;
- the mapping from known backend error codes to business messages;
- the safe fallback message for unknown failures;
- deduplication of repeated identical results.

The caller supplies the request and the human-readable messages only.

No asynchronous path may end without a resolved outcome. Every request has a handled
failure branch that leaves the interface usable and the user informed. A mutation with no
feedback path is an incomplete implementation, not a minor omission.

## Loading

Acknowledge the interaction immediately, then show the shape of the wait: a skeleton when
content will replace the surface, a pending state in the control when the surface stays,
real progress when it can be measured.

- Keep geometry stable.
- Use skeletons for page sections and tables.
- Use a shared spinner for compact indeterminate actions.
- Disable the initiating control while a non-idempotent request is pending.
- Avoid blocking the entire page for a local refresh.
- Ignore or cancel stale requests after filters or scope change.
- For slow operations, transition from spinner to meaningful progress or status.

## Success

- Confirm the completed business action, not the HTTP operation.
- Refresh or optimistically update the affected data.
- Close the completed dialog and restore focus appropriately.
- Do not leave a success alert occupying the page.
- Do not toast passive initial data loading as a success.

## Errors

An error answers three questions: what failed, what was preserved, and what the user can do
next.

```text
No pudimos guardar los cambios.
Tus datos siguen en el formulario.
[Intentar nuevamente]
```

- Preserve form input after recoverable failures.
- Distinguish validation, permission, conflict, unavailable service, and unexpected errors.
- Show field errors beside fields and operation errors at the operation surface.
- Keep retry safe through idempotency or backend lifecycle rules. A disabled button reduces duplicates; only the server prevents them. See `idempotency.md`.
- Never render stack traces, SQL errors, raw provider payloads, storage paths, or secret values.
- Log diagnostic detail server-side with correlation context.

## Optimistic Updates

Update the interface before the server answers only when the action is reversible and
almost always succeeds: toggling a flag, reordering a list, marking as read.

- Keep the previous state so a failure restores it exactly.
- On failure, revert and explain. Never leave an optimistic value on screen.
- Do not apply optimistic updates to payments, approvals, deletions, or anything whose reversal is not trivial.
- An optimistic update is still a mutation: it goes through the shared feedback helper and invalidates the data it changed.

## Empty And Partial States

An empty state answers three questions: what this means, why it is empty, and what the user
can do now. `No hay datos.` answers none of them.

```text
Todavia no has creado proyectos.
Crea el primero para empezar a organizar el trabajo del equipo.
[Crear proyecto]
```

An empty state should distinguish:

- no records exist yet;
- current filters have no matches;
- data is unavailable because of permissions;
- a prerequisite configuration is missing.

Offer only actions the user can perform. Partial screens should render available data and
identify the missing section without blanking unrelated content.

## Validation Timing

- Validate simple format after touch/blur.
- Validate cross-field and server-owned rules on submit or explicit validation.
- Avoid red errors before the user interacts.
- Avoid green success text under every valid field.
- Use clear constraints in labels or concise helper text before an error occurs.
- Announce validation errors to assistive technology.

## Tooltips

- Use tooltips for icon-only actions and unfamiliar compact controls.
- Tooltips must be opaque, above surrounding content, theme-aware, and readable.
- Tooltip text names the action; it does not repeat a visible label.
- Disabled controls still need an accessible explanation when the reason is not obvious.
- Tooltips do not replace labels for form fields or primary navigation.

## Background Jobs

Long-running work belongs to a persisted job model when it must survive closing a modal,
navigation, refresh, or server restart. The UI should expose queued, running, partial,
completed, failed, and cancelled states, with progress when measurable.

Closing a progress dialog must not silently cancel a durable job. Cancellation requires
an explicit action and backend support.
