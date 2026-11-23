# Feature 008: development contour

This contour runs the complete local QA/Jira/GitLab/Mattermost API and worker with
PostgreSQL, fake IdP, Mock Hub and OpenTelemetry Collector. External
corporate dependencies are explicitly replaced with development adapters. It does
not require production access or produce C1/N2/P3 conformance evidence.

## Start and use

From the repository root, with Node 24.20.0, pnpm 11.21.0 and Docker available:

```sh
pnpm dev:pilot:up
pnpm dev:pilot:status
```

Before any browser smoke on a fresh database or the first Core 230 upgrade,
open <http://localhost:55173> and complete the first login as the designated local
administrator. Any successful HUMAN persona exchange can claim this one-time role;
restarts and seed do not reassign it. See [upgrade instructions](../deployment/upgrade-and-verification.md).

For a QA request, choose **«Заказчик»** and select **«Начать работу»**. In
**«Новый запрос»**, select an allowed project, create a draft with **«Проверить запрос»**
and confirm it with **«Отправить запрос»**. The API records a durable command; the worker creates the request in
the Jira emulator. Confirming the same draft again reuses its command and effect.
Use the seeded Executor and QA Lead personas for their respective QA operations.

| Service                    | Development address                |
| -------------------------- | ---------------------------------- |
| Web                        | http://localhost:55173             |
| API / readiness            | http://localhost:5300/health/ready |
| Worker readiness           | http://localhost:5310/health/ready |
| Mock Hub                   | http://localhost:54010             |
| Fake IdP                   | https://localhost:54443            |
| Collector OTLP HTTP / gRPC | localhost:54318 / localhost:54317  |

The Compose project is `awp-local-pilot-dev`; published ports bind to loopback and
the service network denies external egress. `dev:pilot:up` builds the application image,
applies additive migrations and seeds fixtures. Repeated starts preserve data and
existing onboarding versions, including suspended projects. Fresh dev projects
receive the conservative DRAFT/MANUAL_ONLY baseline, without readiness or pilot gates.

```sh
pnpm dev:pilot -- up --plan
pnpm dev:pilot -- logs
pnpm dev:pilot:down
```

`down` stops this development project and preserves its volumes. The development
launcher intentionally has no reset command. Conflicting runtime/environment
settings fail instead of mixing development adapters with a corporate profile.

The UI also includes a workspace-wide QA queue, project creation/editing, customer
project dialogues, platform access administration and a separate local technical-writing
workspace. See the [current user guide](../user-guide/README.md). Customer access is
project-specific; an old workspace-wide requester role no longer opens every project.

## Adapters and failures

Identity uses fake IdP and seeded personas; secret resolution stays local and
scoped; signatures use the local Ed25519 signer; Jira, GitLab and Mattermost use
their stateful HTTP emulators; model behavior is deterministic. Manual evidence is
metadata-only and CI artifact bytes remain owned by GitLab.
These adapters are explicitly development-only. Real protocol, rotation, outage,
isolation and PKCE behavior is additionally exercised with controlled fixtures in
the US1 prerequisite suite.

The capability maintenance worker discovers current published plans from the DB,
checks project registration and exact current pins, calls Mock Hub, and persists
immutable observations plus assessments. It refreshes after 30 seconds; freshness
expires after 90 seconds. Missing plans produce no fabricated success. Observations
do not activate a project or promote its capability mode.

For published development plans, the capability emulator accepts a controlled
fault through `POST /mock/pilot/capabilities/fault` with JSON status `AVAILABLE`,
`DEGRADED` or `UNAVAILABLE` and header
`x-awp-mock-control-key: local-gitlab-control`. This is a public fixture key, not a
corporate credential. `GET /mock/pilot/capabilities/state` with the same header
returns probe call counts. The endpoints reject non-LOCAL subjects and are disabled
unless `AWP_PILOT_ADAPTER_MODE=development` is set.

The runtime retry policy stops authentication, permission, conflict, business and
unclassified failures. GitLab authoritative reads persist a budget of four total
attempts per original outbox item and a five-minute recovery window. Backoff never
shortens `Retry-After`; a hint beyond the 30-second scheduling budget stops the
operation. Invalid hints also stop it. Restart does not reset attempts, and a
successful unrelated read cannot bypass the original item's backoff.

Capability freshness uses the exact current Core binding/profile/connection,
mapping, validation report, logical role, contract version and operation. Missing,
expired or mismatched probes remain UNKNOWN. Admission applies to each action:
manual notes, draft intake, deterministic forms, metadata capture and review remain
available during unrelated provider outages; cache reads show staleness. New
automation requires fresh positive observations. Required evidence remains a gate
for evidence completion and verdict finalization. Existing authorized short
sessions can continue during OIDC outage only until their original expiry.

