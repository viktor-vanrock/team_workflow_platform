import { type JsonValue, sha256 } from "@awp/platform-contracts";
import {
  type AgentRunSubject,
  AgentToolGateway,
  deriveAgentGrants,
  type ProjectScope,
} from "@awp/platform-core";

import {
  type HermesCaseInput,
  type HermesCorpusSource,
  type HermesToolObservation,
  sameHermesSubject,
} from "./evaluation.ts";

export interface HermesContextAuthority {
  currentSubject(scope: ProjectScope, requested: AgentRunSubject): Promise<AgentRunSubject | null>;
  authorize(
    principalId: string,
    scope: ProjectScope,
    subject: AgentRunSubject,
    action: string,
  ): Promise<boolean>;
  sourceAuthorized(
    scope: ProjectScope,
    subject: AgentRunSubject,
    sourceId: string,
  ): Promise<boolean>;
}
/** Request-local context; neither retrieved text nor the provider can add grants. */
export class HermesEvaluationContext {
  private readonly journal: HermesToolObservation[] = [];
  private readonly sourceIds: string[] = [];
  private readonly gateway: AgentToolGateway;
  constructor(
    private readonly input: HermesCaseInput,
    private readonly authority: HermesContextAuthority,
    private readonly principals: Readonly<{
      humanId: string;
      serviceId: string;
      humanActions: readonly string[];
      serviceActions: readonly string[];
    }>,
  ) {
    this.gateway = new AgentToolGateway({
      authorize: (request) =>
        this.authority.authorize(request.principalId, request, request.subject, request.action),
    });
  }
  async current() {
    return this.authority.currentSubject(this.input, this.input.subject);
  }
  async invoke<T>(
    action: string,
    scope: ProjectScope,
    subject: AgentRunSubject,
    execute: () => Promise<T>,
  ): Promise<T> {
    try {
      const grants = deriveAgentGrants({
        subject: this.input.subject,
        humanAllowedActions: this.principals.humanActions,
        serviceCeiling: this.principals.serviceActions,
        classificationCeiling: "INTERNAL",
        skillAllowlist: this.input.readActions.map((action) => ({
          action,
          effectClass: "READ_ONLY",
        })),
      });
      const grant = grants.find((grant) => grant.action === action);
      if (
        !grant ||
        scope.workspaceId !== this.input.workspaceId ||
        scope.projectId !== this.input.projectId ||
        !sameHermesSubject(await this.current(), subject)
      )
        throw new Error("HERMES_CONTEXT_DENIED");
      return await this.gateway.invoke({
        ...scope,
        subject,
        grant,
        action,
        expectedSubjectHash: this.input.subject.contentHash,
        servicePrincipalId: this.principals.serviceId,
        humanPrincipalId: this.principals.humanId,
        execute: async () => {
          const value = await execute();
          this.journal.push({
            action,
            scope: { workspaceId: scope.workspaceId, projectId: scope.projectId },
            subject,
            outcome: "READ",
          });
          return value;
        },
      });
    } catch {
      this.journal.push({
        action,
        scope: { workspaceId: scope.workspaceId, projectId: scope.projectId },
        subject,
        outcome: "DENIED",
      });
      throw new Error("HERMES_CONTEXT_DENIED");
    }
  }
  async readSources(): Promise<readonly HermesCorpusSource[]> {
    const selected: HermesCorpusSource[] = [];
    for (const source of this.input.sources) {
      if (
        source.workspaceId !== this.input.workspaceId ||
        source.projectId !== this.input.projectId ||
        !sameHermesSubject(source.subject, this.input.subject) ||
        source.classification !== "INTERNAL" ||
        sha256(source.facts as JsonValue) !== source.contentHash ||
        !(await this.authority.sourceAuthorized(this.input, this.input.subject, source.id))
      )
        continue;
      const value = await this.invoke(
        this.input.workflow === "EVIDENCE" ? "evidence.read" : "facts.read",
        this.input,
        this.input.subject,
        async () => structuredClone(source),
      );
      this.sourceIds.push(source.id);
      selected.push(value);
    }
    return selected;
  }
  observations() {
    return { toolObservations: structuredClone(this.journal), readSourceIds: [...this.sourceIds] };
  }
}
