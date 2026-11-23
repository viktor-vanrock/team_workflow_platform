export interface PilotSelection {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly deploymentId: string;
}
export interface PilotSession {
  readonly principalId: string;
  readonly subject: string;
  readonly csrfToken: string;
  readonly expiresAt: string;
}
export interface PilotReference {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
}
export type PilotCheckStatus = "PASS" | "FAIL" | "BLOCKED_INPUT";
export interface PilotReadinessView {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly deploymentRef: PilotReference;
  readonly deploymentProfile: "local" | "integration" | "pilot";
  readonly gateReady: boolean;
  readonly engineeringReady: boolean;
  readonly corporateGatesReady: boolean;
  readonly evaluatedAt: string;
  readonly gates: readonly {
    kind: "L0" | "C1" | "N2" | "P3";
    status: PilotCheckStatus;
    reasonCodes: readonly string[];
    validUntil?: string;
  }[];
  readonly inputs: {
    entries: readonly {
      id: string;
      ownerRole: string;
      status: PilotCheckStatus;
      reasonCodes: readonly string[];
    }[];
    reasonCodes?: readonly string[];
    validUntil?: string;
  };
}
export interface PilotHealthView {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectState: string;
  readonly onboardingState: string;
  readonly stage: string;
  readonly capabilityMode: string;
  readonly evaluatedAt: string;
  readonly reasonCodes: readonly string[];
  readonly capabilities: readonly {
    bindingRef: PilotReference;
    requirementKey: string;
    logicalRole: string;
    capabilityKey: string;
    operation: string;
    status: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
    reasonCodes: readonly string[];
    observedAt?: string;
    validUntil?: string;
  }[];
}
export interface PilotRecoveryView {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly evaluatedAt: string;
  readonly drills: readonly {
    readonly recoveryId: string;
    readonly stage: string;
    readonly status: string;
    readonly faultDeclaredAt: string | null;
    readonly serviceRestoredAt: string | null;
    readonly rpoObservedSeconds: number | null;
    readonly rtoObservedSeconds: number | null;
    readonly unresolvedEffects: readonly string[];
  }[];
  readonly uncertainEffects: readonly {
    readonly commandId: string;
    readonly certainty: string;
    readonly reasonCode: string;
    readonly attemptCount: number;
    readonly replayCount: number;
  }[];
  readonly nextCursor?: string;
}
export interface PilotRunView {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stage: "PREPARING" | "SHADOW" | "LIMITED" | "REVIEW" | "STOPPED" | "CLOSED";
  readonly cohort: {
    readonly version: number;
    readonly projectIds: readonly string[];
    readonly userCount: number;
    readonly channelCount: number;
    readonly startAt: string;
    readonly endAt: string;
    readonly state: "CURRENT" | "REVOKED";
  };
  readonly baseline: {
    readonly status: "MISSING" | "CURRENT";
    readonly sampleSize: number;
    readonly contentHash?: string;
  };
  readonly metrics: readonly {
    readonly key: string;
    readonly value: number | null;
    readonly denominator: number;
    readonly missingCount: number;
    readonly excludedCount: number;
    readonly censoredCount: number;
  }[];
  readonly guardrails: readonly {
    readonly key: string;
    readonly state: "PASS" | "BREACH" | "UNKNOWN";
  }[];
  readonly externalEffects: {
    readonly writes: number | null;
    readonly duplicates: number | null;
    readonly source: "INDEPENDENT" | "UNAVAILABLE";
  };
  readonly incidents: readonly string[];
  readonly review: { readonly recommendation: string; readonly decidedAt?: string } | null;
  readonly evaluatedAt: string;
}
export type PilotClientErrorCode =
  | "PILOT_LOGIN_REQUIRED"
  | "PILOT_ACCESS_DENIED"
  | "PILOT_RESOURCE_MISSING"
  | "PILOT_UNAVAILABLE"
  | "PILOT_RESPONSE_INVALID"
  | "PILOT_SCOPE_INVALID";
export class PilotClientError extends Error {
  constructor(readonly code: PilotClientErrorCode) {
    super(code);
  }
}
const invalid = () => new PilotClientError("PILOT_RESPONSE_INVALID");
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
};
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 255;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const codes = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length <= 20 &&
  value.every((code) => typeof code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/u.test(code));
