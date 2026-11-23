import { PilotBrowserClient, PilotClientError, type PilotReference } from "./pilot-client.ts";

export interface DeadLetterScope {
  readonly workspaceId: string;
  readonly projectId: string;
}
export interface DeadLetterItem {
  readonly commandId: string;
  readonly rowVersion: number;
  readonly recordRef?: PilotReference;
  readonly ownerRef: string;
  readonly commandAgeMs: number;
  readonly firstFailureAt: string;
  readonly lastFailureAt: string;
  readonly expiresAt: string;
  readonly attemptCount: number;
  readonly reasonCode: string;
  readonly certainty: string;
  readonly eligibility: string;
  readonly replayCount: number;
}
export interface ReplayRequest {
  readonly commandId: string;
  readonly recordRef: PilotReference;
  readonly expectedRowVersion: number;
  readonly requestKey: string;
  readonly reason: "DEPENDENCY_REPAIRED" | "ACCESS_RESTORED";
}
export const validDeadLetterScope = (scope: DeadLetterScope) =>
  [scope.workspaceId, scope.projectId].every(uuid);
function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value)
  );
}
const invalid = () => new PilotClientError("PILOT_RESPONSE_INVALID");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function ref(value: unknown): PilotReference {
  const v = record(value);
  if (
    !uuid(v.id) ||
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1 ||
    typeof v.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(v.contentHash)
  )
    throw invalid();
  return { id: v.id, version: Number(v.version), contentHash: v.contentHash };
}
const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const code = (value: unknown) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,95}$/u.test(value);

export class DeadLetterBrowserClient extends PilotBrowserClient {
  private scopedPath(scope: DeadLetterScope) {
    if (!validDeadLetterScope(scope)) throw new PilotClientError("PILOT_SCOPE_INVALID");
    return `/api/v1/workspaces/${scope.workspaceId}/projects/${scope.projectId}/pilot`;
  }
  async list(
    scope: DeadLetterScope,
    after?: string,
    signal?: AbortSignal,
  ): Promise<{ items: readonly DeadLetterItem[]; nextCursor?: string }> {
    if (after !== undefined && !uuid(after)) throw new PilotClientError("PILOT_SCOPE_INVALID");
    const body = record(
      await this.request(
        `${this.scopedPath(scope)}/dead-letters?limit=25${after ? `&after=${after}` : ""}`,
        signal,
      ),
    );
    if (
      body.workspaceId !== scope.workspaceId ||
      body.projectId !== scope.projectId ||
      !time(body.evaluatedAt) ||
      !Array.isArray(body.items) ||
      body.items.length > 25 ||
      (body.nextCursor !== undefined && !uuid(body.nextCursor))
    )
      throw invalid();
    const items = body.items.map((item: unknown) => {
      const v = record(item);
      if (
        !uuid(v.commandId) ||
        !uuid(v.ownerRef) ||
        ![v.rowVersion, v.commandAgeMs, v.attemptCount, v.replayCount].every(
          (n) => Number.isSafeInteger(n) && Number(n) >= 0,
        ) ||
        Number(v.rowVersion) < 1 ||
        ![v.firstFailureAt, v.lastFailureAt, v.expiresAt].every(time) ||
        ![v.reasonCode, v.certainty, v.eligibility].every(code)
      )
        throw invalid();
      return {
        commandId: v.commandId,
        ownerRef: v.ownerRef,
        rowVersion: Number(v.rowVersion),
        commandAgeMs: Number(v.commandAgeMs),
        attemptCount: Number(v.attemptCount),
        replayCount: Number(v.replayCount),
        firstFailureAt: String(v.firstFailureAt),
        lastFailureAt: String(v.lastFailureAt),
        expiresAt: String(v.expiresAt),
        reasonCode: String(v.reasonCode),
        certainty: String(v.certainty),
        eligibility: String(v.eligibility),
        ...(v.recordRef ? { recordRef: ref(v.recordRef) } : {}),
      };
    });
    return { items, ...(body.nextCursor ? { nextCursor: body.nextCursor } : {}) };
  }
  async capture(
    scope: DeadLetterScope,
    commandId: string,
    csrfToken: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!uuid(commandId)) throw new PilotClientError("PILOT_SCOPE_INVALID");
    const body = record(
      await this.request(
        `${this.scopedPath(scope)}/dead-letters/${commandId}/diagnostics`,
        signal,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
          body: "{}",
        },
      ),
    );
    if (ref(body.recordRef).id !== commandId) throw invalid();
  }
  async replay(
    scope: DeadLetterScope,
    input: ReplayRequest,
    csrfToken: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const body = record(
      await this.request(`${this.scopedPath(scope)}/replay-decisions`, signal, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(input),
      }),
    );
    if (
      !uuid(body.decisionId) ||
      body.commandId !== input.commandId ||
      body.outcome !== "REQUEUED" ||
      !time(body.recordedAt) ||
      !time(body.expiresAt) ||
      !Number.isSafeInteger(body.resultingRowVersion)
    )
      throw invalid();
    return body.decisionId;
  }
}
