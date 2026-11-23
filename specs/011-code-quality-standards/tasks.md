# Tasks: Enforced Code Quality Standards

**Input**: Design documents from `/specs/011-code-quality-standards/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Organization**: Tasks are grouped by user story. Validation tasks use the command contract and acceptance scenarios rather than introducing a runtime test subsystem.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it targets different files and has no incomplete dependency
- **[Story]**: User story traceability label
- Every task names its concrete repository paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install the exact quality-tool dependencies under the pinned runtime.

- [x] T001 Activate NVM Node 24.20.0 and add exact formatter/linter dependencies to `package.json` and `pnpm-lock.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared scope and safety constraints before any bulk rewrite.

- [x] T002 Create generated/evidence/contract exclusions in `.prettierignore` and verify the maintained file scope against `.gitignore`
- [x] T003 Record the explicit repository layout policy in `prettier.config.mjs`
- [x] T004 Verify the existing `@typescript-eslint/*` explicit rules and test/tool overrides in `eslint.config.mjs` are preserved as the change baseline

**Checkpoint**: Exact dependencies, formatting scope, and the protected TypeScript lint boundary are established.

---

## Phase 3: User Story 1 - Consistently Readable Source (Priority: P1) 🎯 MVP

**Goal**: Contributors can deterministically format maintained code into a readable 100-column-preference layout.

**Independent Test**: Format representative TS, TSX, and MTS files, run the formatter twice, and confirm the second pass is unchanged while excluded artifacts remain untouched.

- [x] T005 [US1] Add `format` and `format:check` command implementations to `package.json`
- [x] T006 [US1] Run the formatter across maintained files in `apps/`, `packages/`, `tools/`, `tests/`, and root/project configuration files
- [x] T007 [US1] Run Prettier debug-check, a second formatting pass, formatting check, and `git diff --check` against the cleaned repository

**Checkpoint**: The repository formatting command is deterministic, idempotent, and independently usable.

---

## Phase 4: User Story 2 - Immediate Quality Feedback (Priority: P2)

**Goal**: Contributors receive strict zero-warning feedback for core correctness, imports, React hooks, and JSX accessibility without tightening TypeScript-specific policy.

**Independent Test**: Run lint on the cleaned repository and demonstrate that representative import, hook, and accessibility violations fail with actionable diagnostics.

- [x] T008 [US2] Add the core JavaScript recommended preset, strict core rules, import plugins, linter options, and final Prettier compatibility layer to `eslint.config.mjs` while preserving all existing TypeScript-specific settings
- [x] T009 [US2] Add stable React Hooks recommended and JSX a11y recommended rules scoped to `**/*.tsx` in `eslint.config.mjs`
- [x] T010 [US2] Add zero-warning `lint` and safe `lint:fix` command contracts to `package.json`
- [x] T011 [US2] Apply safe import/core lint fixes across `apps/`, `packages/`, `tools/`, and `tests/`, then run the formatter again
- [x] T012 [US2] Resolve remaining core and import lint diagnostics without semantic changes in affected maintained source files
- [x] T013 [US2] Resolve remaining React Hooks diagnostics without changing user-visible behavior in `apps/web/**/*.tsx` and package UI TSX files
- [x] T014 [US2] Resolve remaining JSX accessibility diagnostics with semantic, keyboard, label, and ARIA-safe markup in `apps/web/**/*.tsx` and package UI TSX files
- [x] T015 [US2] Verify zero-warning lint and inspect effective configurations for representative production TS, TSX, test spec, and tool MTS files to confirm TypeScript policy is unchanged

**Checkpoint**: Strict non-TypeScript lint passes independently with zero errors and warnings.

---

## Phase 5: User Story 3 - Repository-Wide Enforcement (Priority: P3)

**Goal**: The authoritative repository gate rejects formatting or lint regressions without mutating contributor files.

**Independent Test**: Run the project gate on clean source, then demonstrate locally that an unformatted or lint-violating fixture causes the appropriate check command to fail.

- [x] T016 [US3] Add `format:check` before lint in `tools/ci/project.mts`
- [x] T017 [US3] Route the Feature 001 aggregate check through strict formatting and root lint commands in `tools/feature-001/project.json`
- [x] T018 [P] [US3] Document contributor formatting, fix, and verification workflows in `README.md`
- [x] T019 [US3] Validate that `format:check` and `lint` are non-mutating and that the project gate reports formatting failure before later quality stages

