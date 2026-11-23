export interface SampleRecordInvocation {
  readonly effectIdempotencyKey: string;
  readonly target: Readonly<{ id: string }>;
  readonly payload: Readonly<{ message: string }>;
}
export interface SampleRecordConformanceConnector {
  publish(
    input: SampleRecordInvocation,
  ): Promise<Readonly<{ externalRecordId: string; status: "PUBLISHED" }>>;
  effectCount(effectIdempotencyKey: string): Promise<number>;
}
export async function runSampleRecordConformance(
  connector: SampleRecordConformanceConnector,
): Promise<Readonly<{ stableResult: boolean; effectCount: number }>> {
  const input = Object.freeze({
    effectIdempotencyKey: "conformance-effect-1",
    target: { id: "phase1-conformance" },
    payload: { message: "hello" },
  });
  const first = await connector.publish(input);
  const replay = await connector.publish(input);
  return Object.freeze({
    stableResult: JSON.stringify(first) === JSON.stringify(replay),
    effectCount: await connector.effectCount(input.effectIdempotencyKey),
  });
}
