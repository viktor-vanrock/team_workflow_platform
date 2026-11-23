import { describe, expect, it } from "vitest";

import { pilotContentHash } from "../../../packages/platform-core/src/index.ts";
import { createSafeCapabilityProbe } from "../../../packages/runtime-composition/src/onboarding/capability-probes.ts";
import {
  decidePilotDegradation,
  type PilotCapabilityTarget,
  type PilotDegradationInput,
  type PilotDegradedAction,
  type PilotDependency,
  projectPilotCapability,
} from "../../../packages/runtime-composition/src/pilot/degradation-policy.ts";

const now = Date.parse("2026-09-04T10:00:00Z");
const ref = (id: string) => ({ id, version: 1, contentHash: `sha256:${"a".repeat(64)}` as const });
const target: PilotCapabilityTarget = {
  workspaceId: "workspace",
  projectId: "project",
  bindingRef: ref("binding"),
  profileRef: ref("profile"),
  connectionRef: ref("connection"),
  validationReportRef: ref("validation"),
  logicalRole: "SOURCE_CONTEXT",
  capabilityKey: "source-context.read",
  exactContractVersion: "1.0.0",
  operation: "build.read",
  environmentScope: "LOCAL",
};
const probe = (status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" = "AVAILABLE") =>
  createSafeCapabilityProbe({
    ...target,
    probeId: "probe",
    status,
    safeIssueCodes: status === "AVAILABLE" ? [] : ["PROVIDER_UNAVAILABLE"],
    observedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 60_000).toISOString(),
  });
const project = (value = probe(), time = now) =>
  projectPilotCapability({ target, probe: value, storedHash: value.contentHash, now: time });
const providers: PilotDependency[] = [
  "JIRA",
  "GITLAB",
  "MATTERMOST",
  "MODEL",
  "ARTIFACT_STORE",
  "OIDC",
];
const dependencies = () =>
  Object.fromEntries(
    providers.map((provider) => [provider, [project()]]),
  ) as PilotDegradationInput["dependencies"];
const decide = (action: PilotDegradedAction, extra: Partial<PilotDegradationInput> = {}) =>
  decidePilotDegradation({
    action,
    authorized: true,
    now,
    dependencies: dependencies(),
    requiredEvidenceComplete: true,
    ...extra,
  });

