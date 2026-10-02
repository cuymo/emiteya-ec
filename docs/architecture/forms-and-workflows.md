# Forms And Workflow Surfaces

## Select The Right Container

| Situation                                                | Container       |
| -------------------------------------------------------- | --------------- |
| Short create/edit form with independent fields           | Modal           |
| Quick confirmation or one decision                       | Alert dialog    |
| Contextual detail that benefits from list continuity     | Modal or drawer |
| Long form with several sections, calculations, or review | Full page       |
| High-risk operation with draft/validate/submit lifecycle | Full page       |
| Simple reversible value change                           | Inline control  |

Do not force every action into a modal. Do not embed every create/edit form permanently
inside a list module.

For records that live in a table, the modal is the default container for create and edit.
Move to a full page only when the dialog would genuinely fail the task, such as when:

- the record contains child collections the user manages while editing it;
- the screen is not a row of any table, such as a profile or an application-wide setting;
- the workflow needs draft, validation, and submission as separate stages.

An exception is a decision to declare in the design of the OpenSpec change, not a preference
to exercise silently.

## Form Construction

Ask for what the task needs, not for what the model stores. A property existing on the
entity is not a reason to render a field: derive it, default it, or leave it to the screen
that owns it. Every question the form asks is work the user has to do, and every optional
field is a decision they have to make about whether to answer it.

A form is not a vertical stack of generic inputs. Before building one, ask:

- Can a field use a control that fits the intent better? See `component-selection.md`.
- Can related fields be grouped, and unnecessary ones removed?
- Can a default or an inferred value save the user effort?
- Can advanced options stay hidden until they are needed?
- Can a selection be shown visually, or its result previewed?

- Use React Hook Form for state and Zod for validation.
- Reuse server-compatible schemas where practical, but translate messages into user language.
- Use persistent labels; placeholders are examples, not labels. `Nombre del proyecto` above `Sitio web de marketing`, never `Escribe algo...` alone.
- Write validation messages that are specific and actionable: `La contrasena debe tener al menos 8 caracteres`, never `Dato invalido`.
- Group fields by the user's mental model, not database tables.
- Keep required/optional behavior explicit.
- Validate format while typing only when it helps; show routine errors after touch or blur to avoid visual noise.
- Preserve entered values after recoverable server errors.
- Disable duplicate submission and expose a stable pending state.
- Focus the first invalid field and summarize only when the form is long.

Positive per-field messages should be reserved for sensitive or error-prone input. A
screen full of `Dato valido` text creates noise without improving confidence.

## Defaults

Use a default when it is safe and predictable, because every prefilled correct value is a
decision the user does not have to make: the most common option, the current date, the
recommended configuration, or a remembered preference.

Never default to an option that is destructive, expensive, irreversible, or that makes data
public. Those choices are made deliberately by the user.

## Multi-Step Processes

Use a stepper or wizard when the process has clearly separate stages, such as `Cuenta`,
`Empresa`, `Facturacion`, and `Confirmacion`, and splitting it reduces what the user must
hold in mind at once.

- Show the current step, the total, and the name of each stage.
- Let the user go back without losing what they entered.
- Validate each step before moving on, and review everything before the final submission.
- Do not split a short form into steps; a three-field form in three screens is friction, not structure.

## Rules The Server Enforces

The backend stays authoritative, but the screen should not let a user assemble a request
the API is known to reject.

- Mirror known constraints as validation, disabled options, or filtered choices.
- Read the constraint from the backend when it is configurable; do not keep a second copy in the screen.
- Explain the blocked state where the user is blocked, not after submission.
- Still handle the rejection when it arrives. A mirrored rule is a convenience, never a guarantee.
- Never present a frontend check as authorization.

## Business-Facing Relationships

Never ask users to type a foreign key, UUID, auth account ID, storage key, or generated
code. Use:

- searchable comboboxes for moderate lists;
- a selection modal with the shared data table for large or filter-heavy lists;
- dependent selects for real hierarchies;
- read-only labels for backend-generated references;
- automatic backend numbering for internal identifiers.

The request may submit an ID, but the control displays the recognizable business label.

Selections across paginated modal tables persist until confirmed or cancelled.

Related records stay reachable. A reference shown in a table or a detail view leads to the
record it names, and a record that cannot be removed because others depend on it says which
relationship blocks it.

## Conditional Fields

- Show fields only when they apply to the selected type or mode.
- Clear hidden values if they are no longer valid.
- Disable dependent controls until their prerequisite is selected.
- Explain the dependency once, near the disabled control.
- Derive defaults from authoritative configuration rather than hardcoding options in the screen.

## Sensitive Inputs And Files