**Checkpoint**: Local and CI-facing paths enforce the same formatting and lint contract.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Prove compatibility and record completion evidence.

- [x] T020 Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:010`, and `pnpm verify:010` under NVM Node 24.20.0
- [x] T021 Run `pnpm ci:project` and `pnpm install --frozen-lockfile`, documenting any environment-only limitation without weakening checks
- [x] T022 Update completion checkboxes and validation evidence in `specs/011-code-quality-standards/tasks.md`, and set `specs/011-code-quality-standards/spec.md` status to complete when all acceptance criteria pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup**: starts immediately.
- **Foundational**: depends on exact dependency installation.
- **US1**: depends on formatting configuration and scope.
- **US2**: depends on dependencies and benefits from US1 formatting, but its lint contract can be checked independently.
- **US3**: depends on stable `format:check` and `lint` commands from US1/US2.
- **Polish**: depends on all three user stories.

### User Story Dependencies

- **US1 (P1)**: no dependency on another story; this is the suggested MVP.
- **US2 (P2)**: logically independent, but applying it after US1 produces a reviewable lint diff.
- **US3 (P3)**: integrates the completed US1/US2 commands into the authoritative gate.

### Within Each User Story

- Configure before writing source.
- Apply safe automatic fixes before manual corrections.
- Run Prettier after lint autofix changes import layout.
- Run non-mutating checks only after write commands are complete.
- Preserve every existing explicit `@typescript-eslint` setting throughout review.

### Parallel Opportunities

- T018 can proceed while T016–T017 update gate wiring.
- React Hooks corrections (T013) and JSX accessibility corrections (T014) affect the same TSX files and therefore should remain sequential for this implementation.
- Repository-wide automatic rewrites remain sequential to avoid conflicting edits.

---

## Parallel Example: User Story 3

```text
Task: "Add format:check before lint in tools/ci/project.mts"
Task: "Document contributor quality commands in README.md"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Pin dependencies and exclusions.
2. Define the formatting policy and commands.
3. Format maintained code.
4. Prove debug safety and idempotence before enabling stricter lint.

### Incremental Delivery

1. Deliver deterministic formatting.
2. Add and clean strict non-TypeScript lint families.
3. Wire non-mutating checks into the authoritative gate.
4. Run full compatibility and frozen-install verification.

## Notes

- The working tree was clean except for this feature specification when implementation began.
- Generated OpenAPI/schema outputs, reports, historical specs, and lockfile formatting remain generator/package-manager owned.
- Exact lint package versions are recorded in `research.md` and `plan.md`.
- No task may tighten an existing TypeScript-specific rule as part of this feature.
- Pre-change effective `@typescript-eslint/*` hashes: production TS/TSX `0ff465a0998bc95f835fec4267101e1decd75cb166f9b01609e44cff45e7f99e`; test/tool override `b066255e9d92d20230a6090aeca44278ec2cd22885a86303d523c98886710795`.
- NVM Node `24.20.0` is installed, active, and configured as the default; validation used pnpm `11.21.0`.
- Prettier `--debug-check`, repository `format:check`, and a repeated write pass succeeded; the two write-pass tree hashes were identical (`ef6f9ad8d367a0bdd0fbe520c34f41cfaf4ad3b94bd2dcb54eb2963a8c4d0f6f`).
- Effective `@typescript-eslint/*` configuration remained semantically identical for representative production TS/TSX and test/tool files. Equality hashes: production `1b516d21865d3d366c8005a62f3b03bae227746b91fb9e80281514b96a01f0cd`; test/tool `dc17eda6c779ce841a4e52df75d026f940be4d03bf41bd749a37602e56a7ffc3`.
- `pnpm lint` passed with zero warnings; `pnpm typecheck` passed for the root and all 23 Nx projects.
- Feature compatibility passed: `pnpm test:010` ran 11/11 tests and `pnpm verify:010` returned PASS.
- The final `pnpm ci:project` report is PASS with unchanged source and 2167/2167 tests passed, with zero failures, skips, or todos.
- `pnpm install --frozen-lockfile` passed against the pinned lockfile. Docker-backed validation required the expected host Docker access; no check was disabled or weakened.
- In this managed shell, `pnpm_config_verify_deps_before_run=false` prevented an environment-specific redundant auto-install before scripts; the independent frozen install itself passed.
