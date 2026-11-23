import {
  type CapabilityProbeResult,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  samePilotRef,
} from "@awp/platform-core";

export type PilotCapabilityTarget = Pick<
  CapabilityProbeResult,
  | "workspaceId"
  | "projectId"
  | "bindingRef"
  | "profileRef"
  | "connectionRef"
  | "mappingRef"
  | "validationReportRef"
  | "logicalRole"
  | "capabilityKey"
  | "exactContractVersion"
  | "operation"
  | "environmentScope"
>;
export interface PilotCapabilityProjection {
  readonly status: CapabilityProbeResult["status"] | "UNKNOWN";
  readonly reasonCodes: readonly string[];
  readonly probeRef?: ExactRevisionRef;
  readonly observedAt?: string;
  readonly validUntil?: string;
}

/** Projection of the latest Core probe for the current exact target. Never changes persisted mode. */
export function projectPilotCapability(
  input: Readonly<{
    target: PilotCapabilityTarget;
    probe?: unknown;
    storedHash?: string;
    now: number;
    maximumAgeMs?: number;
  }>,
): PilotCapabilityProjection {
  const unknown = (code: string): PilotCapabilityProjection =>
    Object.freeze({ status: "UNKNOWN", reasonCodes: Object.freeze([code]) });
  if (input.probe === undefined) return unknown("CAPABILITY_PROBE_MISSING");
  try {
    const p = input.probe as CapabilityProbeResult,
      target = input.target;
    const { contentHash, ...body } = p;
    if (
      !p.probeId ||
      p.version !== 1 ||
      p.actorKind !== "SERVICE" ||
      contentHash !== input.storedHash ||
      pilotContentHash(body) !== contentHash ||
      p.workspaceId !== target.workspaceId ||
      p.projectId !== target.projectId ||
      !samePilotRef(p.bindingRef, target.bindingRef) ||
      !samePilotRef(p.profileRef, target.profileRef) ||
      !samePilotRef(p.connectionRef, target.connectionRef) ||
      !samePilotRef(p.validationReportRef, target.validationReportRef) ||
      !(
        (p.mappingRef === undefined && target.mappingRef === undefined) ||
        samePilotRef(p.mappingRef, target.mappingRef)
      ) ||
      p.logicalRole !== target.logicalRole ||
      p.capabilityKey !== target.capabilityKey ||
      p.exactContractVersion !== target.exactContractVersion ||
      p.operation !== target.operation ||
      p.environmentScope !== target.environmentScope ||
      !["AVAILABLE", "DEGRADED", "UNAVAILABLE"].includes(p.status) ||
      !Array.isArray(p.safeIssueCodes) ||
      p.safeIssueCodes.length > 20 ||
      p.safeIssueCodes.some(
        (code) => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,95}$/u.test(code),
      ) ||
      (p.status === "AVAILABLE" && p.safeIssueCodes.length > 0)
    )
      return unknown("CAPABILITY_PROBE_UNVERIFIED");
    const observed = Date.parse(p.observedAt),
      expires = Date.parse(p.validUntil);
    if (
      !Number.isFinite(input.now) ||
      (input.maximumAgeMs !== undefined &&
        (!Number.isSafeInteger(input.maximumAgeMs) || input.maximumAgeMs < 1))
    )
      return unknown("CAPABILITY_FRESHNESS_POLICY_INVALID");
    const until = Math.min(expires, observed + (input.maximumAgeMs ?? Infinity));
    const fresh =
      Number.isFinite(observed) &&
      Number.isFinite(expires) &&
      observed <= input.now &&
      expires > observed &&
      until > input.now;
    return freezePilotValue({
      status: fresh ? p.status : "UNKNOWN",
      reasonCodes: fresh
        ? [...(p.safeIssueCodes as readonly string[])]
        : ["CAPABILITY_PROBE_EXPIRED"],
      probeRef: { id: p.probeId, version: p.version, contentHash },
      observedAt: p.observedAt,
      validUntil: new Date(Number.isFinite(until) ? until : 0).toISOString(),
    });
  } catch {
    return unknown("CAPABILITY_PROBE_UNVERIFIED");
  }
}

export type PilotDependency =
  "JIRA" | "GITLAB" | "MATTERMOST" | "MODEL" | "ARTIFACT_STORE" | "OIDC";
