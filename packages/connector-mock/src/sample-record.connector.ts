import { type ConnectorRuntimeContext, defineConnectorOperation } from "@awp/connector-sdk";

export interface SampleRecordTarget {
  readonly id: string;
}
export interface SampleRecordInput {
  readonly message: string;
}
export interface SampleRecordResult {
  readonly externalRecordId: string;
  readonly status: "PUBLISHED";
  readonly receipt: string;
}
export interface SampleMockTransport {
  publish(
    request: Readonly<{
      effectIdempotencyKey: string;
      correlationId: string;
      target: SampleRecordTarget;
      payload: SampleRecordInput;
      expectedExternalState: { mode: "MUST_NOT_EXIST" };
    }>,
  ): Promise<SampleRecordResult>;
}
export interface LocalSecretResolver {
  resolve(reference: string): Promise<string>;
}
export class FakeLocalSecretResolver implements LocalSecretResolver {
  async resolve(reference: string): Promise<string> {
    if (!reference.startsWith("secretref://local/"))
      throw new Error("NON_LOCAL_SECRET_REFERENCE_FORBIDDEN");
    return `resolved-for-test:${reference.slice(18)}`;
  }
}
export function createSampleRecordConnector(transport: SampleMockTransport) {
  const publish = defineConnectorOperation<
    SampleRecordTarget,
    SampleRecordInput,
    SampleRecordResult
  >({
    capabilityKey: "sample.record",
    exactContractVersion: "1.0.0",
    operation: "record.publish",
    idempotencyStrategies: ["NATIVE_KEY"],
    confirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
    handler: {
      invoke: async (
        context: ConnectorRuntimeContext,
        target: SampleRecordTarget,
        input: SampleRecordInput,
      ) =>
        transport.publish({
          effectIdempotencyKey: context.effectIdempotencyKey,
          correlationId: context.correlationId,
          target,
          payload: input,
          expectedExternalState: { mode: "MUST_NOT_EXIST" },
        }),
    },
  });
  return Object.freeze({
    key: "sample.mock",
    version: "1.0.0",
    operations: Object.freeze({ publishSampleRecord: publish }),
  });
}
