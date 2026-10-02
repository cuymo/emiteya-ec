# Version Control

## Commit Scope

One commit is one coherent change: something a reviewer can read on its own, and something
that can be reverted without dragging unrelated work with it.

| Work                                 | Commits                  |
| ------------------------------------ | ------------------------ |
| One feature inside one layer         | 1                        |
| Feature crossing schema, API, and UI | 2-4, in dependency order |
| Bug fix and its regression test      | 1                        |
| Refactor plus a behavior change      | 2, refactor first        |
| A whole working session              | Never 1                  |

Rules:

- Commit when a unit is finished and verified, not when the session ends.
- Keep tests and documentation in the same commit as the behavior they describe.
- Keep refactors, renames, formatting, and dependency bumps in separate commits from behavior changes.
- Do not split one coherent change into a chain of trivial commits.
- Every commit leaves the repository working, with verification passing at that commit.

If describing the diff needs the word "and", it is probably two commits.

## Commit Messages

```text
<type>(<scope>): <subject>

<optional body>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
Scope is the module or area touched, and is optional.

Subject:

- imperative mood: `add`, `fix`, `rename`, never `added` or `adding`;
- under 72 characters;
- lowercase after the colon, no trailing period;
- names what changed, not which files were touched;
- one language across the whole repository, matching the existing history.

Body:

- optional; include it only when the reason is not obvious from the subject;
- at most three short lines;
- explains why, or a consequence a reviewer would otherwise miss;
- never lists changed files, because git already records them;
- never pastes verification output or a checklist, because verification is a gate before
  committing, not commit content.

| Instead of                                       | Write                                          |
| ------------------------------------------------ | ---------------------------------------------- |
| `updates`, `changes`, `WIP`, `final`             | `fix(auth): reject expired session cookies`    |
| `feat: add users module, dialogs and validation` | `feat(users): add user list and create dialog` |
| `docs: update`                                   | `docs(tables): document pagination contract`   |

## Before Every Commit

1. Read the full diff before staging anything.
2. Stage intentionally; never stage everything without reading what it picked up.
3. Confirm the staged diff contains one unit and nothing else.
4. Run the project verification commands.
5. Confirm no secrets, environment files, credentials, tokens, build output, or dependency
   directories are staged.

## Branches And Pull Requests

- Do not commit to the default branch when the project reviews through pull requests. Branch first.
- Name branches by intent: `feat/`, `fix/`, `docs/`, `refactor/`.
- Keep a pull request small enough to review in one sitting.
- The pull request states what changed, why, and how it was verified. It does not repeat the file list.
- Update from the default branch before requesting review.
- Do not force-push a branch that someone is already reviewing.

## Repository Hygiene

- Every application repository has a `.gitignore` covering environment files, dependency
  directories, build output, and local tooling artifacts.
- Lockfiles are committed.
- Generated files are committed only when the project documents them as tracked.
- Secrets never enter history. A committed secret is rotated, not just deleted in a later commit.

## Agent Rules

- Propose the commit split before making it when the work covers several units.
- Commit only when the user asks, and push only when the user asks.
- Never rewrite published history without an explicit request.
- Report honestly what a commit contains; do not describe work that a later commit will do.
