# Corporate input package — Feature 008

**Status:** not supplied in this task. L0 engineering can proceed using synthetic
fixtures. No corporate endpoint, account, owner or approval is inferred.
This is the concrete handoff checklist for system owners; it contains no secrets.

| ID | Required metadata | Owner role | Needed before |
|---|---|---|---|
| IN-01 | Reference Project/Workspace, Jira workflow/source/defect scope, GitLab project/ref/SHA/suite/environment and Mattermost channel identifiers | QA Lead + system owners | C1 selected adapter scope |
| IN-02 | Jira/GitLab/Mattermost editions, versions, supported API/webhook dialects, sanitized discovery/payload samples, permissions, rate/timeout/retry guarantees | Integration owners | C1 concrete provider implementation |
| IN-03 | OIDC issuer/API audience, token kind/algorithms/JWKS/introspection, group mappings, offboarding delay, session/step-up policy | IAM owner | C1 identity adapter; N2 login |
| IN-04 | Secret-store namespace/auth method, scoped opaque refs, exact-version/rotation policy, workload identities, key-signing/verification policy and break-glass process | Secret-store/Security owner | N2 secret and signature conformance |
| IN-05 | Sandbox/pilot endpoint origins, certificate trust, egress rules, callback public routes and authenticated/signed gateway contract where necessary | Network + integration owners | N2 connectivity and ingress |
| IN-06 | Telemetry endpoints, retention/redaction policy, permitted dimensions, alert routing, named on-call and ownership | Platform operator | N2 correlation, P3 operation |
| IN-07 | Artifact source policy, GitLab retention, optional approved object store, export/legal hold and historical verification retention | QA + Security/storage owners | Evidence/security/recovery gates |
| IN-08 | Backup destination/policy, logical or PITR method, RPO/RTO, recovery target definition, old-instance fencing, restore owner and external reconciliation access | Platform/database owner | Recovery gate |
| IN-09 | Dependency/image scanner tools/versions, scan DB freshness, severity policy and finding ownership | Security owner | Security gate; critical findings must be closed |
| IN-10 | Initial cohort: one Project/Workspace/environment/suite/QA Lead, named users/channels, dates, sponsor, operational owners | Sponsor + QA Lead | Shadow and limited-pilot gates |
| IN-11 | Current-process baseline sources, definitions, sampling and spot-check method; numeric targets and minimum sample after baseline | QA Lead + sponsor | Comparison protocol approval |
| IN-12 | Incident/suspension/rollback/resume procedures, compatible image/config rollback target, on-call and communication ownership | Platform + Security + sponsor | Limited-pilot gate |

## Acceptance

Each input has immutable version/hash, scope, suppliedBy, reviewedBy, reviewedAt,
evidenceRef and exact `status: "ACCEPTED"`. The status is part of the content hash.
Submit secrets through the approved secret store, never
this file, chat, source control, a fixture or a gate report. Owner roles above are
not names or granted permissions.

C1 accepts metadata/API contracts; it does not prove connectivity. N2 checks real
non-production systems and signed ingress. P3 needs completed preceding gates,
cohort and human activation. R4 platform production deployment is outside this
feature's release claim and never permits product-production QA actions.

Missing IN-02 blocks only the selected real provider implementation and downstream
corporate runs, not local contract work. Missing RPO/RTO permits local measurement
but cannot yield a corporate Recovery PASS. Missing dates/sample approval permits
report tooling, not an observed pilot result. Changing a pinned input invalidates
its dependent pending actions and gate assessment.
