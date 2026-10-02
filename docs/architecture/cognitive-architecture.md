# Cognitive Architecture

The quality of an interface is not the amount of information, controls, cards, charts, or
features it can display. It is how much complexity the system absorbs without transferring
that complexity to the person using it.

This document governs what a screen must resolve before any component file is opened.
`interface-design.md` then chooses surfaces and layout, `design-foundations.md` supplies the
scales, and `../quality/frontend-checklist.md` audits the result.

## Absolute Constraints

### Never design from the database schema

A table is not a screen, a column is not a field, and an entity is not a module. The chain
`database -> entities -> fields -> forms -> screens` produces an interface that only makes
sense to whoever wrote the migration.

Design in this direction instead:

```text
user -> context -> goal -> decision -> required information -> action -> feedback -> next step
```

Neither an existing API nor an existing model dictates the information architecture of a
screen.

### Never show information only because the backend returns it

The existence of a value does not justify its presence in the initial view. An endpoint
that returns thirty fields is not a specification for thirty visible fields, and a feature
that exists is not a feature that must be permanently on screen.

### Never optimize for showing features. Optimize for removing decisions

The goal is not a user who says the product does a lot. It is a user who says they know
exactly what to do next. Every control, column, badge, and sentence spends attention the
primary task needs.

## The Screen Brief

Before implementing or redesigning a screen, answer five questions in writing, in the design
of its OpenSpec change:

1. Who uses this screen?
2. What are they trying to accomplish here?
3. What is the primary decision they make?
4. What is the minimum information required for that decision?
5. What is the single primary action?

An unanswered question blocks implementation; it is not a detail to settle while coding.
Ask, or record the assumption explicitly so a reviewer can correct it. Never close the gap
with more cards, more columns, or more explanatory copy.

Answer these as well when the screen is new, used daily, or carries real risk:

| Question                                            | What it changes                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| How often is it used?                               | Daily work earns density, shortcuts, and saved views. Occasional work earns guidance.  |
| How experienced is the user?                        | Sets how much the screen must teach and how much it can assume.                        |
| Is the task exploratory, routine, urgent, or critical? | Sets pacing, confirmation, and how much context must stay on screen.                 |
| Which device is primary?                            | Decides which layout is designed first, not which one gets shrunk.                     |
| What happens if the user gets it wrong?             | Sets the confirmation ladder and the recovery path.                                    |
| What does the user expect right after acting?       | Defines the success state and the next step.                                           |

## Describe The Job, Not The Entity

A screen represents a user's job, not a database relation.

| Entity framing              | Job framing                                                                 |
| --------------------------- | --------------------------------------------------------------------------- |
| "The invoice entity page."  | "Review an invoice, find the problem, and decide whether to approve it."     |
| "The users table."          | "Find a person, understand their access, and adjust it."                     |
| "The analytics page."       | "See what changed and decide what to do about it."                           |

The framing decides the layout. The first column, the default filter, the primary action,
and everything the screen leaves out all follow from the job.

## The Screen Contract

Every screen answers these without the user having to inspect the whole page:

1. Where am I?
2. What am I looking at?
3. What matters here?
4. Is anything waiting for me?
5. What can I do?
6. What is the main action?
7. What happens after I act?

### The Two-Second Rule

Basic orientation should land in about two seconds. The first viewport carries context,
title, state, the leading information, and the primary action. If a user must read five
cards, a table, and three paragraphs to learn where they are, the hierarchy failed.

## Information Tiers

Classify information before placing it.

| Tier | Role          | Typical content                                                                    | Placement                                          |
| ---- | ------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| P0   | Orientation   | Current object, state, critical alert, headline result, primary action             | Visible on arrival                                 |
| P1   | Decision      | Owner, dates, key metrics, comparison, recent activity, blocking reason            | Visible in the working surface                     |
| P2   | Secondary     | Full attributes, related collections, notes, history summary                       | One deliberate interaction away                    |
| P3   | Investigation | Internal identifiers, payloads, logs, audit trail, versions, advanced configuration | Behind an explicit, usually permission-gated view  |

