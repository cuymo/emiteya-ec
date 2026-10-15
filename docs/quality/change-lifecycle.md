# Change Lifecycle

CognitiveStack governs engineering. OpenSpec governs change.

CognitiveStack defines how agents work: architecture, interface, security, quality, stack,
and specialist skills. OpenSpec defines which concrete change is being made: why, the
expected behavior, the technical design, the tasks, and the record of what shipped.
Neither duplicates the other.

## Sources Of Truth

| Knowledge                                    | Source of truth                             |
| -------------------------------------------- | ------------------------------------------- |
| Why the product exists, its users and goals  | `docs/product/overview.md`                  |
| Domain concepts and business rules           | `docs/product/domain-model.md`              |
| Vocabulary                                   | `docs/product/glossary.md`                  |
| Current observable behavior                  | `openspec/specs/`                           |
| A change in progress                         | `openspec/changes/<change>/`                |
| Changes that shipped                         | `openspec/changes/archive/`                 |
| Architecture and interface rules             | `ARCHITECTURE.md` and `docs/architecture/`  |
| Security                                     | `docs/security/`                            |
| Quality and Definition of Done               | `docs/quality/`                             |
| Architecture decisions                       | `docs/architecture/adr/`                    |
| Known debt                                   | `docs/quality/technical-debt.md`            |
| Agent procedures                             | `.agents/skills/`                           |

Each kind of knowledge lives in one place:

```text
docs/product/        why the product exists
openspec/specs/      what the system does
docs/architecture/   how the system is structured
code                 how it is implemented
```

## When A Change Is Required

Open an OpenSpec change for non-trivial work that alters observable behavior: a new
capability, a changed or removed requirement, a new screen or workflow, or a new API
contract.

Skip it for work that changes no behavior: typo fixes, refactors, dependency upgrades,
formatting, and documentation-only edits. When a non-trivial change has no behavior to
specify, such as a large refactor that still deserves a reviewed plan, open the change and
set `skip_specs: true` in its `.openspec.yaml`.

## Lifecycle

```text
explore -> propose -> review -> apply -> verify -> archive
```

| Phase   | What happens                                                    | CognitiveStack's part                                              |
| ------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Explore | Think through the problem without writing code                  | Load the product docs and the architecture of the affected area    |
| Propose | Create proposal, delta specs, design, and tasks                 | `openspec/config.yaml` requires the screen and sensitive-operation briefs |
| Review  | A person reads the artifacts before any code exists             | Check them against architecture, security, and the Definition of Done |
| Apply   | Implement the tasks in order                                    | Each task loads its specialist skill and only the docs it touches  |
| Verify  | Compare the implementation with the change                      | Definition of Done, checklists, and tests                          |
| Archive | Merge the delta specs into `openspec/specs/` and file the change | Only when implementation, specs, tests, and docs agree             |

Two more workflows support the cycle: **update** revises a change's artifacts when a decision
changes mid-flight, and **sync** merges delta specs into the main specs without archiving.

### Visual review before and after a material visual change

A change that materially alters what the user sees is reviewed in the rendered app, not only in
tests (`productize-invoice-editor-and-composition-foundation`, design D19 and D22):

1. **Before.** At the start of apply, before any runtime code changes:
   - run `REVIEW_LABEL=antes corepack pnpm --filter @facturador/frontend test:visual:review`;
   - open the contact sheets and screenshots in `frontend/.review/visual/antes/` and read the
     geometry;
   - write `review-antes.md` in the change folder, citing screenshot files and measurements;
   - commit that step on its own.
2. **After.** When the visual work ends:
   - run it again with `REVIEW_LABEL=despues REVIEW_COMPARE_WITH=antes`;
   - inspect the comparison sheets;
   - write `review-despues.md`: what changed, what was resolved, and what remains and why.
3. **Assessment.** Both documents cover order of attention, hierarchy, density, alignment,
   balance, action hierarchy, widths, light and dark, and daily use. Screenshots are never
   committed; `frontend/.review/` is ignored.

The command uses only the deterministic harness and never contacts the backend or the SRI. A
browser review on the local deployment first reads `SRI_TRANSMISSION_ENABLED=0` from the running
backend (`docs/quality/testing.md`), and stops if it cannot be established. Generating images
without looking at them, or passing `test:visual`, is not a review.

### Verify evidence for closing a change

- The `verify` workflow on GitHub-hosted runners is the preferred evidence: it is independent of
  the developer's machine.
- Paid GitHub-hosted Actions are not a mandatory project dependency. When hosted execution is
  unavailable by the owner's explicit decision (for example, the owner declines paid Actions), a
  complete `corepack pnpm verify` with exit code 0 in a reproducible, isolated clean-room checkout of
  the exact commit can satisfy the verify gate: a fresh worktree, the frozen lockfile, the pinned
  toolchain, and fresh test resources.
- The evidence names its source truthfully and never presents a local run as remote CI. The
  content of `verify` does not change.
- This is not a general rule that local runs replace remote CI: hosted workflows that do run keep
  counting, and a failure that a workflow actually executes is always investigated
  (`harden-deployment-proxy-and-recovery`, 2026-10-13).

