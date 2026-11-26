import type { QaAutomatedTargetSnapshot } from "@awp/competency-qa/node";
import type {
  SourceContextReadPort,
  SourceContextReadRequest,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import { type JsonValue, sha256 } from "@awp/platform-contracts";

/** Require a fresh provider read of the original pinned source before authorizing an automatic retry. */
export async function verifyCorporateGitLabRetryTarget(
  input: Readonly<{
    snapshot: QaAutomatedTargetSnapshot;
    context: TrustedConnectorOperationContext;
    source: SourceContextReadPort;
    numericProjectId: number;
    revalidate(): Promise<void>;
  }>,
): Promise<`sha256:${string}`> {
  const { snapshot, context } = input;
  const { snapshotHash, ...body } = snapshot;
  const pins = snapshot.configurationPins.filter((pin) => pin.logicalRole === "SOURCE_CONTEXT");
  const contextPins = context.configurationPins.filter(
    (pin) => pin.logicalRole === "SOURCE_CONTEXT",
  );
  const target = snapshot.target;
  if (
    context.scope.kind !== "PROJECT" ||
    context.actor.kind !== "SERVICE" ||
    context.signal.aborted ||
    !Number.isSafeInteger(input.numericProjectId) ||
    input.numericProjectId < 1 ||
    context.scope.workspaceId !== snapshot.workspaceId ||
    context.scope.projectId !== snapshot.projectId ||
    sha256(body as unknown as JsonValue) !== snapshotHash ||
    pins.length !== 1 ||
    contextPins.length !== 1 ||
    pins[0]!.capabilityKey !== contextPins[0]!.capabilityKey ||
    pins[0]!.exactContractVersion !== contextPins[0]!.exactContractVersion ||
    pins[0]!.profileRef.id !== contextPins[0]!.profileRef.id ||
    pins[0]!.profileRef.version !== contextPins[0]!.profileRef.version ||
    pins[0]!.profileRef.contentHash !== contextPins[0]!.profileRef.contentHash ||
    pins[0]!.connectionRef.id !== contextPins[0]!.connectionRef.id ||
    pins[0]!.connectionRef.version !== contextPins[0]!.connectionRef.version ||
    pins[0]!.connectionRef.contentHash !== contextPins[0]!.connectionRef.contentHash ||
    pins[0]!.projectIntegrationBindingRef.id !== contextPins[0]!.bindingRef.id ||
    pins[0]!.projectIntegrationBindingRef.version !== contextPins[0]!.bindingRef.version ||
    pins[0]!.projectIntegrationBindingRef.contentHash !== contextPins[0]!.bindingRef.contentHash ||
    pins[0]!.validationReportRef.id !== contextPins[0]!.validationReportRef.id ||
    pins[0]!.validationReportRef.version !== contextPins[0]!.validationReportRef.version ||
    pins[0]!.validationReportRef.contentHash !== contextPins[0]!.validationReportRef.contentHash ||
    pins[0]!.operationSetHash !== contextPins[0]!.operationSetHash ||
    typeof input.source?.read !== "function" ||
    typeof input.revalidate !== "function"
  )
    throw new Error("CORPORATE_GITLAB_RETRY_TARGET_INVALID");
  const operation =
    target.type === "MERGE_REQUEST"
      ? "merge-request.read"
      : target.type === "COMMIT"
        ? "commit.read"
        : "build.read";
  const rawRef =
    target.type === "MERGE_REQUEST"
      ? target.mergeRequestRef
      : target.type === "COMMIT"
        ? target.commitSha
        : target.buildRef;
  let sourceRef = rawRef;
  if (target.type !== "COMMIT") {
    const match =
      target.type === "MERGE_REQUEST"
        ? /^(?:([1-9][0-9]*):|!)?([1-9][0-9]*)$/u.exec(rawRef)
        : /^(?:(?:gitlab-pipeline:)(?:([1-9][0-9]*):)?|pipeline:)?([1-9][0-9]*)$/u.exec(rawRef);
    if (!match || (match[1] !== undefined && match[1] !== String(input.numericProjectId)))
      throw new Error("CORPORATE_GITLAB_RETRY_TARGET_INVALID");
    sourceRef = match[2]!;
  }
  const request: SourceContextReadRequest = {
    schemaVersion: "source-context.read@1.0.0",
    messageType: "REQUEST",
    operation,
    selector: { sourceKind: target.type, sourceRef, expectedRevision: target.commitSha },
  };
  await input.revalidate();
  const result = await input.source.read(context, request);
  await input.revalidate();
  const observation = result.observation;
  const { observationHash, ...observationBody } = observation;
  const observedCommit =
    observation.sourceKind === "MERGE_REQUEST"
      ? observation.headCommitSha
      : observation.sourceKind === "COMMIT"
        ? observation.commitSha
        : observation.sourceCommitSha;
  if (
    context.signal.aborted ||
    result.schemaVersion !== "source-context.read@1.0.0" ||
    result.messageType !== "RESULT" ||
    result.operation !== operation ||
    observation.sourceKind !== target.type ||
    observation.sourceRef !== sourceRef ||
    observedCommit !== target.commitSha ||
    sha256(observationBody as unknown as JsonValue) !== observationHash ||
    (observation.sourceKind === "MERGE_REQUEST" && observation.state !== "OPEN") ||
    (observation.sourceKind === "BUILD" && observation.state !== "AVAILABLE")
  )
    throw new Error("CORPORATE_GITLAB_RETRY_TARGET_CHANGED");
  return observationHash;
}
