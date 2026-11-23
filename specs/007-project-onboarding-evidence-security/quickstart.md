# Quickstart: Feature 007 local acceptance

This guide defines the runnable target for implementing Feature 007. It reuses the
existing `qa-jira-gitlab-mattermost-local` contour and deterministic identities;
it does not require corporate endpoints, credentials or production access.

## 1. Prerequisites

From the repository root:

```bash
corepack enable
pnpm prerequisites
pnpm install --frozen-lockfile
pnpm verify:007:prerequisites
```

`verify:007:prerequisites` must bind its PASS report to the current source,
contract and migration digests. It rejects a stale copied Feature 006 report.

Expected local versions are Node.js `24.20.x`, pnpm `11.21.x`, Docker with Compose,
and free ports required by the existing local contour.

## 2. Start the local contour

The implementation adds Feature 007 aliases around the existing composition:

```bash
pnpm local:onboarding:up
pnpm local:onboarding:migrate
pnpm local:onboarding:seed
pnpm local:onboarding:status
```

The seed is deterministic and creates:

- one Workspace;
- two visible Projects and one forbidden Project;
- Integration Administrator, Workspace Owner, QA Lead, QA Engineer and service
  principals with intentionally different entitlements/classification ceilings;
- published local Jira, GitLab and Mattermost Connection/Mapping/Profile revisions;
- a local evidence-signing policy and Ed25519 key pair with an immutable public-key
  version; private key material stays in the runtime secret adapter;
- non-production environment, test-data and account-pool references with no raw
  credentials or test data.

The status command must report container health, migration heads, mock-hub effect
count and current onboarding stage/mode/state for each authorized Project. It must
not print credentials, tokens, cookies, raw evidence or signed URLs.

## 3. Run the acceptance scenarios

List the exact scenario catalog:

```bash
pnpm onboarding:scenario -- list
```

### Manual-only onboarding

```bash
pnpm onboarding:scenario -- run manual-only-onboarding
```

Expected result: Project reaches `SHADOW / MANUAL_ONLY / ACTIVE`; a manual Session
can start, an automated Session is denied, Jira remains operational authority and
all exact refs/hashes resolve.

### Full-QA promotion

```bash
pnpm onboarding:scenario -- run full-qa-promotion
```

Expected result: mandatory Jira/GitLab probes and QA Lead functional acceptance
pass; a distinct Workspace Owner approval is consumed once; Project reaches
`SHADOW / FULL_QA / ACTIVE`; one automated local Session completes. Earlier
Sessions keep their original target snapshot.

### Cross-Project default deny

```bash
pnpm onboarding:scenario -- run cross-project-deny
```

Expected result: list, direct URL, API lookup, queue, search, event subscription,
artifact read and evidence export expose only authorized Projects. Missing and
forbidden resources have the same public response. Revocation is visible on the
next authorization check and no aggregate leaks a hidden Project count.

### Evidence revision and retention

```bash
pnpm onboarding:scenario -- run evidence-revision-retention
```

Expected result: a v2 manifest is JCS-hashed, signed as detached EdDSA JWS and
verified against the pinned public-key version. Correction appends revision 2 and
does not alter revision 1. Artifact expiry changes availability metadata while the
signed manifest, checksum and audit lineage remain verifiable. A v1 fixture is
reported as `LEGACY_INTEGRITY_ONLY`.

### Emergency suspension and approved resume

```bash
pnpm onboarding:scenario -- run emergency-suspend-resume
```

Expected result: suspension between intent creation and connector invocation
causes zero new external effects, Sessions or leases. Authorized investigation and
signature verification remain available. Resume fails without incident
disposition, fresh probes and a distinct exact Owner approval, then succeeds once.

## 4. Verify each layer independently

```bash
pnpm test:contract:007
pnpm test:unit:007
pnpm test:architecture:007
pnpm test:integration:007
pnpm test:security:007
pnpm test:concurrency:007
pnpm test:recovery:007
pnpm test:e2e:007
pnpm test:browser:007
pnpm verify:007:migrations
pnpm smoke:007
pnpm trace:007
```

Migration verification covers PostgreSQL 17 and 18 fresh install, `006 → 007`
upgrade, repeat, current-minus-one recovery and partial-failure recovery. Contract
verification byte-pins all previously published v1 schemas and rejects unknown
fields, secrets and product-production scopes.

The final source-bound gate is:

```bash
pnpm verify:007
```

It must aggregate contract, architecture, unit, integration, security,
concurrency, recovery, migration, browser, smoke and traceability reports and
finish with a fresh `PASS`. Feature 008 may consume only this bound report.

## 5. Optional deployment-input check

```bash
pnpm onboarding:inputs -- validate --file ./pilot-inputs.json
```

This validates shape and safe references only; the file must not contain secret
values. With no corporate input file, L0 remains fully runnable while C1/N2/P3
report `BLOCKED_INPUT` and external checks report `SKIPPED_GATED`. That is an
expected Feature 007 result, not a local failure.

## 6. Stop and clean the contour

```bash
pnpm local:onboarding:down
```

The command removes only Feature 007 local containers and volumes through the
existing safe local-composition cleanup path.

## Implementation status (2026-09-03)

All commands in this guide are wired and were executed with Node.js 24.20.0 and
pnpm 11.21.0. The isolated local contour reached healthy API, worker, web,
PostgreSQL, Redis, Mock Hub, S3 mock and fake-IdP states; repeated migrate and
seed completed successfully; status reported Core 160, QA 2085, Jira 3040 and
GitLab 4020 heads without secret output; all five scenarios, layer suites,
PostgreSQL 17/18 migration matrix, Chromium journey and restart smoke passed.
Missing `pilot-inputs.json` produced the documented `BLOCKED_INPUT` and
`SKIPPED_GATED` outcomes. Shutdown removed only the isolated contour and its
named volumes. The source-bound `verify:007`/`ci:007` result remains the release
authority and regenerates these reports from the exact final source digest.
