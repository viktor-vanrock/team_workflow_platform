# Quality Command Contract

## `pnpm format`

- Formats every maintained file in repository scope.
- May write source and configuration files.
- Must honor `.prettierignore`.
- Must be deterministic and idempotent.
- Exits non-zero on parser or filesystem failures.

## `pnpm format:check`

- Checks the same scope and policy as `pnpm format`.
- Must not modify any file.
- Exits zero only when every in-scope file is formatted.
- Identifies unformatted files in command output.

## `pnpm lint:fix`

- Applies only safe fixes offered by the configured lint rules.
- May reorder imports while preserving side-effect-only import order.
- Must not apply formatter output implicitly.
- Exits non-zero if errors or warnings remain after fixes.

## `pnpm lint`

- Checks all maintained lintable files without modifying them.
- Exits non-zero for any error or warning.
- Reports unused disable directives as errors.
- Enforces existing architecture and restricted-import policy.
- Enforces the new non-TypeScript core, module, React hook, and accessibility policy.
- Does not tighten existing TypeScript-specific rule settings.

## Authoritative gate integration

- The project regression gate runs `format:check` before `lint`.
- A formatting failure prevents later quality stages from being considered successful.
- CI invokes check commands only; write commands are contributor workflows.
