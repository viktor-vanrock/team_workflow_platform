import type { JsonValue, Sha256Digest } from "@awp/platform-contracts";

import type {
  TrustedConnectorExactReference,
  TrustedConnectorOperationContext,
} from "./source-context.ts";

export const testExecutorCapability = Object.freeze({
  key: "test-executor.trigger-status" as const,
  version: "1.0.0" as const,
  operations: Object.freeze(["pipeline.trigger", "pipeline.read", "pipeline.lookup"] as const),
});

export type TestExecutorOperation = (typeof testExecutorCapability.operations)[number];

export interface PipelineTriggerRequest {
  readonly schemaVersion: "test-executor.trigger-status@1.0.0";
  readonly messageType: "REQUEST";
  readonly operation: "pipeline.trigger";
  readonly testSessionId: string;
  readonly automationAttemptId: string;
  readonly launchRequestCommitment: Sha256Digest;
  readonly targetSnapshotRef: string;
  readonly targetSnapshotHash: Sha256Digest;
  readonly suiteBindingRef: TrustedConnectorExactReference;
  readonly suiteBindingHash: Sha256Digest;
  readonly acceptedParameters: Readonly<Record<string, JsonValue>>;
  readonly parameterSetHash: Sha256Digest;
  readonly effectMarkerHash: Sha256Digest;
  readonly triggerRequestHash: Sha256Digest;
}

export interface PipelineTriggerReceipt {
  readonly schemaVersion: "test-executor.trigger-status@1.0.0";
  readonly messageType: "RESULT";
  readonly operation: "pipeline.trigger";
  readonly externalPipelineId: string;
  readonly externalPipelineDisplayRef?: string;
  readonly sourceCommitSha: string;
  readonly observedState: "QUEUED" | "RUNNING" | "TERMINAL";
  readonly providerCreatedAt: string;
  readonly observedAt: string;
  readonly triggerRequestHash: Sha256Digest;
  readonly effectMarkerHash: Sha256Digest;
  readonly observationHash: Sha256Digest;
}

export interface PipelineReadRequest {
  readonly schemaVersion: "test-executor.trigger-status@1.0.0";
  readonly messageType: "REQUEST";
  readonly operation: "pipeline.read";
  readonly automationAttemptId: string;
  readonly externalPipelineId: string;
  readonly targetSnapshotHash: Sha256Digest;
  readonly configurationPinSetHash: Sha256Digest;
}

export interface PipelineObservation {
  readonly schemaVersion: "test-executor.trigger-status@1.0.0";
  readonly messageType: "RESULT";
  readonly operation: "pipeline.read";
  readonly externalPipelineId: string;
  readonly externalJobIds: readonly string[];
  readonly sourceCommitSha: string;
  readonly buildRef?: string;
  readonly providerState:
    | "CREATED"
    | "WAITING_FOR_RESOURCE"
    | "PREPARING"
    | "PENDING"
    | "RUNNING"
    | "SUCCESS"
    | "FAILED"
    | "CANCELED"
    | "SKIPPED"
    | "MANUAL"
    | "SCHEDULED"
    | "UNKNOWN";
  readonly terminal: boolean;
  readonly queuedAt?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly providerRevisionToken: string;
  readonly providerUpdatedAt: string;
  readonly resultDescriptorRef?: string;
  readonly observedAt: string;
  readonly observationHash: Sha256Digest;
}

export interface PipelineLookupRequest {
  readonly schemaVersion: "test-executor.trigger-status@1.0.0";
  readonly messageType: "REQUEST";
  readonly operation: "pipeline.lookup";
  readonly automationAttemptId: string;
  readonly effectMarkerHash: Sha256Digest;
  readonly expectedTargetCommitment: Sha256Digest;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly triggerRequestHash: Sha256Digest;
}

interface PipelineLookupBase {
  readonly schemaVersion: "test-executor.trigger-status@1.0.0";
  readonly messageType: "RESULT";
  readonly operation: "pipeline.lookup";
  readonly observedWindow: Readonly<{ start: string; end: string }>;
  readonly consistencyEvidenceHash: Sha256Digest;
}

export type PipelineLookupResult =
  | (PipelineLookupBase & Readonly<{ outcome: "EXACT_ONE"; receipt: PipelineTriggerReceipt }>)
  | (PipelineLookupBase & Readonly<{ outcome: "ZERO" }>)
  | (PipelineLookupBase &
      Readonly<{ outcome: "MULTIPLE"; matchCommitmentHashes: readonly Sha256Digest[] }>);

export interface TestExecutorPort {
  trigger(
    context: TrustedConnectorOperationContext,
    request: PipelineTriggerRequest,
  ): Promise<PipelineTriggerReceipt>;
  read(
    context: TrustedConnectorOperationContext,
    request: PipelineReadRequest,
  ): Promise<PipelineObservation>;
  lookup(
    context: TrustedConnectorOperationContext,
    request: PipelineLookupRequest,
  ): Promise<PipelineLookupResult>;
}
