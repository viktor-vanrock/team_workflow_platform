import {
  FairJiraScheduler,
  type JiraReconciliationPageInput,
  type JiraSchedulingLane,
  planJiraReconciliationPage,
} from "@awp/connector-jira";

import type {
  PostgresAuthoritativeJiraCapacityReconciliationInput,
  PostgresAuthoritativeJiraCapacityReconciliationReceipt,
} from "../queue/admission-service.ts";
import type {
  AuthoritativeJiraCandidateFact,
  JiraCandidateDiscovery,
} from "./candidate-discovery.ts";

export interface JiraReconciliationJob {
  readonly id: string;
  readonly lane: JiraSchedulingLane;
  readonly input: JiraReconciliationPageInput;
}
export class JiraReconciliationJobScheduler {
  readonly #scheduler = new FairJiraScheduler();
  readonly #jobs = new Map<string, JiraReconciliationJob>();
  schedule(job: JiraReconciliationJob): void {
    if (this.#jobs.has(job.id)) return;
    this.#jobs.set(job.id, Object.freeze({ ...job }));
    this.#scheduler.enqueue(job.lane, job.id);
  }
  next():
    | Readonly<{ job: JiraReconciliationJob; plan: ReturnType<typeof planJiraReconciliationPage> }>
    | undefined {
    const id = this.#scheduler.next();
    if (!id) return undefined;
    const job = this.#jobs.get(id)!;
    this.#jobs.delete(id);
    return Object.freeze({ job, plan: planJiraReconciliationPage(job.input) });
  }
}
export class UnifiedJiraImportService<TCandidate, TResult> {
  constructor(private readonly route: (candidate: TCandidate) => Promise<TResult>) {}
  fromWebhook(candidate: TCandidate): Promise<TResult> {
    return this.route(candidate);
  }
  fromReconciliation(candidate: TCandidate): Promise<TResult> {
    return this.route(candidate);
  }
}
export class JiraCandidateReconciliationRoute {
  constructor(private readonly discovery: JiraCandidateDiscovery) {}
  async observe(facts: readonly AuthoritativeJiraCandidateFact[]) {
    const results = [];
    for (const fact of facts) results.push(await this.discovery.discover(fact));
    return Object.freeze(results);
  }
}

export interface JiraCapacityReconciliationPort {
  reconcile(
    input: PostgresAuthoritativeJiraCapacityReconciliationInput,
  ): Promise<PostgresAuthoritativeJiraCapacityReconciliationReceipt>;
}

/** Routes webhook and scheduled reads through one authority-preserving capacity path. */
export class JiraCapacityReconciliationRoute {
  constructor(private readonly capacity: JiraCapacityReconciliationPort) {}

  async observe(facts: readonly PostgresAuthoritativeJiraCapacityReconciliationInput[]) {
    const results: PostgresAuthoritativeJiraCapacityReconciliationReceipt[] = [];
    for (const fact of facts) results.push(await this.capacity.reconcile(fact));
    return Object.freeze(results);
  }
}
