import type { DataSource, EntityManager } from "typeorm";

export interface OperationalAuthorityTransaction {
  readonly manager: EntityManager;
  readonly transactionId: string;
}
export interface OperationalImportAtomicPlan<TResult> {
  readonly persistCore: (manager: EntityManager) => Promise<TResult>;
  readonly applyContribution: (manager: EntityManager, result: TResult) => Promise<void>;
  readonly appendOutboxAndAudit: (manager: EntityManager, result: TResult) => Promise<void>;
}
export class TypeOrmOperationalAuthorityUnitOfWork {
  constructor(private readonly source: DataSource) {}
  async execute<T>(work: (transaction: OperationalAuthorityTransaction) => Promise<T>): Promise<T> {
    return await this.source.transaction(
      "SERIALIZABLE",
      async (manager) =>
        await work({ manager, transactionId: `operational-authority:${crypto.randomUUID()}` }),
    );
  }
  async adoptImport<TResult>(plan: OperationalImportAtomicPlan<TResult>): Promise<TResult> {
    return await this.source.transaction("SERIALIZABLE", async (manager) => {
      const result = await plan.persistCore(manager);
      await plan.applyContribution(manager, result);
      await plan.appendOutboxAndAudit(manager, result);
      return result;
    });
  }
}
