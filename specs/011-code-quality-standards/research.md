# Research: Enforced Code Quality Standards

## Decision: Dedicated formatter

**Decision**: Use exact Prettier 3.9.6 with an ESM configuration and an explicit 100-column preference. Keep formatting as separate `write` and `check` commands.

**Rationale**: Prettier supports the repository's TypeScript, TSX, MTS, decorators, and JSX without plugins. It deterministically expands dense structural code and long imports while leaving unwrappable SQL strings, URLs, regular expressions, and string literals semantically intact. A separate formatter follows ESLint and typescript-eslint guidance and keeps lint diagnostics focused on code quality.

**Alternatives considered**:

- ESLint formatting rules: rejected because core formatting rules are deprecated and would require a large, conflict-prone ruleset.
- dprint or Biome: viable, but would add a new policy surface without improving compatibility with the already installed Prettier bridge.
- Prettier plugins or experimental fast parsers: rejected for the first cleanup to minimize parser and semantic risk.

## Decision: Explicit formatting scope

**Decision**: Format maintained source and root/project configuration while excluding tool-owned metadata, historical specifications, byte-sensitive contracts, generated sources, evidence, reports, lockfiles, generated certificates, and test fixtures whose bytes may be intentional.

**Rationale**: The repository contains hundreds of contract artifacts and more than a thousand report files. Reformatting them would obscure the code-quality change and may invalidate hashes or generator comparisons.

**Alternatives considered**:

- `prettier --write .` without exclusions: rejected because it creates unrelated churn and evidence risk.
- Formatting only files changed in the current diff: rejected because it would leave the existing repository-wide readability problem unresolved.

## Decision: Strict non-TypeScript ESLint layer

**Decision**: Add `@eslint/js` recommended before the existing TypeScript preset, then add a curated strict core layer for callback returns, braces, equality, constructor returns, promise executors, template mistakes, loop safety, useless assignments, and modern own-property checks.

**Rationale**: These checks catch likely bugs without changing the requested TypeScript-specific policy. Positioning the core preset before typescript-eslint lets its compatibility configuration continue disabling core rules that TypeScript handles better.

**Alternatives considered**:

- `typescript-eslint/stylistic-type-checked`: deferred because the user explicitly excluded TypeScript-rule tightening.
- `eslint:all` or a broad third-party opinionated preset: rejected because rule changes between releases and high false-positive/churn risk make it unsuitable as a stable project contract.
- Complexity and hard line-length errors: rejected for this phase because they are not safely auto-fixable and would penalize migrations, SQL, and generated-adjacent structures.

## Decision: Import hygiene

**Decision**: Use `eslint-plugin-simple-import-sort` for imports and exports, `eslint-plugin-import` only for import placement, a single post-import blank line, and `node:` protocol enforcement, plus core duplicate-import detection that permits separate type imports.

**Rationale**: The sorter handles TypeScript specifiers and comments, preserves side-effect import order, and cooperates with Prettier. Avoiding resolver-based import rules prevents duplication and false positives with NodeNext, Nx aliases, and workspace exports.

**Alternatives considered**:

- `sort-imports` or `import/order`: rejected because they conflict with the selected sorter.
- Full `eslint-plugin-import` recommended configuration and TypeScript resolver: rejected because TypeScript, Nx, and the custom architecture scanner already own resolution and boundary correctness.

## Decision: React-specific checks

**Decision**: Apply stable React Hooks recommended rules and JSX a11y recommended rules only to maintained TSX files.

**Rationale**: Hooks rules catch lifecycle and purity errors that TypeScript cannot detect. The accessibility recommended baseline provides meaningful UI checks with less false-positive risk for MUI and dynamic roles than its strict preset.

**Alternatives considered**:

- Experimental React Hooks `recommended-latest`: rejected because compiler-related experimental rules expand scope and migration risk.
- JSX a11y strict: deferred until the recommended baseline is clean and component mappings are proven.

## Decision: CI and migration sequence

**Decision**: Expose `format`, `format:check`, `lint:fix`, and zero-warning `lint` commands. Add `format:check` before lint in the project gate. Run safe lint autofix before final formatting, then validate formatting idempotence, lint, typecheck, focused Feature 010 tests, and the project gate.

**Rationale**: A separate write/check contract prevents CI from mutating files. Formatting after lint fix stabilizes layout. The existing project gate is already the provider-neutral entry point used by higher-level CI.

**Alternatives considered**:

- Rewriting every historical feature gate: rejected as unrelated churn; the root policy and authoritative current gate provide repository-wide enforcement.
- Combining Prettier into ESLint through `eslint-plugin-prettier`: rejected because it is slower and produces less focused diagnostics.

## Compatibility and Environment

- Node 24.20.0 is already installed and is now the NVM default; non-interactive validation in this agent session still explicitly activates NVM.
- Prettier 3.9.6 supports Node 22 and newer.
- TypeScript 6.0.3 remains within the installed typescript-eslint 8.68.0 support range.
- ESLint remains pinned at 9.39.5 for this feature; an ESLint major upgrade is out of scope.
- The dependency graph must be reinstalled under Node 24 before validation because the existing modules directory was created under a different runtime context.

## Primary References

- [Prettier installation](https://prettier.io/docs/install)
- [Prettier options](https://prettier.io/docs/options)
- [Prettier ignore behavior](https://prettier.io/docs/ignore/)
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/)
- [simple-import-sort](https://github.com/lydell/eslint-plugin-simple-import-sort)
- [React Hooks lint rules](https://react.dev/reference/eslint-plugin-react-hooks)
- [jsx-a11y flat configuration](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#usage---flat-config-eslintconfigjs)
- [Nx module boundaries](https://nx.dev/docs/kb/enforce-module-boundaries)
