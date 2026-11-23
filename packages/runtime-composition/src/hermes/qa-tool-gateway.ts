import { type JsonValue, sha256 } from "@awp/platform-contracts";
import type { AgentRunSnapshot, AgentToolGrant } from "@awp/platform-core";

export interface QaToolAuthorizationPort {
  humanAllows(
    principalId: string,
    action: string,
    subject: AgentRunSnapshot["subject"],
  ): Promise<boolean>;
  serviceAllows(
    principalId: string,
    action: string,
    subject: AgentRunSnapshot["subject"],
  ): Promise<boolean>;
}
export class QaToolGateway {
  constructor(
    private readonly authorization: QaToolAuthorizationPort,
    private readonly handlers: ReadonlyMap<
      string,
      (subject: AgentRunSnapshot["subject"], input: JsonValue) => Promise<JsonValue>
    >,
  ) {}
  async invoke(run: AgentRunSnapshot, action: string, input: JsonValue) {
    const grant = run.grants.find(
      (candidate: AgentToolGrant) =>
        candidate.action === action &&
        candidate.subject.kind === run.subject.kind &&
        candidate.subject.id === run.subject.id &&
        candidate.subject.version === run.subject.version &&
        candidate.subject.contentHash === run.subject.contentHash,
    );
    if (!grant) throw new Error("AGENT_TOOL_GRANT_DENIED");
    if (
      !(await this.authorization.humanAllows(run.humanPrincipalId, action, run.subject)) ||
      !(await this.authorization.serviceAllows(run.servicePrincipalId, action, run.subject))
    )
      throw new Error("AGENT_TOOL_DUAL_AUTHORIZATION_DENIED");
    if (
      grant.effectClass === "APPROVAL_REQUIRED" ||
      action.includes("entitlement") ||
      action.includes("verdict") ||
      action.includes("jira")
    )
      throw new Error("AGENT_TOOL_EFFECT_DENIED");
    const handler = this.handlers.get(action);
    if (!handler) throw new Error("AGENT_TOOL_HANDLER_NOT_FOUND");
    const result = await handler(run.subject, input);
    return Object.freeze({
      result,
      resultHash: sha256(result),
      grantHash: sha256(grant as unknown as JsonValue),
    });
  }
}