const optionalTime = (value: unknown): boolean => value === undefined || timestamp(value);
const reference = (value: unknown): boolean => {
  const ref = object(value);
  return (
    text(ref.id) &&
    Number.isSafeInteger(ref.version) &&
    Number(ref.version) > 0 &&
    typeof ref.contentHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(ref.contentHash)
  );
};
const checkStatus = (value: unknown): boolean =>
  ["PASS", "FAIL", "BLOCKED_INPUT"].includes(String(value));
const sameScope = (value: Record<string, unknown>, scope: PilotSelection) =>
  value.workspaceId === scope.workspaceId &&
  value.projectId === scope.projectId &&
  timestamp(value.evaluatedAt);
export function validPilotSelection(scope: PilotSelection): boolean {
  return (
    Object.values(scope).length === 3 &&
    [scope.workspaceId, scope.projectId, scope.deploymentId].every((value) =>
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value),
    )
  );
}

/** Same-origin BFF only. Provider credentials never enter browser state or storage. */
export class PilotBrowserClient {
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  protected async request(
    path: string,
    signal?: AbortSignal,
    init: RequestInit = {},
  ): Promise<unknown> {
    const deadline = AbortSignal.timeout(35_000);
    let response: Response;
    try {
      response = await this.fetcher(path, {
        ...init,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
    } catch {
      throw new PilotClientError("PILOT_UNAVAILABLE");
    }
    if (!response.ok)
      throw new PilotClientError(
        response.status === 401
          ? "PILOT_LOGIN_REQUIRED"
          : response.status === 403
            ? "PILOT_ACCESS_DENIED"
            : response.status === 404
              ? "PILOT_RESOURCE_MISSING"
              : "PILOT_UNAVAILABLE",
      );
    if (response.status === 204) return undefined;
    try {
      return (await response.json()) as unknown;
    } catch {
      throw invalid();
    }
  }
  async session(signal?: AbortSignal): Promise<PilotSession | undefined> {
    let value: unknown;
    try {
      value = await this.request("/api/v1/auth/session", signal);
    } catch (error) {
      if (error instanceof PilotClientError && error.code === "PILOT_LOGIN_REQUIRED")
        return undefined;
      throw error;
    }
    const body = object(value);
    if (
      !text(body.principalId) ||
      !text(body.subject) ||
      typeof body.csrfToken !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(body.csrfToken) ||
      !timestamp(body.expiresAt)
    )
      throw invalid();
    if (Date.parse(body.expiresAt) <= Date.now()) return undefined;
    return {
      principalId: body.principalId,
      subject: body.subject,
      csrfToken: body.csrfToken,
      expiresAt: body.expiresAt,
    };
  }
  async beginLogin(returnPath: string, csrfToken?: string, signal?: AbortSignal): Promise<string> {
    if (!/^\/(?!\/)[a-zA-Z0-9/_-]*$/u.test(returnPath))
      throw new PilotClientError("PILOT_SCOPE_INVALID");
    const body = object(
      await this.request("/api/v1/auth/login", signal, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ returnPath, ...(csrfToken ? { stepUp: true } : {}) }),
      }),
    );
    if (typeof body.authorizationUrl !== "string") throw invalid();
    let url: URL;
    try {
      url = new URL(body.authorizationUrl);
    } catch {
      throw invalid();
    }
    const loopback = (host: string) =>
      host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    const localFixture =
      typeof window !== "undefined" &&
      window.location.protocol === "http:" &&
      loopback(window.location.hostname) &&
      url.protocol === "http:" &&
      loopback(url.hostname);
    if (url.username || url.password || url.hash || (url.protocol !== "https:" && !localFixture))
      throw invalid();
    return url.href;
  }
  async logout(csrfToken: string, signal?: AbortSignal): Promise<void> {
    await this.request("/api/v1/auth/logout", signal, {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
    });
  }
  private path(scope: PilotSelection): string {
    if (!validPilotSelection(scope)) throw new PilotClientError("PILOT_SCOPE_INVALID");
    return `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot`;
  }
  async health(scope: PilotSelection, signal?: AbortSignal): Promise<PilotHealthView> {
    const body = object(await this.request(`${this.path(scope)}/health`, signal));
    if (
      !sameScope(body, scope) ||
      ![body.projectState, body.onboardingState, body.stage, body.capabilityMode].every(text) ||
      !codes(body.reasonCodes) ||
      !Array.isArray(body.capabilities) ||
      body.capabilities.length > 200
    )
      throw invalid();
    for (const raw of body.capabilities) {
      const probe = object(raw);
      if (
        !reference(probe.bindingRef) ||
        ![probe.requirementKey, probe.logicalRole, probe.capabilityKey, probe.operation].every(
          text,
        ) ||
        !["AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"].includes(String(probe.status)) ||
        !codes(probe.reasonCodes) ||
        !optionalTime(probe.observedAt) ||
        !optionalTime(probe.validUntil)
      )
        throw invalid();
    }
    return body as unknown as PilotHealthView;
  }
  async readiness(scope: PilotSelection, signal?: AbortSignal): Promise<PilotReadinessView> {
    const body = object(
      await this.request(`${this.path(scope)}/deployments/${scope.deploymentId}/readiness`, signal),
    );
    if (
      !sameScope(body, scope) ||
      !reference(body.deploymentRef) ||
      object(body.deploymentRef).id !== scope.deploymentId ||
      !["local", "integration", "pilot"].includes(String(body.deploymentProfile)) ||
      ![body.gateReady, body.engineeringReady, body.corporateGatesReady].every(
        (value) => typeof value === "boolean",
      ) ||
      !Array.isArray(body.gates) ||
      body.gates.length !== 4
    )
      throw invalid();
    const kinds = new Set<string>();
    for (const raw of body.gates) {
      const gate = object(raw);
      if (
        !["L0", "C1", "N2", "P3"].includes(String(gate.kind)) ||
        kinds.has(String(gate.kind)) ||
        !checkStatus(gate.status) ||
        !codes(gate.reasonCodes) ||
        !optionalTime(gate.validUntil)
      )
        throw invalid();
      kinds.add(String(gate.kind));
    }
    const inputs = object(body.inputs);
    if (
      !Array.isArray(inputs.entries) ||
      inputs.entries.length > 12 ||
      !optionalTime(inputs.validUntil) ||
      (inputs.reasonCodes !== undefined && !codes(inputs.reasonCodes))
    )
      throw invalid();
    const ids = new Set<string>();
    for (const raw of inputs.entries) {
      const input = object(raw);
      if (
        typeof input.id !== "string" ||
        !/^IN-(?:0[1-9]|1[0-2])$/u.test(input.id) ||
        ids.has(input.id) ||
        !text(input.ownerRole) ||
        !checkStatus(input.status) ||
        !codes(input.reasonCodes)
      )
        throw invalid();
      ids.add(input.id);
    }
    return body as unknown as PilotReadinessView;
  }
  async recovery(
    scope: Pick<PilotSelection, "workspaceId" | "projectId">,
    signal?: AbortSignal,
  ): Promise<PilotRecoveryView> {
    if (
      ![scope.workspaceId, scope.projectId].every((value) =>
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value),
      )
    )
      throw new PilotClientError("PILOT_SCOPE_INVALID");
    const body = object(
      await this.request(
        `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot/recovery`,
        signal,
      ),
    );
    if (
      body.workspaceId !== scope.workspaceId ||
      body.projectId !== scope.projectId ||
      !timestamp(body.evaluatedAt) ||
      !Array.isArray(body.drills) ||
      body.drills.length > 100 ||
      !Array.isArray(body.uncertainEffects) ||
      body.uncertainEffects.length > 100 ||
      !optionalTime(body.nextCursor)
    )
      throw invalid();
    for (const raw of body.drills) {
      const drill = object(raw);
      if (
        !text(drill.recoveryId) ||
        !text(drill.stage) ||
        !text(drill.status) ||
        !optionalTime(drill.faultDeclaredAt === null ? undefined : drill.faultDeclaredAt) ||
        !optionalTime(drill.serviceRestoredAt === null ? undefined : drill.serviceRestoredAt) ||
        ![drill.rpoObservedSeconds, drill.rtoObservedSeconds].every(
          (value) =>
            value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0),
        ) ||
        !Array.isArray(drill.unresolvedEffects) ||
        drill.unresolvedEffects.some((value) => !text(value))
      )
        throw invalid();
    }
    for (const raw of body.uncertainEffects) {
      const effect = object(raw);
      if (
        !text(effect.commandId) ||
        !text(effect.certainty) ||
        !text(effect.reasonCode) ||
        ![effect.attemptCount, effect.replayCount].every(
          (value) => Number.isSafeInteger(value) && Number(value) >= 0,
        )
      )
        throw invalid();
    }
    return body as unknown as PilotRecoveryView;
  }
  async pilotRun(
    scope: Readonly<{ workspaceId: string; projectId: string; runId: string }>,
    signal?: AbortSignal,
  ): Promise<PilotRunView> {
    if (
      ![scope.workspaceId, scope.projectId].every((value) =>
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value),
      ) ||
      !text(scope.runId)
    )
      throw new PilotClientError("PILOT_SCOPE_INVALID");
    const body = object(
      await this.request(
        `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot/runs/${encodeURIComponent(scope.runId)}`,
        signal,
      ),
    );
    const cohort = object(body.cohort),
      baseline = object(body.baseline);
    if (
      body.workspaceId !== scope.workspaceId ||
      body.projectId !== scope.projectId ||
      body.runId !== scope.runId ||
      !["PREPARING", "SHADOW", "LIMITED", "REVIEW", "STOPPED", "CLOSED"].includes(
        String(body.stage),
      ) ||
      !timestamp(body.evaluatedAt) ||
      !Number.isSafeInteger(cohort.version) ||
      !Array.isArray(cohort.projectIds) ||
      cohort.projectIds.some((value) => !text(value)) ||
      ![cohort.userCount, cohort.channelCount].every(
        (value) => Number.isSafeInteger(value) && Number(value) >= 0,
      ) ||
      !timestamp(cohort.startAt) ||
      !timestamp(cohort.endAt) ||
      !["CURRENT", "REVOKED"].includes(String(cohort.state)) ||
      !["MISSING", "CURRENT"].includes(String(baseline.status)) ||
      !Number.isSafeInteger(baseline.sampleSize) ||
      Number(baseline.sampleSize) < 0 ||
      (baseline.contentHash !== undefined &&
        !/^sha256:[a-f0-9]{64}$/u.test(String(baseline.contentHash))) ||
      !Array.isArray(body.metrics) ||
      body.metrics.length > 100 ||
      !Array.isArray(body.guardrails) ||
      body.guardrails.length !== 7 ||
      !Array.isArray(body.incidents) ||
      body.incidents.some((value) => !text(value))
    )
      throw invalid();
    const effects = object(body.externalEffects);
    if (
      ![effects.writes, effects.duplicates].every(
        (value) => value === null || (Number.isSafeInteger(value) && Number(value) >= 0),
      ) ||
      !["INDEPENDENT", "UNAVAILABLE"].includes(String(effects.source)) ||
      (effects.source === "INDEPENDENT" &&
        [effects.writes, effects.duplicates].some((value) => value === null))
    )
      throw invalid();
    for (const raw of body.metrics) {
      const metric = object(raw);
      if (
        !text(metric.key) ||
        (metric.value !== null &&
          (typeof metric.value !== "number" || !Number.isFinite(metric.value))) ||
        ![
          metric.denominator,
          metric.missingCount,
          metric.excludedCount,
          metric.censoredCount,
        ].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)
      )
        throw invalid();
    }
    for (const raw of body.guardrails) {
      const guardrail = object(raw);
      if (!text(guardrail.key) || !["PASS", "BREACH", "UNKNOWN"].includes(String(guardrail.state)))
        throw invalid();
    }
    if (body.review !== null) {
      const review = object(body.review);
      if (!text(review.recommendation) || !optionalTime(review.decidedAt)) throw invalid();
    }
    return body as unknown as PilotRunView;
  }
}
