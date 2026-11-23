# Feature 003 implementation prerequisites

This file freezes the implemented Feature 001/002 baseline consumed by Feature 003. The verifier treats the reports below as immutable evidence: a missing file, a byte-level digest mismatch, incompatible identity, or non-`PASS` status fails closed.

## Required report manifest

<!-- feature-003-prerequisite-manifest:start -->
```json
{
  "schemaVersion": 1,
  "reports": [
    {
      "id": "feature-001-final",
      "path": "artifacts/verification/feature-001-gate.json",
      "sha256": "b59fbf5a1cf18132fd7ec554703768b6c412c1d1820f0ab68c9cb3c2c58a0c75",
      "feature": "001-extension-kernel-local-skeleton",
      "gate": "feature-001-final"
    },
    {
      "id": "feature-001-smoke",
      "path": "artifacts/verification/smoke-001-gate.json",
      "sha256": "aceec9e735343478d12fae1559937900c4dec444dfb819ab291d574feff6afbe",
      "feature": "001-extension-kernel-local-skeleton",
      "gate": "smoke-001"
    },
    {
      "id": "feature-002-final",
      "path": "artifacts/verification/feature-002-gate.json",
      "sha256": "15dce7e0427a0326daffa0ea129813be074567cc87dd6e41b392d2646c5839a6",
      "feature": "002-qa-manual-walking-skeleton",
      "gate": "feature-002-final"
    },
    {
      "id": "feature-002-smoke",
      "path": "artifacts/verification/feature-002-smoke.json",
      "sha256": "419e9753893bdbfdf0a2860920bfcc0e79ae36d218c19547454fea3c67ad0fb1",
      "feature": "002-qa-manual-walking-skeleton",
      "gate": "repeatable-smoke"
    },
    {
      "id": "feature-002-regression",
      "path": "artifacts/verification/feature-002-regression-gate.json",
      "sha256": "787b885f17318e114e3b7bf49e6822d5e56ca2d150e9311395dafc0b651af211",
      "feature": "002-qa-manual-walking-skeleton",
      "gate": "combined-regression"
    },
    {
      "id": "feature-002-ci",
      "path": "artifacts/verification/feature-002-ci.json",
      "sha256": "ef7131f99191c9bc80fcc2b7e5e2942378643e3b0abdc0ed2dbd4dad164cd57c",
      "feature": "002-qa-manual-walking-skeleton",
      "gate": "provider-neutral-ci"
    },
    {
      "id": "feature-002-trace",
      "path": "artifacts/verification/feature-002-trace.json",
      "sha256": "21e503929dbb15fef58747d26e34d3c21006aed535a54e65eb12717fe23990cd",
      "feature": "002-qa-manual-walking-skeleton"
    }
  ]
}
```
<!-- feature-003-prerequisite-manifest:end -->

## Live implementation requirements

- `@awp/competency-qa@1.0.0` is public and declares `operational-work-item@1.0.0` requirements for `QA_REQUEST_AUTHORITY` and `DEFECT_DESTINATION`.
- the immutable 1.0 capability exposes `request.create`, `request.transition`, and `defect.create`;
- a persisted Connector command round-trips its manifest-owned primary `logicalRole`; reload must not replace it with `PRIMARY` or another hard-coded role;
- the primary Binding/Profile refs, exact Approval subject, durable command/outbox/inbox/recovery paths, and scoped `OperationalBinding` remain owned by Platform Core;
- generic `OperationalConfirmationHook` and `ConfirmOperationalEffect` execute Core plus Pack confirmation inside `TypeOrmConfirmationUnitOfWork`;
- QA intake/readiness, defect, and completion confirmation contributions are registered through generic hooks, without QA branches in Core;
- API and worker packages expose runnable start scripts, build/typecheck targets, bootstrap functions, and the completed local PostgreSQL/Redis/Mock Hub composition.

Feature 002 did not define a generic operational-import hook. That hook is therefore explicitly **not** a Feature 003 entry prerequisite; Feature 003 introduces it additively in its own foundational migration/UoW work. This exception does not permit replacement QA entities, a second confirmation path, or a bypass around the existing Core/Pack contracts.
