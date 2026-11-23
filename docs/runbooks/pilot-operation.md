# Limited pilot operation

This procedure controls one named Project through baseline, shadow, limited writes,
incident suspension and formal review. The Project onboarding aggregate remains the
authority for activation, suspension and resume. A pilot report cannot activate a
Project or authorize product release.

## Roles and immutable inputs

The QA Lead owns the measurement definitions, sample rules and spot checks. The
pilot sponsor owns the cohort and final business decision. The Workspace Owner
approves the existing `ONBOARDING_PILOT_ACTIVATE` action. The integration
administrator initiates that action, and must be a different human. On-call owns
incident response and the rollback operator owns the compatible deployment target.

Before shadow starts, publish one cohort revision containing exactly one Project,
named participants, channels, approved environment and suites, start/end times,
on-call and rollback references. Publish the current-process baseline before any
numeric target. QA Lead and sponsor then attest the comparison protocol, its minimum
sample and targets. Their attestations bind the exact unsigned protocol hash.

## Shadow

1. Verify current C1, N2, security, recovery, cohort and baseline-protocol evidence.
2. Set the pilot fence to `SHADOW`. Jira, GitLab and Mattermost business writes must
   remain denied. Sandbox conformance uses its own `SANDBOX_CONFORMANCE` scope.
3. Record local proposals and their differences from current-process decisions.
   A shadow draft cannot become an accepted Work Item. Shadow notification records
   remain permanently suppressed and cannot be released as an activation backlog.
4. Count provider writes independently. The required result is zero. Record the
   human reviewer and the exact difference report hash.

## Activation and dispatch

Create and approve the canonical existing `ONBOARDING_PILOT_ACTIVATE` action. Do
not create a second command or a bypass route. The action pins the current onboarding
revision, deployment/configuration, cohort, gates, bindings and comparison protocol.
The consuming transaction takes locks in this order: Workspace rollout domain,
Project onboarding, binding, action and approval. It acquires the durable rollout
lease, consumes the exact approval, appends the onboarding revision, audit and
outbox atomically. A failed commit leaves all of them unchanged.

Every worker invocation rechecks the exact cohort hash, Project, participant,
channel, environment, onboarding `PILOT_ACTIVE` state, operational `ACTIVE` state,
current configuration and half-open window `[startAt,endAt)`. Cohort membership only
narrows existing permissions. It never grants a role or entitlement.

## Incident, expiry and rollback

Window expiry, cohort revocation, configuration drift or Project suspension blocks
new provider effects and retries. Continue read-only reconciliation for already
invoked requests; never assume that suspension retracts a remote write.

Any measured non-negotiable guardrail breach immediately stops expansion, creates
an incident and invokes the existing Project suspension and effect fence. Unknown
measurements remain `UNKNOWN` and block a complete review. Preserve command/effect
identity, audit, evidence and provider readback for investigation.

Rollback uses an image and schema reader compatible with the current expanded
schema. Do not run destructive down migrations. Keep the failed/new runtime fenced,
deploy the compatible target, verify current bindings and read-only reconciliation,
then request resume. Resume requires a separate exact human approval, accepted
incident disposition, fresh probes and current rights; the original activation
approval cannot be reused.

## Observation and review

The observation worker runs only after the real calendar window has elapsed. It
loads source-owned facts: Core queue/WIP/SLA/calendar facts, QA Session/Attempt/
rework facts and connector reliability. It never recalculates the Core 006 SLA
clock. Preserve sample membership, denominators, excluded and censored reasons,
source hashes, incidents, operator load, limitations and residual risks. Count
external writes and duplicates from the provider-side or another independent sink.

If the minimum sample, any required metric, any guardrail, independent write count
or operator-load observation is missing, publish `INSUFFICIENT_DATA`. A breach
forces `STOP`. Otherwise QA Lead and sponsor may record `CONTINUE`, `ADJUST` or
`STOP` against the exact immutable report. Expansion requires a new cohort revision
that adds one Project, fresh evidence and a new activation action for that Project.
