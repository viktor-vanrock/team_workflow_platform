import type { AgentRunSubject, AgentToolGrant } from "./agent-run.ts";

export interface ToolInvocationAuthorizationPort {
  authorize(input: {
    principalId: string;
    workspaceId: string;
    projectId: string;
    action: string;
    subject: AgentRunSubject;
  }): Promise<boolean>;
}
export class AgentToolGateway {
  constructor(private readonly authorization: ToolInvocationAuthorizationPort) {}
  async invoke<T>(input: {
    workspaceId: string;
    projectId: string;
    servicePrincipalId: string;
    humanPrincipalId: string;
    subject: AgentRunSubject;
    grant: AgentToolGrant;
    action: string;
    expectedSubjectHash: string;
    execute: () => Promise<T>;
  }): Promise<T> {
    if (
      input.grant.action !== input.action ||
      JSON.stringify(input.grant.subject) !== JSON.stringify(input.subject)
    )
      throw new Error("AGENT_GRANT_SCOPE_MISMATCH");
    if (input.expectedSubjectHash !== input.subject.contentHash)
      throw new Error("AGENT_SUBJECT_STALE");
    const service = await this.authorization.authorize({
      principalId: input.servicePrincipalId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: input.action,
      subject: input.subject,
    });
    const human = await this.authorization.authorize({
      principalId: input.humanPrincipalId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      action: input.action,
      subject: input.subject,
    });
    if (!service || !human) throw new Error("AGENT_TOOL_DENIED");
    return await input.execute();
  }
}
