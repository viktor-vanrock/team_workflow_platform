import type { CommandGateway, WorkspaceContext } from "@awp/platform-core";

export interface DummyBindingResolver {
  resolve(
    context: WorkspaceContext,
    input: Readonly<{ workItemId: string }>,
  ): Promise<
    Readonly<{
      bindingRef: { id: string; version: number };
      profileRef: { id: string; version: number };
    }>
  >;
}
export class PublishSampleRecord {
  constructor(
    private readonly gateway: CommandGateway,
    private readonly bindings: DummyBindingResolver,
  ) {}
  async publish(
    context: WorkspaceContext,
    input: Readonly<{
      workItemId: string;
      recordKey: string;
      title: string;
      body: string;
      clientRequestKey: string;
    }>,
  ) {
    const resolved = await this.bindings.resolve(context, { workItemId: input.workItemId });
    return await this.gateway.submit(context, {
      clientRequestKey: input.clientRequestKey,
      commandType: "sample.record.publish",
      capability: {
        key: "sample.record",
        exactContractVersion: "1.0.0",
        operation: "record.publish",
        logicalRole: "PRIMARY",
      },
      target: { recordKey: input.recordKey },
      payload: { sourceWorkItemId: input.workItemId, title: input.title, body: input.body },
      expectedExternalState: { mode: "MUST_NOT_EXIST" },
      bindingRef: resolved.bindingRef,
      profileRef: resolved.profileRef,
      dataClassificationKey: "INTERNAL",
      source: { sourceWorkItemId: input.workItemId },
    });
  }
}
