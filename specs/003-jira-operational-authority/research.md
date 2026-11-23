# Research: Jira operational authority

**Feature:** `003-jira-operational-authority`  
**Date:** 2026-08-28  
**Status:** Complete — design unknowns resolved; live pilot values are versioned deployment inputs

## 1. Sources and method

Decisions are derived from the ratified constitution, ADR-0002/0006/0007, the completed design package for features 001/002, the current repository, and primary Atlassian documentation. The implementation baseline is intentionally separated from the target design: feature 001 is only partially implemented, while feature 002 has design artifacts but no implementation. Feature 003 may be planned now, but its implementation entry gate must reject a workspace without final machine-readable 001 and 002 reports.

Relevant primary Jira sources:

- [Jira Cloud issue REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [Jira Data Center issue REST API](https://developer.atlassian.com/server/jira/platform/rest/v11002/api-group-issue/)
- [Cloud issue search and enhanced JQL pagination](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)
- [Cloud Search and Reconcile](https://developer.atlassian.com/cloud/jira/platform/search-and-reconcile/)
- [Data Center JQL search](https://developer.atlassian.com/server/jira/platform/rest/v11002/api-group-search)
- [Jira Cloud webhooks](https://developer.atlassian.com/cloud/jira/software/webhooks/)
- [Jira Data Center webhooks](https://developer.atlassian.com/server/jira/platform/webhooks/)
- [Data Center webhook security](https://confluence.atlassian.com/adminjiraserver/managing-webhooks-938846912.html)
- [Jira Cloud rate limits](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- [Jira Data Center rate-limit guidance](https://confluence.atlassian.com/spaces/ADMINJIRASERVER111/pages/1652462655/Adjusting%2Byour%2Bcode%2Bfor%2Brate%2Blimiting)
- [Cloud service-account OAuth credentials](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/)
- [Cloud service-account API tokens](https://support.atlassian.com/user-management/docs/manage-api-tokens-for-service-accounts/)
- [Data Center service-account model](https://confluence.atlassian.com/enterprise/how-service-accounts-work-in-data-center-1627556033.html)
- [Cloud issue links](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/)
- [Cloud remote links](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/)
- [Data Center remote links](https://developer.atlassian.com/server/jira/platform/jira-rest-api-for-remote-issue-links/)

## R-001 — Implementation prerequisite

**Decision:** implementation starts only after `feature-001-gate.json` and `feature-002-gate.json` prove their final contract, migration, architecture, security, smoke and regression gates. The prerequisite verifier checks the actual exported `competency-qa`, `operational-work-item@1.0.0`, generic confirmation/lifecycle hooks, operational binding, exact approvals and runnable API/worker composition. It must not infer readiness from the existence of planning files.

**Rationale:** the current repository has no `packages/competency-qa`, and the actual feature-001 work/persistence/webhook/worker skeleton does not yet satisfy the target contracts used by the 002 design.

**Alternatives considered:** rebuilding missing 001/002 primitives inside 003 was rejected because it would duplicate ownership and hide dependency failure.

## R-002 — Connector package boundary

**Decision:** add statically composed pure `@awp/connector-jira` plus `@awp/connector-jira-persistence-typeorm`. The pure package depends only on `@awp/connector-sdk`, `@awp/platform-contracts` and platform-neutral runtime types; it has no TypeORM/Core/QA/Nest/React dependency. The persistence package owns only Jira-specific entities/repositories/migrations and depends on TypeORM, the pure connector contracts and platform contracts, never on Core/QA. HTTP uses Node 24 native `fetch`/WebCrypto behind injected transport, clock, secret resolver and configuration ports. Jira literals, REST paths, ADF, account IDs, JQL and vendor error decoding exist only in these Jira-owned packages and the protocol-faithful Mock Hub Jira surface.

**Rationale:** Core, QA Pack, UI and Hermes remain vendor-neutral and cannot bypass Broker, policy, approval, audit or idempotency.

**Alternatives considered:** Atlassian SDK and direct QA/Nest adapters were rejected until a selected pilot auth dialect proves a vendor SDK necessary.

## R-003 — Explicit versioned Jira adapter families

**Decision:** a Connection pins one adapter family and contract version, never `auto` or `/latest`:

- `jira-cloud-v3@1.x` for Cloud REST v3, ADF, accountId, token pagination and Cloud webhook/rate-limit semantics;
- `jira-dc-9-v2@1.x` for DC 9 REST v2 and synchronous-era webhook behavior;
- `jira-dc-10-v2@1.x` for DC 10 asynchronous webhook behavior;
- `jira-dc-11-v2@1.x` for DC 11 service-account/rate-limit capabilities.

The Connection also pins exact edition, build/version, API flavor, identity/rich-text/pagination/webhook/auth dialect and a discovered capability snapshot hash. Unknown version or capability drift fails closed for only the affected Connection/Profile.

**Rationale:** Cloud and DC differ in identity, content, search, webhook and auth semantics; silent branching would reinterpret a published Profile after Jira upgrades.

**Alternatives considered:** a single mutable `jira` dialect and runtime server auto-detection were rejected.

## R-004 — Pilot metadata as a gate, not a planning unknown

**Decision:** all `[PILOT INPUT REQUIRED]` values live in a schema-validated, secret-free `JiraPilotMetadataPackage@1` referenced by a validation report. Local contracts use deterministic fixture IDs. Live Profile publication is blocked until the package supplies edition/build, base URL/cloudId/context path, auth kind and owner, project/issue-type/field/status/transition/link IDs, JQL, identity mode, webhook guarantees, rate budget, searchable command marker, least-privilege evidence and concurrency decision.

**Rationale:** design and local implementation remain executable without corporate access, while no guessed project key, field ID or auth strategy can enter a published non-local Profile.

**Alternatives considered:** placeholders inside published Profiles and assuming Jira Cloud were rejected.

## R-005 — Capability compatibility

**Decision:** preserve `operational-work-item@1.0.0` from feature 002 and add backward-compatible `1.1.0` operations:

```text
request.create
request.transition
request.assign
request.set-priority
request.set-due-date
defect.create
```

Each operation has a closed target/input/result schema. Profiles may implement a subset, but a Project Binding can publish only when every required operation for its logical role is present. Read-back, search, webhook, discovery and reconciliation are Connector infrastructure ports, not Pack-callable operations and not `execute(any)`.

The 1.0 target/result and `request.transition` input remain immutable; in particular its target status set stays `READY | DONE`. A 1.1 Profile may pin a new additive transition-input schema with the expanded normalized workflow. Runtime validates against the exact pinned schema, so historical 1.0 commands are never reinterpreted.

**Rationale:** assignment/priority/due are explicit FR-026/027 effects and must not be hidden in transition or generic field update.

**Alternatives considered:** breaking `2.0.0`, generic update, and Jira-specific Pack payloads were rejected.

## R-006 — Runtime configuration and secret boundary

**Decision:** Broker resolves the exact immutable Binding/Profile/Mapping/Connection chain and supplies refs plus schema-bound connector configuration to the handler. Raw credential values never enter command, job, Profile, audit or logs. An injected `SecretResolverPort` resolves an opaque reference immediately before transport use, returns a short-lived non-serializable lease, and fails closed on expiry/revoke. Connection health records rotation/revoke status without secret values.

**Rationale:** the current local fake secret resolver is insufficient for real non-prod execution, while giving Core vendor configuration or raw secrets would violate boundaries.

**Alternatives considered:** environment-variable tokens and persisted decrypted credentials were rejected.

## R-007 — Profile topology

**Decision:** one Project Integration Binding resolves three independent Jira logical roles:

- `QA_REQUEST_AUTHORITY`: central QA project create/import/sync and allowed request commands;
- `SOURCE_CONTEXT`: read-only allowlisted source issues and link directions;
- `DEFECT_DESTINATION`: owning product project defect create/search/link policy.

Central and defect Profiles are always separate versions even when they share a Connection. Every Work Item and command pins the exact chain actually used.

**Rationale:** central request authority and product defect scope have different projects, fields, permissions, idempotency and approval blast radius.

**Alternatives considered:** a single all-project Profile and Workspace-wide mutable mapping were rejected.

## R-008 — Discovery, validation, preview and dry run

**Decision:** Profile lifecycle is `DRAFT → DISCOVERED → VALIDATED → PUBLISHED → RETIRED`. Discovery saves an immutable sanitized snapshot of server info, projects, issue types, fields/contexts, statuses, transitions, priorities, users/identity shape, link types, permissions and API capabilities. Validation binds every configured ID to that snapshot and performs read-only live checks. Preview applies mappings to fixtures/sanitized samples and renders intended requests. Dry run performs only read/search/metadata/permission probes and returns predicted effects; it never creates, edits, links, comments or transitions an issue.

Published Profiles are immutable. New metadata or mapping creates a new version and a new validation report.

**Rationale:** Jira create/edit availability depends on project, issue type, screen, context and permission; name-only validation is unsafe.

**Alternatives considered:** first-write-as-validation and mutating a published Profile were rejected.

## R-009 — Closed mapping language

**Decision:** Jira mapping is a bounded JSON AST with only `literal`, `source`, `coalesce`, `lookup`, `concat`, `format-date`, `array`, `object` and `omit-if-null`. Schema limits depth, node count, output size and allowed source paths/target field IDs. Evaluation has no loops, regex, network, filesystem, time, randomness, `eval`, `Function` or user code. Lookup tables and every Jira target ID are part of Profile content hash.

**Rationale:** mapping remains deterministic, reviewable, versioned and safe for untrusted external text.

**Alternatives considered:** JavaScript templates, unrestricted JSONata/JMESPath and runtime plugin code were rejected.

## R-010 — Create/defect idempotency and ambiguity

**Decision:** PostgreSQL serializes one platform command per semantic request and stable effect key. Jira create/defect payload writes that command/effect marker into a published searchable custom field and, where supported, an issue property. Before any retry after a possibly started effect, the Connector searches the exact marker inside the pinned project/issue type and then reads the issue. One match confirms/reconciles; multiple matches are a security/integration conflict; an eventual-consistency uncertainty becomes `AMBIGUOUS` and blocks automatic re-create.

Jira has no documented native `Idempotency-Key` or marker uniqueness constraint. Therefore the platform promises no duplicate from its automatic retry policy by stopping on ambiguity; it does not claim physical exactly-once Jira transport.

**Rationale:** blind retry after a lost response can create a second issue.

**Alternatives considered:** DB ledger only, summary matching and unconditional retry were rejected.

## R-011 — Multi-step logical effects

**Decision:** request create may include source link; defect create includes QA Request link; DONE transition may include a deterministic completion comment. Each is one logical command with an ordered sub-effect plan and durable normalized receipt. Retry re-reads each sub-effect and creates only missing exact link/comment/state. Jira-to-Jira link identity is `{typeId,direction,inwardId,outwardId}`; remote links use deterministic `globalId`; completion comments carry a stable non-secret marker and are created without inline issue-link comments.

**Rationale:** partial success must remain recoverable without duplicate issue, link or comment.

**Alternatives considered:** independent uncorrelated commands and treating the first 2xx as full confirmation were rejected.

## R-012 — External revision and conflict contract

**Decision:** `externalVersion` is a Connector-generated revision token over Jira `updated`, latest changelog ID when available, and a canonical hash of authority fields. A write takes the expected token/value, acquires a platform mutex per `{connection,issueId}`, performs a fresh GET, rejects mismatch as `CONFLICT`, sends the smallest field/transition patch, and immediately GETs again. Canonical projection changes only from that post-read or later observation.

Jira Cloud/DC REST does not document atomic version-CAS or `If-Match` for issue edit/transition; Atlassian requests [JRACLOUD-26005](https://jira.atlassian.com/browse/JRACLOUD-26005) and [JRASERVER-26005](https://jira.atlassian.com/browse/JRASERVER-26005) are closed Won't Do. The pre-read/write interval therefore has a residual human TOCTOU race. `JiraPilotMetadataPackage` must select either:

- `JIRA_SIDE_CAS`, backed by a reviewed Jira app/plugin conditional endpoint; or
- `COMPARE_AND_VERIFY`, with explicit pilot risk acceptance and post-write conflict/alert semantics.

If the acceptance interpretation requires strict atomic no-overwrite, `COMPARE_AND_VERIFY` cannot pass the live pilot gate.

**Rationale:** this satisfies expected-version/value and stale-before-write conflict behavior without pretending Jira exposes a stronger primitive.

**Alternatives considered:** trusting a 409 not tied to version and silently accepting the race were rejected.

## R-013 — Projection ownership and monotonicity

**Decision:** Core owns one active `OperationalAuthorityBinding` per Work Item plus an append-only `OperationalProjectionRevision` history. Each revision contains exact chain refs, external revision token, raw and normalized status, requester/assignee identity refs, priority, due date, authoritative-fields hash, observation source and timestamps. The binding points to the current revision and derives `SYNCED|STALE|ERROR|CONFLICT|MAPPING_REQUIRED|AUTH_BLOCKED`.

Apply is one PostgreSQL transaction over consumer inbox marker, monotonic comparison, projection revision/current pointer, Work Item denormalized status, audit and event outbox. Equal observation is duplicate; older is stale; incomparable/gap schedules a read/reconciliation and never rolls back the projection.

**Rationale:** Jira remains source of truth while local reads are fast, auditable and resistant to out-of-order delivery.

**Alternatives considered:** mutable Work Item fields without history and webhook receive time as version were rejected.

## R-014 — Verified external identity

**Decision:** add generic versioned `ExternalPrincipalBinding` keyed by Workspace, exact Connection/tenant, external principal kind/id and canonical platform principal. It records verification method/evidence hash, verifier, lifecycle and conflict/revoke state; email/display name never identifies a principal.

Outbound assignment/requester mapping requires an active exact binding plus live Project Entitlement. Profiles choose Cloud `accountId` or the pinned DC identity field. If Jira cannot set Reporter safely, the service identity is Reporter and a verified custom requester field stores the canonical reference.

**Rationale:** audit must preserve the human initiator even though the service identity executes Jira calls.

**Alternatives considered:** matching email/username and user impersonation were rejected.

## R-015 — Direct Jira import as explicit external confirmation

**Decision:** a dedicated central QA issue creation is accepted as explicit user confirmation only when the published Profile declares `VERIFIED_HUMAN_ISSUE_CREATE`, the event/read proves the exact project/issue type/import JQL, the immutable Jira creator maps to an active HUMAN principal, a project discriminator resolves exactly one active Project Binding, and live membership/entitlement/classification checks pass. The stored `OperationalImportIntent` pins creator, issue creation changelog/evidence hash, issue/profile/binding refs and canonical payload hash.

Unverified, ambiguous or automation-created issues remain quarantined/`AWAITING_CONFIRMATION` and create no Work Item. An accepted import transaction creates one Work Item, one binding/projection, QA extension and initial input revision; completeness then deterministically yields READY/NEEDS_INFO facts without silently rejecting the request.

**Rationale:** the Jira user's deliberate create action can satisfy the constitutional explicit-confirmation requirement only with verifiable identity and target evidence.

**Alternatives considered:** auto-importing every JQL match and requiring Mattermost were rejected.

## R-016 — Webhook trust model

**Decision:** the Nest adapter preserves exact raw bytes. Ingress authenticates the Connection, verifies HMAC when the pinned dialect supports it, enforces size/content type, stores a durable quarantine receipt and ACKs without external Jira calls. Cloud dedupe uses `{connectionId,X-Atlassian-Webhook-Identifier}`; DC uses stable event/changelog identity when present, otherwise canonical payload hash. A webhook is only an unordered invalidation signal: the worker resolves scope and re-reads Jira before applying any projection/import change.

Old legitimate retries are not rejected solely by payload timestamp. Replay policy combines verified delivery ID/hash, bounded endpoint secret rotation, connection scope and dedupe. Wrong project/type/profile is rejected before any project-scoped event or data disclosure.

**Rationale:** webhook payloads may be duplicate, delayed, incomplete, forged or out of order.

**Alternatives considered:** applying payload fields directly and reconstructing signed bytes after JSON parsing were rejected.

## R-017 — Reconciliation cursor and lanes

**Decision:** durable progress is the watermark tuple `(updated,key)` with configured overlap, not Cloud page token or DC offset. Each run executes `updated >= watermark-overlap ORDER BY updated ASC,key ASC`, dedupes by immutable issue ID, and advances the watermark only after a complete pass. Cloud `nextPageToken` and DC `startAt` are transient run state.

Separate lanes cover strict import JQL, direct/batched reads of all bound issues regardless of import JQL, and periodic full sweep for gaps/scope exit/drift. Cloud `reconcileIssues` may strengthen read-after-write for known IDs but is not the global cursor.

**Rationale:** Cloud search is eventually consistent and DC offset pages can shift during concurrent updates.

**Alternatives considered:** permanent page tokens/offsets and webhook-only sync were rejected.

## R-018 — Rate budget and retry taxonomy

**Decision:** per-Connection budgets and priority lanes order command confirmation before webhook reads and periodic sweeps. `Retry-After` and provider headers drive bounded exponential backoff with jitter. Error taxonomy is closed:

```text
AUTHENTICATION | PERMISSION | CONFLICT | RATE_LIMIT | TRANSIENT
VALIDATION | NOT_FOUND | MAPPING_DRIFT | AMBIGUOUS | SECURITY_SCOPE
```

401/403 stop automatic retry and raise integration/security alerts; 429/5xx/timeouts retry only when read/marker reconciliation proves it safe. All errors are sanitized.

**Rationale:** provider rate limits and outages must not cause retry storms or duplicate writes.

**Alternatives considered:** one global queue and retrying every non-2xx were rejected.

## R-019 — Exact approvals and action shape

**Decision:** `request.transition`, `request.assign`, `request.set-priority`, `request.set-due-date` and `defect.create` always use the existing exact `EXTERNAL_COMMAND` Approval. The subject includes one command identity, full typed payload hash, target, expected revision/value, exact chain, initiator and authorization basis, expiry and effect key. Payload/profile/expected-state/access drift invalidates authorization; a conflict requires a newly prepared command and new approval. `request.create` is authorized by the explicit confirmed intake/import contract and is not given an extra generic approval.

**Rationale:** follows Constitution VI and ADR-0007 without allowing a broad “approve Jira changes” grant.

**Alternatives considered:** reusable approvals and transition IDs supplied by clients were rejected.

## R-020 — Least privilege and auth strategies

**Decision:** non-local Connections accept only service identity strategies allowed by the pinned dialect and metadata package. Cloud preference is service-account OAuth client credentials when available, then expiring scoped service-account token. DC 11.1+ preference is restricted service-account 2LO; older/coverage-gap DC may use a dedicated non-admin technical account with expiring PAT. Human personal PAT, delegated impersonation and 3LO-as-user are forbidden.

Permission evidence must show only Browse/read metadata, Create/Edit/Assign/Transition/Link/Add Comment where that Profile needs them. Delete Issues, Jira/project administration, workflow/field/user management and unbound projects are explicitly denied.

**Rationale:** API scopes do not replace Jira project permissions.

**Alternatives considered:** one global admin credential and per-user tokens were rejected.

## R-021 — Mapping drift isolation

**Decision:** every observation/effect checks current Jira metadata against the pinned discovery/capability snapshot. Missing field/status/transition/link/identity capability sets the affected Profile health to `MAPPING_REQUIRED`, blocks only features resolving through that Profile, and emits a drift report. Other profiles/projects continue. Existing started effect recovery remains pinned to the old chain and never switches version.

**Rationale:** a custom-field or workflow change must not globally disable the platform or reinterpret history.

**Alternatives considered:** global Connector outage and silent name remapping were rejected.

## R-022 — Environment vocabulary and production boundary

**Decision:** before any 003 persistence, normalize the cross-package vocabulary to `LOCAL | NON_PROD | PREPROD | PLATFORM_PROD`, with a compatibility parser for legacy planned values and no silent database rewrite. Feature 003 compositions permit only `LOCAL` and `NON_PROD`; production Connection/Profile/credential/network egress fails at configuration, policy and composition layers.

**Rationale:** current Core, contracts and SDK use conflicting strings, and a UI flag is not a security boundary.

**Alternatives considered:** ad-hoc translation per Connector and production-disabled UI only were rejected.

## R-023 — Storage and migrations

**Decision:** PostgreSQL remains authoritative. Core migrations `0090…0095` expand provider-neutral work/binding/projection/command-chain/target-lane/identity/import/reconciliation data without rewriting history. The separate Jira TypeORM contribution owns real migrations `3000…3020` for discovery/validation, normalized webhook/rate and effect/sub-effect/ambiguity metadata; no empty reserved migration is created. Migration ownership gains `connector:${string}`. QA tables remain owned by 002. Redis/BullMQ carries only reconstructible job IDs and leases.

**Rationale:** module ownership, recovery and expand/contract compatibility remain explicit.

**Alternatives considered:** Redis cursors, Connector mutation of QA tables and vendor data embedded in generic columns were rejected.

## R-024 — Local protocol mock and live contract gate

**Decision:** extend Mock Hub with protocol-faithful Cloud-v3 and selected DC-v2 Jira surfaces, monotonic issue/changelog state, JQL/search pagination, command markers, links/comments, webhooks and injected timeout/401/403/429/5xx/duplicate/out-of-order/schema-drift scenarios. The same `connector-jira` talks to Mock Hub locally and corporate Jira in non-prod. `connector-mock` remains the provider-neutral conformance alternate.

Live tests are opt-in and require the complete metadata/secret/evidence package; local critical E2E never requires VPN or corporate credentials.

**Rationale:** mocking only `JiraPort` would miss HTTP, auth, pagination, signature and provider-shape drift.

**Alternatives considered:** live-only tests and separate local business implementation were rejected.

## R-025 — Freshness and UI truth

**Decision:** Profile configures freshness SLO, webhook grace, reconciliation interval, page/concurrency budget and full-sweep cadence. UI always displays external key/web link, raw and normalized status, assignee/priority/due, current projection source/observed time, `SYNCED|STALE|ERROR|CONFLICT|MAPPING_REQUIRED|AUTH_BLOCKED`, and any pending command separately. Requested values never replace confirmed Jira values.

**Rationale:** users must distinguish operational truth, delayed projection and desired effect.

**Alternatives considered:** optimistic UI mutation and hiding raw Jira status were rejected.

## R-026 — Observability and audit

**Decision:** logs/metrics/traces include connection/profile/project/work item/external entity/correlation IDs, sanitized adapter family/result category, request latency, rate budget, webhook/reconciliation lag, duplicate/stale/gap counts, mapping/conflict/auth/rate-limit errors, retry/confirmation and freshness. Audit reconstructs human → approval/command → exact chain → Jira calls/sub-effects → read confirmation. Raw tokens, raw provider bodies, restricted issue text and artifact locators are redacted.

**Rationale:** SC-007 and incident recovery require an evidence chain without data leakage.

**Alternatives considered:** connector-only logs and raw response dumps were rejected.

## R-027 — Multi-role command pins and external subjects

**Decision:** each operation declares required logical roles. Core resolves and persists one ordered immutable primary/auxiliary configuration-chain set before outbox publication, hashes the full set into command/audit/Approval and revalidates every entry at effect time. Native cross-project links require the same proven authority namespace; otherwise an explicitly published remote-link strategy is required. Assignment resolves a canonical principal through an injected provider-neutral external-subject port into trusted adapter context; provider IDs never come from client/Pack payloads and the Connector never queries Core.

**Rationale:** request source links and defect-to-request links span different logical roles, while a single untracked Profile pin would permit scope drift or connector-side registry access.

**Alternatives considered:** client-selected secondary Profiles, Connector registry lookup and raw Jira user IDs in command payloads were rejected.

## R-028 — Durable target execution lane

**Decision:** Core owns a fenced PostgreSQL target lane keyed by stable Connection authority namespace plus provider-neutral entity kind/ID. It serializes distinct commands, remains occupied through possibly-started/ambiguous recovery and releases only on confirmed, final conflict/failure or explicit ambiguity resolution. Worker lease expiry permits only the same command/effect identity to reacquire with a newer fencing token.

**Rationale:** an ordinary per-command lease cannot stop two separately approved commands based on the same projection from both passing their Jira pre-read.

**Alternatives considered:** process mutexes, Redis-only locks and releasing immediately after the HTTP response were rejected.

## 2. Resolved ambiguity register

| Ambiguity | Resolution |
|---|---|
| Jira edition/auth unknown | Explicit adapter family + versioned metadata gate; no `auto` |
| Pilot IDs/JQL unknown | Required inputs to non-local Profile publication, deterministic local fixtures |
| 1.0 lacks assign/priority/due | Additive typed `operational-work-item@1.1.0` |
| Direct Jira creation vs explicit confirmation | Only verified HUMAN issue creation with exact profile/binding evidence qualifies |
| Jira native idempotency | No claim; searchable marker + platform serialization + stop on ambiguity |
| Jira native version-CAS | None documented; compare/read/write/read, residual race declared and gated |
| Webhook ordering/security | Durable raw-byte verification; webhook triggers authoritative re-read only |
| Reconciliation pagination | Watermark + overlap; provider pagination transient |
| Source/central/defect scope | Three separate logical-role Profiles |
| Mapping execution | Closed bounded AST, no arbitrary code |
| Published configuration drift | New version; affected Profile only blocked |
| Secret access | Opaque ref + injected short-lived resolver lease |
| Environment vocabulary | One canonical enum before persistence |
| Work Item import without Draft | Generic `OperationalImportIntent` acceptance source and atomic import UoW |

## 3. Research gate

- The implementation design contains no unresolved clarification marker.
- Corporate Jira identifiers, credentials and guarantees are deployment inputs validated by `JiraPilotMetadataPackage@1`; absence blocks only live Profile publication and live contract tests.
- No constitutional exception is requested. The residual Jira REST TOCTOU limitation is explicit; a strict atomic-CAS interpretation requires the `JIRA_SIDE_CAS` pilot mode rather than weakening the invariant.
- Phase 1 design may proceed to `plan.md`, `data-model.md`, `contracts/` and `quickstart.md`.
