# QA verdict and completion runtime additions

These additions preserve published Feature 002 stored verdict/signature/DoD shapes. They describe the hardened HTTP/runtime path in Feature 008; they are not provider conformance evidence.

All paths have the prefix `/api/v1/workspaces/:workspaceId/projects/:projectId/work-items/:workItemId/qa`. HUMAN identity, current Core grants, Project scope and classification come from the verified server request. The current QA request lock serializes adjudication and completion dispatch.

| Operation | Request and result |
| --- | --- |
| `POST /verdicts` | Human `verdict` and `residualRisk { statement, classification }`; optional `expectedAggregateSnapshotHash` rejects a stale selection. The server derives the version, risk, policy and exact evidence references. Legacy inventory/version fields are not authority. Returns immutable draft with ETag. |
| `POST /verdicts/:verdictId/signatures` | Requires current draft ETag. Rebuilds the evidence/risk snapshot and checks the actual current QA Executor role. Signature, verdict state, audit and a final signed-verdict event commit together. |
| `POST /verdicts/:verdictId/supersessions` | Signed predecessor ETag, exact `supersedesVerdictRef`, human judgment and nonempty `revisionReason`. Creates the next immutable version and supersedes the signed predecessor. Cancels an undispatched closure command/approval/outbox and invalidates its QA candidate in the same transaction. An in-flight completion prevents this mutation. |
| `POST /verdicts/:verdictId/cosign-requests` | Partially signed verdict ETag and `reason`. Rechecks primary signer/current proof. Persists one platform action and exact approval; concurrent equivalent requests replay the same IDs. Approval expires after 15 minutes. |
| `POST /verdicts/:verdictId/cosign-approvals/:approvalId/approve` | Current `qa.verdict.cosign` and `approval.decide`, an independent actual QA Lead and the exact unexpired pending subject. Rechecks the original primary signer's current rights, evidence, risk, policy and verdict version. Approval consumption, action completion, co-signature, SIGNED projection, event and audit are atomic. Repeated consumption is rejected. |
| `POST /dod-assessments` | Exact `verdictRef` and `expectedAggregateSnapshotHash`. Uses persisted current evidence and signatures. |
| `POST /completion-candidates` | Exact latest `readyToCloseDodRef`. Derives the summary from that proof and a fresh confirmed Core provider revision. |
| `POST /completion-candidates/:candidateId/final-close` | Candidate ETag. Persists one command, exact approval and HELD outbox without provider I/O. |
| `POST /completion-approvals/:approvalId/approve` | Independent current QA Lead, `qa.completion.approve`, `approval.decide` and `connector.effect.approve`. Consumes exact approval and releases the outbox without claiming external DONE. |
| `GET /verdict-completion` | Existing scoped projections plus `aggregateSnapshotHash` and safe pending `cosignRequests` (`actionId`, `approvalId`, `verdictId`, `expiresAt`, `state`). |

Effective risk cannot be lower than the current Project policy, current request risk or human residual-risk classification. Approved/consumed waivers and frozen accepted-risk/waived Findings require elevated review. Historical local fixtures may have no request-risk field; that compatibility does not supply corporate readiness evidence.

The completion worker requires a selected scoped provider adapter and current service authority. The initial dispatch atomically freezes QA mutation and records the Core execution fence. Once invocation started, recovery only looks up that same effect ID; ABSENT, UNKNOWN, MULTIPLE or unavailable lookup never authorizes another POST. Confirmed observation, Core DONE projection, QA final confirmation, canonical SATISFIED DoD, plan freeze, event and audit commit together. The SATISFIED assessment preserves the exact original policy and evidence inventory.

Remaining composition work includes selected corporate provider adapters, signed v2/automated and exact waiver inventories, replacement of stale unsigned verdict drafts, and all non-local entry-point wiring. Controlled local HTTP/PostgreSQL tests are L0 engineering evidence only.