| Workflow | Claude Code      | GitHub Copilot   | Codex                       |
| -------- | ---------------- | ---------------- | --------------------------- |
| Explore  | `/opsx:explore`  | `/opsx-explore`  | `$openspec-explore`         |
| Propose  | `/opsx:propose`  | `/opsx-propose`  | `$openspec-propose`         |
| Update   | `/opsx:update`   | `/opsx-update`   | `$openspec-update-change`   |
| Apply    | `/opsx:apply`    | `/opsx-apply`    | `$openspec-apply-change`    |
| Verify   | `/opsx:verify`   | `/opsx-verify`   | `$openspec-verify-change`   |
| Sync     | `/opsx:sync`     | `/opsx-sync`     | `$openspec-sync-specs`      |
| Archive  | `/opsx:archive`  | `/opsx-archive`  | `$openspec-archive-change`  |

## Workflow Skills And Specialist Skills

| Kind       | Skills                                                                                                   | Controls       |
| ---------- | -------------------------------------------------------------------------------------------------------- | -------------- |
| Workflow   | The `openspec-*` skills generated by OpenSpec                                                            | The process    |
| Specialist | `implement-operational-frontend`, `create-migration`, `harden-security`, `optimize-performance`, `review-code`, `update-documentation`, `commit-changes` | The disciplines |

An OpenSpec task says what to build. The specialist skill says how. A requirement such as
"the user SHALL choose between 1 and 10 seats" becomes, in the change's design, a small bounded
integer adjusted by one, which `../architecture/component-selection.md` maps to a stepper,
which `../architecture/component-system.md` already provides as `IntegerStepperField`. The task then runs
through `implement-operational-frontend` and the frontend checklist.

## Writing Specs

```markdown
## ADDED Requirements

### Requirement: Project archival
The system SHALL let an authorized member archive an active project.

#### Scenario: Archive an active project
- **WHEN** an authorized member archives an active project
- **THEN** the project is marked as archived
- **AND** it no longer appears in the default project list

#### Scenario: Another tenant cannot archive it
- **WHEN** a user from another tenant requests the archival of that project
- **THEN** the system responds as if the project did not exist
- **AND** the project is unchanged
```

- Use exactly `### Requirement:` and `#### Scenario:`. A scenario under three hashes fails validation silently.
- Use SHALL or MUST for normative statements, and give every requirement at least one scenario.
- State one behavior per requirement, and move examples and edge cases into scenarios.
- Describe observable behavior, never tables, columns, or infrastructure.
- Name capabilities after durable behavior, such as `projects` or `billing`, never after the change, such as `add-archive-button`.
- Name changes in kebab-case, starting with a verb: `add-project-archive`.

## Commits

- Commit the reviewed artifacts before implementation starts.
- Commit each task group as its own unit, ordered schema, then API, then interface, as `version-control.md` requires.
- Archive in its own commit.

## Setup And Maintenance

The generated skills call `openspec` directly, so every developer installs the CLI on the
`PATH` with pnpm, at the version pinned in `package.json`:

```bash
corepack pnpm add --global @fission-ai/openspec@1.14.0
```

That global CLI serves only the generated agent workflows and `openspec update`. Project
validation never uses it:

- `corepack pnpm openspec:validate` runs the repository-pinned CLI (`@fission-ai/openspec` 1.14.0,
  a root dev dependency) with `validate --all --strict`, through `scripts/openspec-validate.ts`.
  It resolves the package from the repository, not from the `PATH`, prints the version it runs,
  and disables telemetry (`OPENSPEC_TELEMETRY=0`).
- `corepack pnpm verify` runs it right after `format:check`, so remote CI enforces strict
  validation on every push and pull request. A validation failure fails the build; the command
  never repairs or rewrites OpenSpec files.
- Upgrading OpenSpec is a reviewed dependency change: bump the dev dependency, review the lockfile
  and `security:dependencies`, and regenerate the agent files with `openspec update`.

The `verify` workflow is not in OpenSpec's default `core` profile, and the profile is a
per-machine setting. Every developer enables it once:

```bash
openspec config set profile custom
openspec config set workflows '["propose","explore","apply","update","sync","archive","verify"]'
```

Without it, `openspec update` removes the verify skills from the repository, because they
fall outside that developer's profile.

- The `openspec-*` skills in `.agents/skills/`, `.claude/skills/`, and `.github/skills/`, the commands in `.claude/commands/opsx/`, and the prompts in `.github/prompts/` are generated. Never edit them; run `openspec update` after upgrading the CLI.
- `openspec/config.yaml` is authored. It is injected into every run, so keep it short and point to documents instead of copying them.
- OpenSpec collects anonymous usage statistics. The project validation command disables them; for interactive use, opt out with `openspec config set telemetry.enabled false`, or set `OPENSPEC_TELEMETRY=0`.

## Custom Schema

Start with the built-in `spec-driven` schema. Create a project schema under
`openspec/schemas/` only after several real changes show a missing artifact, such as a
separate interface brief, and record that decision as an ADR.

## Reject The Change When

- non-trivial behavior changed without an OpenSpec change;
- the implementation diverged from the specs and the specs were not updated;
- a change was archived while verification failed or documents disagreed;
- a generated OpenSpec file was edited by hand;
- a requirement describes tables or columns instead of behavior.