describe("008 per-capability freshness and degradation", () => {
  it("retains immutable Core observations and returns UNKNOWN for missing, stale and drifted pins", () => {
    const value = probe(),
      original = structuredClone(value);
    expect(project()).toMatchObject({ status: "AVAILABLE" });
    expect(project(value, now + 60_000)).toMatchObject({
      status: "UNKNOWN",
      reasonCodes: ["CAPABILITY_PROBE_EXPIRED"],
    });
    expect(projectPilotCapability({ target, now })).toMatchObject({
      status: "UNKNOWN",
      reasonCodes: ["CAPABILITY_PROBE_MISSING"],
    });
    for (const change of [
      { workspaceId: "other" },
      { projectId: "other" },
      { logicalRole: "OTHER" },
      { operation: "commit.read" },
      { exactContractVersion: "2.0.0" },
      { environmentScope: "NON_PROD" as const },
      { profileRef: ref("other") },
      { connectionRef: ref("other") },
      { bindingRef: { ...target.bindingRef, version: 2 } },
      { mappingRef: ref("mapping") },
      { validationReportRef: ref("other") },
    ]) {
      expect(
        projectPilotCapability({
          target: { ...target, ...change },
          probe: value,
          storedHash: value.contentHash,
          now,
        }).status,
      ).toBe("UNKNOWN");
    }
    expect(
      projectPilotCapability({
        target,
        probe: { ...value, status: "UNAVAILABLE" },
        storedHash: value.contentHash,
        now,
      }).status,
    ).toBe("UNKNOWN");
    expect(
      projectPilotCapability({
        target,
        probe: value,
        storedHash: value.contentHash,
        now: now + 1000,
        maximumAgeMs: 1000,
      }).status,
    ).toBe("UNKNOWN");
    expect(value).toEqual(original);
  });
  it("rejects future timestamps and unsafe diagnostics even when the row hash matches", () => {
    const value = probe();
    const { contentHash: originalHash, ...body } = value;
    expect(pilotContentHash(body)).toBe(originalHash);
    for (const changed of [
      { ...body, observedAt: new Date(now + 1000).toISOString() },
      { ...body, safeIssueCodes: ["SECRET https://provider.invalid"] },
      { ...body, safeIssueCodes: ["UNEXPLAINED_AVAILABLE"] },
      { ...body, actorKind: "HUMAN" },
    ]) {
      const contentHash = pilotContentHash(changed);
      expect(
        projectPilotCapability({
          target,
          probe: { ...changed, contentHash },
          storedHash: contentHash,
          now,
        }).status,
      ).toBe("UNKNOWN");
    }
  });
  it("implements all six outage rows without blocking independent manual/web actions", () => {
    const blocked: Record<PilotDependency, PilotDegradedAction[]> = {
      JIRA: ["JIRA_WRITE", "JIRA_FINAL_TRANSITION"],
      GITLAB: ["AUTOMATION_START", "AUTOMATION_RESULT"],
      MATTERMOST: ["CHAT_INTAKE", "CHAT_CONFIRM", "CHAT_NOTIFY"],
      MODEL: ["MODEL_RECOMMENDATION"],
      ARTIFACT_STORE: ["EVIDENCE_COMPLETE", "VERDICT_FINALIZE", "JIRA_FINAL_TRANSITION"],
      OIDC: ["OIDC_LOGIN", "OIDC_STEP_UP"],
    };
    for (const provider of providers)
      for (const status of ["DEGRADED", "UNAVAILABLE"] as const) {
        const facts = { ...dependencies(), [provider]: [project(probe(status))] };
        for (const action of blocked[provider])
          expect(decide(action, { dependencies: facts }).allowed).toBe(false);
        for (const action of [
          "DRAFT_INTAKE",
          "MANUAL_NOTE",
          "MANUAL_SESSION",
          "REVIEW_EVIDENCE",
          "DETERMINISTIC_FORM",
          "HUMAN_DECISION",
          "ARTIFACT_METADATA",
        ] as const)
          expect(decide(action, { dependencies: facts }).allowed).toBe(true);
        if (provider !== "JIRA")
          expect(decide("JIRA_WRITE", { dependencies: facts }).allowed).toBe(true);
      }
    expect(decide("CACHED_JIRA_READ", { dependencies: {} })).toMatchObject({
      allowed: true,
      stale: true,
    });
    expect(decide("MODEL_RECOMMENDATION", { dependencies: {} })).toMatchObject({
      allowed: false,
      recovery: "DETERMINISTIC_FALLBACK",
    });
  });
  it("requires a fresh positive probe to resume and rechecks expiry at admission", () => {
    expect(decide("AUTOMATION_START", { dependencies: {} }).allowed).toBe(false);
    expect(decide("AUTOMATION_START", { dependencies: { GITLAB: [] } }).allowed).toBe(false);
    expect(
      decide("AUTOMATION_START", {
        dependencies: { GITLAB: [project(), project(probe("UNAVAILABLE"))] },
      }).allowed,
    ).toBe(false);
    expect(decide("AUTOMATION_START", { now: now + 60_000 }).allowed).toBe(false);
    expect(decide("AUTOMATION_START").allowed).toBe(true);
    expect(decide("MANUAL_SESSION", { authorized: false }).allowed).toBe(false);
  });
  it("cannot complete required evidence or finalize a verdict using only metadata", () => {
    for (const action of [
      "EVIDENCE_COMPLETE",
      "VERDICT_FINALIZE",
      "JIRA_FINAL_TRANSITION",
    ] as const) {
      expect(decide(action, { requiredEvidenceComplete: false })).toMatchObject({
        allowed: false,
        reasonCodes: ["REQUIRED_EVIDENCE_INCOMPLETE"],
      });
      expect(decide(action).allowed).toBe(true);
    }
  });
  it("keeps only an authorized unrevoked short session alive during OIDC outage", () => {
    const session = {
      issuedAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 1000).toISOString(),
      maximumLifetimeMs: 60_000,
      revoked: false,
    };
    expect(decide("SESSION_CONTINUE", { dependencies: {}, session })).toMatchObject({
      allowed: true,
      reasonCodes: ["OIDC_UNAVAILABLE_EXISTING_SESSION"],
    });
    for (const change of [
      { revoked: true },
      { expiresAt: new Date(now).toISOString() },
      { expiresAt: "invalid" },
      { expiresAt: new Date(now + 60_001).toISOString() },
    ])
      expect(decide("SESSION_CONTINUE", { session: { ...session, ...change } }).allowed).toBe(
        false,
      );
    expect(decide("SESSION_CONTINUE", { authorized: false, session }).allowed).toBe(false);
  });
});