const requirements = {
  DRAFT_INTAKE: [],
  CACHED_JIRA_READ: [],
  MANUAL_NOTE: [],
  MANUAL_SESSION: [],
  REVIEW_EVIDENCE: [],
  JIRA_WRITE: ["JIRA"],
  JIRA_FINAL_TRANSITION: ["JIRA", "ARTIFACT_STORE"],
  AUTOMATION_START: ["GITLAB"],
  AUTOMATION_RESULT: ["GITLAB"],
  CHAT_INTAKE: ["MATTERMOST"],
  CHAT_CONFIRM: ["MATTERMOST"],
  CHAT_NOTIFY: ["MATTERMOST"],
  DETERMINISTIC_FORM: [],
  HUMAN_DECISION: [],
  MODEL_RECOMMENDATION: ["MODEL"],
  ARTIFACT_METADATA: [],
  EVIDENCE_COMPLETE: ["ARTIFACT_STORE"],
  VERDICT_FINALIZE: ["ARTIFACT_STORE"],
  OIDC_LOGIN: ["OIDC"],
  OIDC_STEP_UP: ["OIDC"],
  SESSION_CONTINUE: [],
} as const satisfies Record<string, readonly PilotDependency[]>;
export type PilotDegradedAction = keyof typeof requirements;
export interface PilotDegradationInput {
  readonly action: PilotDegradedAction;
  /** Existing project/session authorization must already be resolved by the host. */
  readonly authorized: boolean;
  readonly now: number;
  /** All required exact operation probes for each dependency; empty means unknown. */
  readonly dependencies: Partial<
    Readonly<Record<PilotDependency, readonly PilotCapabilityProjection[]>>
  >;
  /** Derived from authoritative evidence inventory, never a client assertion. */
  readonly requiredEvidenceComplete?: boolean;
  readonly session?: Readonly<{
    issuedAt: string;
    expiresAt: string;
    maximumLifetimeMs: number;
    revoked: boolean;
  }>;
}
export interface PilotDegradationDecision {
  readonly allowed: boolean;
  readonly stale: boolean;
  readonly reasonCodes: readonly string[];
  readonly recovery:
    "NONE" | "FRESH_PROBE" | "DETERMINISTIC_FALLBACK" | "REQUIRED_EVIDENCE" | "AUTHENTICATE";
}

/** Admission is per action. An outage cannot globally disable unrelated manual/web work. */
export function decidePilotDegradation(input: PilotDegradationInput): PilotDegradationDecision {
  const result = (
    allowed: boolean,
    codes: readonly string[],
    recovery: PilotDegradationDecision["recovery"] = "NONE",
    stale = false,
  ): PilotDegradationDecision =>
    freezePilotValue({ allowed, stale, reasonCodes: [...codes], recovery });
  if (
    !input.authorized ||
    !Number.isFinite(input.now) ||
    !Object.hasOwn(requirements, input.action)
  )
    return result(false, ["PILOT_ACTION_DENIED"]);
  const available = (dependency: PilotDependency): boolean => {
    const probes = input.dependencies[dependency];
    return (
      !!probes?.length &&
      probes.every(
        (probe) =>
          probe.status === "AVAILABLE" &&
          probe.reasonCodes.length === 0 &&
          probe.probeRef &&
          probe.observedAt &&
          probe.validUntil &&
          Date.parse(probe.observedAt) <= input.now &&
          Date.parse(probe.validUntil) > input.now,
      )
    );
  };
  if (input.action === "SESSION_CONTINUE") {
    const s = input.session;
    if (
      !s ||
      s.revoked ||
      !Number.isSafeInteger(s.maximumLifetimeMs) ||
      s.maximumLifetimeMs < 1 ||
      s.maximumLifetimeMs > 3_600_000 ||
      !Number.isFinite(Date.parse(s.issuedAt)) ||
      Date.parse(s.issuedAt) > input.now ||
      Date.parse(s.expiresAt) <= input.now ||
      !Number.isFinite(Date.parse(s.expiresAt)) ||
      Date.parse(s.expiresAt) - Date.parse(s.issuedAt) > s.maximumLifetimeMs
    )
      return result(false, ["SESSION_EXPIRED_OR_REVOKED"], "AUTHENTICATE");
    return result(true, available("OIDC") ? [] : ["OIDC_UNAVAILABLE_EXISTING_SESSION"]);
  }
  if (
    ["EVIDENCE_COMPLETE", "VERDICT_FINALIZE", "JIRA_FINAL_TRANSITION"].includes(input.action) &&
    input.requiredEvidenceComplete !== true
  )
    return result(false, ["REQUIRED_EVIDENCE_INCOMPLETE"], "REQUIRED_EVIDENCE");
  const missing = requirements[input.action].filter((dependency) => !available(dependency));
  if (missing.length)
    return result(
      false,
      missing.map((dependency) => `${dependency}_CAPABILITY_UNAVAILABLE`),
      input.action === "MODEL_RECOMMENDATION" ? "DETERMINISTIC_FALLBACK" : "FRESH_PROBE",
    );
  if (input.action === "CACHED_JIRA_READ" && !available("JIRA"))
    return result(true, ["JIRA_CACHED_STATE_STALE"], "NONE", true);
  if (["DETERMINISTIC_FORM", "HUMAN_DECISION"].includes(input.action) && !available("MODEL"))
    return result(true, ["MODEL_UNAVAILABLE_DETERMINISTIC_FALLBACK"], "DETERMINISTIC_FALLBACK");
  return result(true, []);
}