- Passwords and secret values use masked inputs with a show/hide button.
- Edit forms preserve the existing secret when the field is empty.
- APIs return configuration presence, never plaintext or ciphertext.
- File inputs show filename, type, size, validation state, and replacement intent without exposing server paths.
- Validate sensitive files server-side; client extension checks are only early feedback.
- Never display secret references or certificate locations in tables.

### Managed Files

When a record owns uploaded files, the interface covers the whole lifecycle, not only the
first upload:

- accept one or several files wherever the record allows more than one, with visible progress;
- show name, type, size, and validation result per file;
- replace one file without disturbing the rest of the record;
- rename or relabel a file when users will later search for it by name;
- remove a file with confirmation proportional to whether it can be recovered;
- report per-file failures without discarding the files that succeeded;
- keep storage paths, buckets, and provider names out of the interface.

State the accepted types and the size limit before the user picks a file, not only after a
rejection.

## Date, Time, Number, And Option Inputs

- Use shared themed date/date-time components instead of inconsistent browser-native controls when the product design requires uniform behavior.
- Popovers dismiss on outside click and Escape, trap no unintended focus, and commit values predictably.
- Use steppers for bounded integer quantities; reject unsupported decimals.
- Format money and percentages for display while sending canonical numeric values.
- Use one business-facing tax/rate selector instead of exposing separate technical code and percentage fields when one option determines both.
- Load configurable catalogs from the backend; do not duplicate mutable business options in frontend constants.

## Modal Contract

Every modal should have:

- a concise title and optional one-line purpose;
- a visible, medium-size close icon with accessible name;
- focus moved inside on open and restored on close;
- Escape and overlay dismissal unless the operation cannot be safely abandoned;
- a scrollable body with stable header/footer for long forms;
- `Cancelar` and one clear primary action;
- responsive width and height constraints;
- no nested modal unless the workflow has no clearer full-page alternative.

Close the modal after a successful save, reset transient state, refresh the owning list,
and show a semantic toast. Keep it open with values intact after validation or server errors.

## Full-Page Workflow Contract

Use a full page when users must assemble, compare, calculate, review, or submit a complex
record. A good structure is:

1. Compact page/module header and reset/new action.
2. Main form in logical full-width sections.
3. Contextual summary or readiness panel only when it helps prevent mistakes.
4. Sticky or consistently located draft/validate/submit actions.
5. Clear lifecycle state and recovery path.

Do not hide essential context in nested dialogs. Do not consume a permanent right rail
for generic instructions that could be concise helper text.

## Settings And Configuration

Configuration is not one long form. Group it by the user's intention, one destination per
group, for example `General`, `Permisos`, `Notificaciones`, `Integraciones`, `Seguridad`,
and `Avanzado`.

- Keep advanced or irreversible settings in their own group instead of mixing them into everyday ones.
- Apply progressive disclosure inside a group: show the setting, and reveal its details once it is enabled.
- Use a wizard with review and summary when configuration must be assembled in order or validated before it takes effect.
- Show the effect where the setting is made: a preview, the resulting value, or the records it will affect.
- State whether a change applies immediately or on save, and keep that rule consistent across groups.

## Import And Background Work

- Provide a downloadable template when a structured import format is required.
- Parse and validate before execution; report detected rows and actionable issues.
- Run durable imports as backend jobs.
- Show progress and allow the modal to close without cancelling the job.
- Make job state available after navigation or refresh.
- Report partial success with counts and a downloadable error file when useful.

## Edit And Delete Semantics

- Edit forms load current values from the authoritative source.
- Immutable fields appear as labels, not disabled mystery inputs.
- Prefer archive, deactivate, revoke, or soft delete when history and relationships matter.
- Explain consequences before destructive actions.
- Never let frontend cascade assumptions replace backend integrity rules.

## Confirmation Ladder

Match the friction to how hard the action is to undo:

| Action                                                 | Confirmation                                         |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Reversible change such as hide, archive, or deactivate | One step, then undo from the toast                   |
| Irreversible deletion or permanent data loss           | Two steps: intent, then typing the exact record name |
| Irreversible bulk action                               | Two steps plus the number of affected records        |

Rules:

- Name the record and the consequence in the dialog. Never ask only "Are you sure?".
- Keep the confirming action disabled until the typed value matches exactly.
- Ask for the label the user already sees in the list, never an internal identifier.
- Style the confirming action as destructive and never give it initial focus.
- Do not spend a second step on actions the user can undo; reserve the cost for real loss.
- Prefer undo to confirmation. An action that can be undone from the toast needs no dialog before it, and every unnecessary dialog trains users to click through the ones that matter.
- Offer undo only when the backend can actually revert the change.
