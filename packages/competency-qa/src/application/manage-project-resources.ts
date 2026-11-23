import { qaAggregateSnapshotHash, QaDomainError, type QaScope } from "../domain/primitives.ts";
import {
  assertOpaqueAccountPool,
  createQaProjectEnvironmentRevision,
  type QaAccountPoolReference,
  type QaProjectEnvironmentRevision,
  type QaTestDataCatalogEntry,
} from "../domain/project-resources.ts";
import {
  publishQaProjectContextV2,
  type QaProjectContextV2,
  type QaProjectContextV2Content,
} from "../domain/qa-project-context.ts";

const key = (scope: QaScope, id: string, version: number) =>
  `${scope.workspaceId}:${scope.projectId}:${id}:${version}`;

export interface QaProjectResourceStorePort {
  environment(
    scope: QaScope,
    id: string,
    version: number,
  ): QaProjectEnvironmentRevision | undefined | Promise<QaProjectEnvironmentRevision | undefined>;
  testDataEntry(
    scope: QaScope,
    id: string,
    version: number,
  ): QaTestDataCatalogEntry | undefined | Promise<QaTestDataCatalogEntry | undefined>;
  accountPool(
    scope: QaScope,
    id: string,
    version: number,
  ): QaAccountPoolReference | undefined | Promise<QaAccountPoolReference | undefined>;
  appendEnvironment(revision: QaProjectEnvironmentRevision): void | Promise<void>;
  appendTestData(revision: QaTestDataCatalogEntry): void | Promise<void>;
  appendAccountPool(revision: QaAccountPoolReference): void | Promise<void>;
  appendContext(revision: QaProjectContextV2): void | Promise<void>;
}

export class InMemoryQaProjectResourceStore implements QaProjectResourceStorePort {
  readonly environments = new Map<string, QaProjectEnvironmentRevision>();
  readonly testData = new Map<string, QaTestDataCatalogEntry>();
  readonly accountPools = new Map<string, QaAccountPoolReference>();
  readonly contexts = new Map<string, QaProjectContextV2>();

  environment(
    scope: QaScope,
    id: string,
    version: number,
  ): QaProjectEnvironmentRevision | undefined {
    return structuredClone(this.environments.get(key(scope, id, version)));
  }
  testDataEntry(scope: QaScope, id: string, version: number): QaTestDataCatalogEntry | undefined {
    return structuredClone(this.testData.get(key(scope, id, version)));
  }
  accountPool(scope: QaScope, id: string, version: number): QaAccountPoolReference | undefined {
    return structuredClone(this.accountPools.get(key(scope, id, version)));
  }
  appendEnvironment(revision: QaProjectEnvironmentRevision): void {
    this.environments.set(
      key(revision, revision.environmentId, revision.version),
      structuredClone(revision),
    );
  }
  appendTestData(revision: QaTestDataCatalogEntry): void {
    this.testData.set(key(revision, revision.entryId, revision.version), structuredClone(revision));
  }
  appendAccountPool(revision: QaAccountPoolReference): void {
    this.accountPools.set(
      key(revision, revision.poolId, revision.version),
      structuredClone(revision),
    );
  }
  appendContext(revision: QaProjectContextV2): void {
    this.contexts.set(
      key(revision, revision.contextId, revision.version),
      structuredClone(revision),
    );
  }
}

function assertExactRef(ref: Readonly<{ id: string; version: number; contentHash: string }>): void {
  if (
    !ref.id ||
    !Number.isSafeInteger(ref.version) ||
    ref.version < 1 ||
    !/^sha256:[a-f0-9]{64}$/u.test(ref.contentHash)
  ) {
    throw new QaDomainError("QA_PROJECT_RESOURCE_REF_INVALID");
  }
}

export class ManageQaProjectResources {
  constructor(private readonly store: QaProjectResourceStorePort) {}

