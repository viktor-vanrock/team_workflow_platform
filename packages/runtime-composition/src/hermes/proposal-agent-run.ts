import { modelWithDeterministicFallback } from "../model/deterministic-fake-model.ts";
import type { AgentRunExecutionRequest, AgentSkillExecutor } from "./agent-run-worker.ts";

export interface ProposalExecutionBinding {
  build(
    request: AgentRunExecutionRequest,
  ): Promise<Readonly<{ manifest: unknown; fallback: unknown }>>;
  model?(manifest: unknown): Promise<unknown>;
  validate(value: unknown): boolean;
  persist(value: unknown, request: AgentRunExecutionRequest): Promise<unknown>;
  fallbackAllowed: boolean;
}
export class ProposalAgentRunExecutor implements AgentSkillExecutor {
  constructor(private readonly binding: ProposalExecutionBinding) {}
  async execute(request: AgentRunExecutionRequest) {
    const prepared = await this.binding.build(request);
    const outcome = await modelWithDeterministicFallback({
      model: async () =>
        this.binding.model ? await this.binding.model(prepared.manifest) : prepared.fallback,
      validate: (value): value is unknown => this.binding.validate(value),
      fallback: () => prepared.fallback,
      fallbackAllowed: this.binding.fallbackAllowed,
    });
    return {
      result: await this.binding.persist(outcome.value, request),
      fallback: outcome.fallback,
    };
  }
}
