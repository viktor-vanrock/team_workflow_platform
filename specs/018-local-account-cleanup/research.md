# Research

## Catalog boundaries

**Decision**: Remove both diagnostic human personas outright. Expose separate public HUMAN options and internal seed options including worker. Reject SERVICE human session exchange.
**Rationale**: All three seed loops currently use public options; filtering alone would remove required service grants on fresh deployment. API worker composition uses stable service identity directly. Fake IdP has a separate allowlist to update.
**Alternatives considered**: A runtime environment flag to restore test users adds unnecessary shipped authentication surface; hiding only the dropdown leaves usable credentials.

## Existing data

**Decision**: Generalize existing auditor retirement for two precise principal IDs. Append entitlement revocations, delete their role assignments/memberships, retain historical identities. Upgrade base seed to v5.
**Rationale**: Role keys reader/requester are shared by retained humans, so role-wide deletion is invalid. Existing seed CLI always applies base upgrades before pack seed markers.
**Alternatives considered**: Deleting identities risks history and FK loss; resetting volumes loses user data.

## Role scope

**Decision**: Document current model; do not introduce a global role.
**Rationale**: RoleAssignment requires workspaceId; ResourceScope is WORKSPACE or PROJECT; authorization requires matching active workspace membership. One Identity can have multiple memberships.
**Alternatives considered**: Inferring global powers from system-administrator label contradicts actual authorization.

## Regression fixtures

**Decision**: Use retained reader with disposable persisted classification constraints and real known user foreign-workspace denial. Update outdated human account matrix expectations to feature 017 grants.
**Rationale**: Unknown-persona rejection does not exercise workspace isolation. Worker remains covered by existing internal service tests.
**Research source**: Local code inspection and independent read-only Spec Kit research agent local_accounts_research. No new technology, network research or dependencies required.
