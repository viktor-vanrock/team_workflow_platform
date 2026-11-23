# Quickstart: Enforced Code Quality Standards

## Prerequisites

Activate the repository runtime before installation or verification:

```bash
source /Users/alexandr/.nvm/nvm.sh
nvm use 24.20.0
node --version
pnpm --version
```

Expected versions are Node `v24.20.0` and pnpm `11.21.0`.

## Install the pinned dependency graph

```bash
CI=true pnpm install
```

The non-interactive flag is needed for the first reinstall if the existing modules directory was created by another runtime.

## Apply the mechanical cleanup

```bash
pnpm lint:fix
pnpm format
```

Review the import-order diff before proceeding, with particular attention to side-effect imports.

## Verify formatting safety and idempotence

```bash
pnpm exec prettier . --debug-check
pnpm format:check
git diff --check
```

Run `pnpm format` a second time and confirm it creates no additional diff.

## Verify quality and regressions

```bash
pnpm lint
pnpm typecheck
pnpm test:010
pnpm verify:010
pnpm ci:project
pnpm install --frozen-lockfile
```

Expected outcome: every command exits zero, lint reports no warnings, and check commands do not mutate maintained source. The project gate may refresh report evidence; those artifacts are not formatter-owned.

## Demonstrate enforcement

For local validation only, introduce an obviously unformatted multiline-capable expression and confirm `pnpm format:check` fails. Restore it with `pnpm format`. Likewise, temporarily disorder two non-side-effect imports and confirm `pnpm lint` fails, then restore with `pnpm lint:fix` followed by `pnpm format`.
