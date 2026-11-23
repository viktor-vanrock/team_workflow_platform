import { AgentRunAggregate, type AgentRunSnapshot, type SkillDefinition } from "@awp/platform-core";

export interface AgentRunExecutionRequest {
  readonly run: AgentRunSnapshot;
  readonly skill: SkillDefinition;
}
export interface AgentSkillExecutor {
  execute(
    request: AgentRunExecutionRequest,
  ): Promise<Readonly<{ result: unknown; fallback?: boolean }>>;
}
export interface ClaimedAgentRun {
  readonly run: AgentRunSnapshot;
  readonly skill: SkillDefinition;
}
export interface DurableAgentRunPort {
  claim(): Promise<ClaimedAgentRun | undefined>;
  save(snapshot: AgentRunSnapshot): Promise<void>;
}

export class DurableAgentRunExecutor {
  constructor(
    private readonly runs: DurableAgentRunPort,
    private readonly skills: ReadonlyMap<string, AgentSkillExecutor>,
  ) {}
  async runOne(): Promise<number> {
    const claim = await this.runs.claim();
    if (!claim) return 0;
    const aggregate = AgentRunAggregate.restore(claim.run);
    aggregate.begin();
    await this.runs.save(aggregate.snapshot());
    const executor = this.skills.get(claim.skill.key);
    if (!executor) throw new Error(`HERMES_SKILL_EXECUTOR_NOT_FOUND:${claim.skill.key}`);
    const outcome = await executor.execute({ run: aggregate.snapshot(), skill: claim.skill });
    aggregate.complete(outcome.result, outcome.fallback === true);
    await this.runs.save(aggregate.snapshot());
    return 1;
  }
}

export class InMemoryDurableAgentRunPort implements DurableAgentRunPort {
  readonly #queue: ClaimedAgentRun[] = [];
  readonly #values = new Map<string, AgentRunSnapshot>();
  enqueue(snapshot: AgentRunSnapshot, skill: SkillDefinition): void {
    this.#queue.push(structuredClone({ run: snapshot, skill }));
    this.#values.set(snapshot.id, structuredClone(snapshot));
  }
  async claim(): Promise<ClaimedAgentRun | undefined> {
    return this.#queue.shift();
  }
  async save(snapshot: AgentRunSnapshot): Promise<void> {
    this.#values.set(snapshot.id, structuredClone(snapshot));
  }
  get(id: string): AgentRunSnapshot | undefined {
    const value = this.#values.get(id);
    return value ? structuredClone(value) : undefined;
  }
}
