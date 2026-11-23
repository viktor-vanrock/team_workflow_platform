# Data Model: Enforced Code Quality Standards

This feature introduces no runtime or persisted business data. Its configuration artifacts form the following policy model.

## Formatting Policy

- **Preferred width**: 100 columns
- **Indentation**: two spaces, never tabs
- **Statements and strings**: semicolons and double quotes
- **Collection punctuation**: trailing commas where supported
- **Line endings**: LF
- **Scope**: maintained source and configuration files
- **Exclusions**: generated, evidence, report, historical specification, byte-sensitive contract, package-manager lock, and intentional fixture content

### Validation

- The same input produces the same formatted bytes.
- A second formatting pass produces no changes.
- Excluded paths are never rewritten by the repository command.
- Preferred width does not require semantic rewriting of unwrappable literals.

## Lint Policy

- **Core baseline**: maintained recommended JavaScript correctness rules
- **Strict additions**: curated non-TypeScript correctness and safety rules
- **Import policy**: deterministic groups, duplicate rejection, placement, blank-line separation, and Node protocol usage
- **React policy**: stable hook correctness checks for TSX
- **Accessibility policy**: maintained recommended JSX baseline
- **Architecture policy**: existing Nx boundaries and restricted imports
- **Deferred policy**: every existing TypeScript-specific rule and override remains unchanged

### Validation

- Repository verification exits non-zero for any error or warning.
- Safe fixes are deterministic.
- Side-effect import relative order is preserved.
- React and accessibility rules do not apply to backend-only files.

## Quality Command

- **Name**: one of `format`, `format:check`, `lint:fix`, or `lint`
- **Mutation**: write commands may modify maintained source; check commands never do
- **Exit status**: zero only when the requested action completes and all applicable checks pass
- **Environment**: repository-pinned Node and package-manager versions

## Quality Gate Result

- **Stage**: formatting, lint, typecheck, test, build, architecture, or contract verification
- **Status**: pass or fail
- **Diagnostics**: command output identifying actionable files and locations
- **Source integrity**: verification commands do not mutate maintained source

### State Flow

```text
UNFORMATTED / LINT-FAILING
        │ format + safe lint fixes
        ▼
FORMATTED / LINT-CLEAN
        │ non-mutating repository verification
        ▼
QUALITY-GATE PASS
```