  async publishEnvironment(
    input: Omit<QaProjectEnvironmentRevision, "contentHash">,
  ): Promise<QaProjectEnvironmentRevision> {
    const revision = createQaProjectEnvironmentRevision(input);
    if (await this.store.environment(revision, revision.environmentId, revision.version))
      throw new QaDomainError("QA_PROJECT_ENVIRONMENT_IMMUTABLE");
    await this.store.appendEnvironment(revision);
    return revision;
  }

  async publishTestData(
    input: Omit<QaTestDataCatalogEntry, "contentHash">,
  ): Promise<QaTestDataCatalogEntry> {
    assertExactRef(input.externalRef);
    input.allowedEnvironmentRefs.forEach(assertExactRef);
    assertExactRef(input.retentionPolicyRef);
    if (
      !input.entryId ||
      input.version < 1 ||
      input.state !== "PUBLISHED" ||
      input.allowedEnvironmentRefs.length === 0
    )
      throw new QaDomainError("QA_TEST_DATA_INVALID");
    for (const environmentRef of input.allowedEnvironmentRefs) {
      const environment = await this.store.environment(
        input,
        environmentRef.id,
        environmentRef.version,
      );
      if (!environment || environment.contentHash !== environmentRef.contentHash)
        throw new QaDomainError("QA_PROJECT_RESOURCE_SCOPE_MISMATCH");
    }
    const body = structuredClone(input);
    const revision = Object.freeze({
      ...body,
      contentHash: qaAggregateSnapshotHash(body as never),
    });
    if (await this.store.testDataEntry(revision, revision.entryId, revision.version))
      throw new QaDomainError("QA_TEST_DATA_IMMUTABLE");
    await this.store.appendTestData(revision);
    return revision;
  }

  async publishAccountPool(
    input: Omit<QaAccountPoolReference, "contentHash">,
  ): Promise<QaAccountPoolReference> {
    assertOpaqueAccountPool(input);
    assertExactRef(input.environmentRef);
    const environment = await this.store.environment(
      input,
      input.environmentRef.id,
      input.environmentRef.version,
    );
    if (!environment || environment.contentHash !== input.environmentRef.contentHash)
      throw new QaDomainError("QA_PROJECT_RESOURCE_SCOPE_MISMATCH");
    const body = structuredClone(input);
    const revision = Object.freeze({
      ...body,
      contentHash: qaAggregateSnapshotHash(body as never),
    });
    if (await this.store.accountPool(revision, revision.poolId, revision.version))
      throw new QaDomainError("QA_ACCOUNT_POOL_IMMUTABLE");
    await this.store.appendAccountPool(revision);
    return revision;
  }

  async publishContext(
    input: QaProjectContextV2 | (QaProjectContextV2Content & Readonly<{ schemaVersion?: 2 }>),
  ): Promise<QaProjectContextV2> {
    for (const ref of input.environmentRefs) {
      const version = Number(ref.version);
      const environment = await this.store.environment(input, ref.id, version);
      if (!environment || environment.contentHash !== ref.contentHash)
        throw new QaDomainError("QA_PROJECT_RESOURCE_SCOPE_MISMATCH");
    }
    for (const ref of input.testDataCatalogRefs) {
      const revision = await this.store.testDataEntry(input, ref.id, Number(ref.version));
      if (!revision || revision.contentHash !== ref.contentHash)
        throw new QaDomainError("QA_PROJECT_RESOURCE_SCOPE_MISMATCH");
    }
    for (const ref of input.accountPoolRefs) {
      const revision = await this.store.accountPool(input, ref.id, Number(ref.version));
      if (!revision || revision.contentHash !== ref.contentHash)
        throw new QaDomainError("QA_PROJECT_RESOURCE_SCOPE_MISMATCH");
    }
    const {
      schemaVersion: _schemaVersion,
      contentHash: _contentHash,
      ...content
    } = input as QaProjectContextV2;
    void _schemaVersion;
    void _contentHash;
    const context = publishQaProjectContextV2(content);
    await this.store.appendContext(context);
    return context;
  }
}