Mattermost notification projection persists SHADOW decisions as terminal ledger
entries and creates no command/outbox delivery. Re-projecting that source event
after restart cannot turn it into a backlog. Expired intents fail before invocation.
The command marker and notification marker commit together, as do their final
results. Lost POST responses use fenced, read-only reconciliation of the original
marker and channel; zero, multiple or mismatched results become AMBIGUOUS. Readback
uses at most four attempts and never creates a replacement POST. The development
lookup endpoint is an emulator protocol; installed corporate readback dialect
selection is still tracked separately by US2 conformance tasks.

Jira request creation now records an immutable invocation timestamp in its existing
effect ledger before the HTTP POST. An empty Cloud/DC search after invocation is
an uncertain result, even when search pagination is complete. It becomes AMBIGUOUS
and cannot create a second issue; two calls using the same worker claim also cannot
send two POSTs. Exact marker readback can confirm the original issue. Migration
3050 conservatively marks legacy non-NOT_STARTED rows as possibly invoked because
older recovery code could erase the distinction. Such rows may require investigation;
do not clear their marker or replace their effect key to force a retry.

GitLab command and provider invocation markers commit together. Readback uses the
original ref/SHA/marker/window and the Core execution lease; concurrent workers do
not both perform the lookup. Provider receipt hashes, actual SHA, identity and times
are checked before confirmation. The command, QA receipt and provider ledger commit
together, so a database failure can be recovered by another read without a new POST.
Zero matches may wait within the configured consistency window. Multiple matches,
invalid receipts, or unavailable/empty lookup after that window become AMBIGUOUS.
Unavailable lookup is not recorded as a fabricated zero-match observation.

The shared expired-command recovery query excludes already invoked LOOKUP_REQUIRED
and NONE_AMBIGUOUS commands before taking row locks. Their connector-specific
reconcilers own recovery. This prevents the shared scanner from conflicting with a
concurrent readback confirmation under PostgreSQL serializable isolation.

## Selected provider ingress

The explicit `ProviderIngressModule` supports native Jira/GitLab receivers and
separate authenticated gateway/receiver deployments. Configuration and host
requirements are in `config/pilot/ingress-policy.md`, with a development example
in `config/pilot/ingress-policy.example.json`. The example does not enable routes.
API and worker entry points assemble the complete selected local composition; the
published composition uses separately validated corporate bindings.

Jira body HMAC requires a signed body timestamp and exact project. GitLab requires
Standard Webhooks signatures over ID, timestamp and raw bytes. Mattermost requires
an actual pinned, CA-verified client certificate at the gateway plus a persisted
opaque intent bound to the exact human, team/channel and action. A forwarded
certificate header cannot authenticate the original source. The receiving runtime
checks current configuration and original freshness again inside the receipt
transaction. A fresh proxy signature cannot revive an expired intent.

Core receipts and read/intent hints commit atomically. Concurrent duplicates and
restart return the same receipt; changed bytes under the same delivery identity
are rejected. The raw Jira body hash prevents a changed unsigned delivery header
from creating another event. Mattermost intent consumption rolls back with a
failed outbox write, and callback tokens are omitted from receipts and statements.
Current human and service rights are required host ports; controlled fixture
authorities are used only in the development tests.

The focused suite covers 6 contract cases plus 14 HTTP/PostgreSQL/mTLS cases across
PostgreSQL 17.7 and 18.6:

```sh
AWP_RUN_CONTAINER_TESTS=true node node_modules/vitest/vitest.mjs run --config vitest.workspace.ts tests/contract/008/provider-ingress.spec.ts tests/integration/008/provider-ingress.spec.ts --maxWorkers=1
```

These tests verify the selected adapters with explicit mock conformance records.
Installed provider evidence is still required to enable corporate bindings.

## Verification and status

With the dev stack running:

```sh
node tools/smoke/008-development.mts
pnpm dev:pilot:down
pnpm verify:008:foundation
pnpm verify:008:compatibility
pnpm verify:008:migrations
pnpm verify:008:quickstart
pnpm smoke:008
pnpm ci:008
```

The full Foundation suite creates disposable database/Collector containers. Stop
the dev contour for that run to free Docker memory, then bring it back before US1;
the named volumes preserve the application data.

The smoke uses Chromium to log in, create a QA draft and confirm it twice. It
independently queries the Jira emulator's write log and requires one create POST,
then checks actual Collector trace/metric reception. Each run adds one synthetic QA
request to the development data.

Foundation includes actual API/worker entry points and probe persistence on
PostgreSQL 17 and 18, security/identity/signing/storage/telemetry tests, browser
correlation, compatibility checks, types, schema registry, architecture and lint.
US1 requires that exact successful report with matching source fingerprints and an
age of at most one hour, then runs the development smoke. Any source change requires
a new Foundation run. Reports live under `reports/008-pilot-hardening-and-conformance`.
Local PASS never changes `corporateReady: false` or satisfies corporate gates.

The complete local engineering contour, US1–US5 and aggregate are implemented.
Real C1 metadata, N2 provider conformance, release scan, corporate recovery drill,
shadow run and observed limited-pilot review remain separate external evidence
requirements and are reported as `BLOCKED_INPUT` when absent.
