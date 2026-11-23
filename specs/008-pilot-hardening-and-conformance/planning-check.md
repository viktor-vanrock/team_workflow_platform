# Planning verification — Feature 008

**Date:** 2026-09-03

**Result:** Design/task consistency checks passed. This is not implementation,
security, conformance, recovery or pilot execution evidence.

## Scope and artifacts

Repository branch is `codex/feature-008-pilot-hardening-and-conformance`, created
from the committed Feature 007 baseline `9dd759e`. Spec-kit context selects
`008-pilot-hardening-and-conformance`. Planning adds plan/research/data model/input catalog,
validation guide, contracts and tasks; spec status links these artifacts.

| Work | Planned tasks |
|---|---:|
| Setup | 7 |
| Foundation | 12 |
| US1: corporate bindings | 21 |
| US2: conformance/degradation | 17 |
| US3: security/Hermes quality | 13 |
| US4: backup/restore | 14 |
| US5: pilot operation/review | 22 |
| Cross-cutting handoff | 9 |
| Total | 115 |

All tasks remain unchecked. Engineering MVP: Setup + Foundation + US1 local
checkpoint. Corporate-specific adapter work requires C1 inputs; N2/P3 and the
observed pilot are separate gated work.

## Checks performed

- Sequential unique T001–T115; correct checkbox/parallel/story labels and explicit
  file targets; per-story checkpoints and dependency/parallel examples.
- All 31 FR and seven SC have implementation/verification task mappings.
- Relative documentation links resolve; no unresolved design-template markers.
- Gate schema compiles with the repository's Ajv configuration. Seven synthetic
  structural cases pass: valid PASS, valid BLOCKED_INPUT, reject skipped child in
  PASS, reject PASS without evidence, reject unknown property, reject empty scope,
  reject failure without reason. Timestamp/scope/auth/digest semantics require
  application validation and later implementation tests.
- Repository/runtime research and official protocol documentation inform the
  design, including non-local composition gaps, local-only adapters, partial
  activation, exact probe/gate reuse and Core-owned SLA facts.
- Pre/post planning and task hooks: no `.specify/extensions.yml` is present.

No application test suite, corporate scan, provider call, deployment or restore
was run during planning. New quickstart commands are marked planned. The first
implementation step validates the existing 007 source-bound completion evidence.

## Remaining external inputs

The twelve owner/input groups in [pilot-inputs.md](pilot-inputs.md) are not supplied.
The design specifies deterministic blocked behavior, allowing local engineering to
proceed without inventing corporate versions, credentials, RPO/RTO or pilot dates.
