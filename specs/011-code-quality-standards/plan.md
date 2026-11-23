# Implementation Plan: Enforced Code Quality Standards

**Branch**: `011-code-quality-standards` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-code-quality-standards/spec.md`

## Summary

Introduce deterministic repository formatting with a 100-column preference, add a strict non-TypeScript ESLint layer for core JavaScript correctness, import hygiene, React hooks, and JSX accessibility, then mechanically clean maintained code. Preserve every current `@typescript-eslint` rule, option, severity, and override. Exclude generated, evidence, byte-sensitive contract, and historical specification content from the bulk rewrite, and enforce the new policy through root commands and the authoritative project gate.

## Technical Context

**Language/Version**: Node.js 24.20.0, TypeScript 6.0.3, ECMAScript modules

**Primary Dependencies**: Prettier 3.9.6; ESLint 9.39.5; `@eslint/js` 9.39.5; existing `typescript-eslint` 8.68.0 and Nx 23.1.2 unchanged; `eslint-plugin-import` 2.32.0; `eslint-plugin-simple-import-sort` 14.0.0; `eslint-plugin-react-hooks` 7.1.1; `eslint-plugin-jsx-a11y` 6.10.2; existing `eslint-config-prettier` 10.1.8

**Storage**: N/A; repository configuration and source files only

**Testing**: Prettier debug/check/idempotence, ESLint zero-warning verification, existing Vitest suites, TypeScript project checks, build and project regression gate

**Target Platform**: Local macOS/Linux development and Linux CI with the repository-pinned Node/pnpm toolchain

**Project Type**: Nx/pnpm TypeScript monorepo containing Nest applications, React applications, libraries, tools, and tests

**Performance Goals**: Formatting and lint feedback remains practical for repository-wide local use and CI; no new type-aware lint pass is introduced

**Constraints**: Preserve behavior and current uncommitted work; do not tighten TypeScript-specific lint policy; do not independently reformat generated or byte-pinned artifacts; run under Node 24.20.0 via NVM in the current environment

**Scale/Scope**: Approximately 1,925 TypeScript/TSX/MTS files and 160,000 source lines across `apps/`, `packages/`, `tools/`, and `tests/`

## Constitution Check

*GATE: Passed before research and passed again after design.*

- **Product/domain invariants (I–XII)**: PASS. This feature changes repository quality tooling and layout only; it does not alter product scope, authority, security, approvals, persistence, integration behavior, or production boundaries.
- **Determinism (V, IX)**: PASS. Formatting, import sorting, and lint verification are deterministic and run locally without external services.
- **Architecture boundaries (IV, XII)**: PASS. Existing Nx module boundaries, restricted imports, architecture checks, and generated-contract ownership remain in force.
- **Compatibility (XI)**: PASS. Runtime and public contracts are unchanged. Exact tool versions are pinned and the existing Node/pnpm baseline is retained.
- **Evidence integrity (VIII, IX)**: PASS. Reports, generated OpenAPI/contracts, historical specs, and other byte-sensitive evidence are excluded from the bulk formatting scope.
- **Governance**: PASS. No constitutional invariant changes, so no ADR or constitution amendment is required.

## Project Structure

### Documentation (this feature)

```text
specs/011-code-quality-standards/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── quality-command-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
.
├── prettier.config.mjs        # deterministic layout policy
├── .prettierignore            # generated/evidence/byte-sensitive exclusions
├── eslint.config.mjs          # existing TS policy plus non-TS quality layers
├── package.json               # format/lint commands and exact dependencies
├── pnpm-lock.yaml             # resolved dependency graph
├── README.md                  # contributor command documentation
├── tools/
│   ├── ci/project.mts         # authoritative project quality gate
│   └── feature-001/project.json
├── apps/                      # maintained application source to format/fix
├── packages/                  # maintained library source to format/fix
├── tools/                     # maintained scripts to format/fix
└── tests/                     # maintained tests to format/fix
```

**Structure Decision**: Keep quality policy at the monorepo root so CLI, editor, Nx, and CI consumers resolve one configuration. Apply mechanical formatting and safe lint fixes to maintained code in place; do not create a runtime package.

## Design Decisions

1. Prettier owns layout. ESLint does not enforce a hard maximum line length and does not run Prettier as a lint rule.
2. `printWidth: 100`, two spaces, semicolons, double quotes, trailing commas, and LF are explicit repository policy.
3. ESLint uses `@eslint/js` recommended before the existing `strictTypeChecked` preset so TypeScript compatibility overrides remain effective.
4. All existing explicit `@typescript-eslint/*` entries remain byte-for-byte equivalent in meaning; no stylistic TypeScript preset is added.
5. Import sorting uses explicit groups: side effects, `node:`, external packages, `@awp/*`, unmatched absolute imports, and relative imports. Side-effect order is preserved.
6. Stable React Hooks recommended rules apply only to TSX; the experimental latest preset is excluded. JSX a11y uses its recommended, not strict, baseline.
7. Formatting verification runs before lint in the authoritative root project gate. Historical feature gates are not broadly rewritten unless they are standalone authoritative paths.
8. The cleanup sequence is lint autofix, format, format check, lint, typecheck, focused tests, and project regression verification.

## Complexity Tracking

No constitution violations or exceptional architecture are introduced.
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
