# Feature 008 contracts

Additive design contracts. Published 001–007 schemas and exact action identities
are preserved; implementation registers new contributions through existing owners.

| Contract | Contents |
|---|---|
| [deployment-profile.md](deployment-profile.md) | Startup validation, identity/secrets, network, artifact and telemetry policy |
| [connector-conformance.md](connector-conformance.md) | Native protocol capability matrix, ingress, confirmation and degradation |
| [pilot-operations.md](pilot-operations.md) | Operator API/CLI, activation, cohort, shadow, baseline and review |
| [recovery-and-evaluation.md](recovery-and-evaluation.md) | Restore manifest, fence, Hermes corpus, guardrails and measurements |
| [gate-report.schema.json](gate-report.schema.json) | Closed machine-readable gate report envelope |

The schema validates report structure. As in the existing registry, JSON Schema
format annotations alone do not validate timestamps; application validation checks
strict timestamps and ordering. Scope, digest verification, dependency
freshness, role checks, safe references, run provenance and cross-field ordering
are enforced by application validators; schema-valid data alone is not approval.
New runtime names/commands/routes in these documents are planned interfaces.