Rules:

- An initial view assembled from P3 content is a defect, not a power-user feature.
- Tier belongs to the task, not to the field. The same timestamp is P1 on an incident screen and P3 on a catalog screen.
- P0 and P2 must not carry the same visual weight. `design-foundations.md` supplies the scales that express the difference.
- Record the tiering in the change's design when the screen is non-trivial.

## Progressive Disclosure

Show what the task needs now and reveal the rest on demand.

Wrong:

```text
Buscar  Estado  Responsable  Categoria  Fecha  Origen  Pais  Idioma  Prioridad  Segmento  Tipo  Canal  Etiquetas
```

Right:

```text
Buscar  Estado  Responsable  [Mas filtros]
```

- Hide controls that do not apply to the current state instead of disabling a wall of them.
- Group secondary functions where the user would look for them, not where they were built.
- Disclosure is not concealment. An active hidden filter still shows as a removable label, and a blocked state still explains itself where the user is blocked.

## Action Budget

Decision time grows with the number of simultaneous options, so every surface has a budget.

| Surface   | Primary                            | Visible secondary                       | Everything else                            |
| --------- | ---------------------------------- | --------------------------------------- | ------------------------------------------ |
| Screen    | Exactly one                        | One or two                              | Overflow menu, detail surface, or sheet    |
| Table row | Opening the record from the row    | Up to three frequent, row-valid actions | `...` overflow menu                        |
| Dialog    | One confirming action              | `Cancelar`                              | Nothing                                    |

Do not render `Editar`, `Duplicar`, `Exportar`, `Eliminar`, `Asignar`, `Mover`, `Archivar`,
and `Compartir` side by side because all eight exist.

### One Focal Action

Each screen has one dominant action, with the strongest visual weight, a consistent
position, and specific copy. Name the action and its object: `Crear proyecto`,
`Aprobar solicitud`, `Generar reporte`. `Aceptar`, `Procesar`, `Ejecutar`, and `Continuar`
are acceptable only when the real action has no better name.

Two buttons of equal weight are two primary actions, which means the screen has none.

## Recognition Over Recall

The user should not have to carry state in their head between screens.

- Returning from a detail surface restores filters, sorting, page, scroll position, and selection.
- Confirmations name the record: `Eliminar Proyecto Marketing Q4`, never `Confirmar accion`.
- A record that names another record links to it.
- Show what comes next when the domain has a next step: `Pendiente de aprobacion`, `Proxima revision: manana`.
- Carry the originating context into the surface that opens from it.

## Beginner Clarity, Expert Speed

Design the default path for someone seeing the screen for the first time, then add
accelerators that do not tax that path: keyboard shortcuts, saved views, bulk actions, a
command palette, and a denser display mode.

Frequency and risk set the friction:

| Pattern              | Design                                                               |
| -------------------- | -------------------------------------------------------------------- |
| Frequent, low risk   | Fewest possible steps, immediate feedback, reversible                |
| Frequent, high risk  | Fast path plus an unmistakable confirmation and a recovery path      |
| Rare, low risk       | Guidance and explanation over speed                                  |
| Rare, high risk      | Full context, explicit consequences, proportional confirmation       |

## Reporting Format

Before implementing a new screen or a redesign, report in this order:

1. **Diagnosis**: user job, current frictions, cognitive load, hierarchy problems, redundant information, inconsistencies, responsive and accessibility gaps.
2. **Solution architecture**: primary decision, primary action, P0-P3 tiering, progressive disclosure plan, surface and layout choice, navigation placement, components.
3. **Technical implementation**: shared components reused, new components and why, tokens, states, responsive behavior, accessibility, motion, performance.
4. **Verification**: commands run, keyboard pass, mobile pass, reduced motion, edge cases, and every acceptance criterion reported as met or as a declared exception.

Keep it short. Four honest paragraphs beat a document nobody reads.
