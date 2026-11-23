import { createHash } from "node:crypto";

import type { DataSource } from "typeorm";

import {
  createGitLabDialect,
  type GitLabArtifactAuthority,
  type GitLabArtifactStreamAuthority,
  GitLabAuth,
  GitLabCiArtifactHandler,
  GitLabRestClient,
  preflightGitLabProfile,
  validateGitLabConnectionConfiguration,
} from "@awp/connector-gitlab";
import type {
  CiArtifactDescriptor,
  CiArtifactMetadataRequest,
  CiArtifactStreamRequest,
  TrustedConnectorOperationContext,
} from "@awp/connector-sdk";
import type { Sha256Digest } from "@awp/platform-contracts";
import { type ArtifactStorageReference, defaultClassificationCatalog } from "@awp/platform-core";

import { isGitLabLocalComposition, type RuntimeEnvironment } from "../config/environment.ts";
import type {
  GitLabArtifactStorageAuthority,
  GitLabArtifactStorageMaterialization,
} from "./artifact-storage.ts";

const locatorPrefix = "gitlab-artifact-reference:";

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function digest(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function referenceId(reference: ArtifactStorageReference): string {
  if (
    reference.providerKind !== "GITLAB_CI" ||
    !reference.opaqueLocator.startsWith(locatorPrefix)
  ) {
    throw new Error("GITLAB_ARTIFACT_STORAGE_REFERENCE_INVALID");
  }
  const id = reference.opaqueLocator.slice(locatorPrefix.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new Error("GITLAB_ARTIFACT_REFERENCE_ID_INVALID");
  }
  return id;
}

function pins(
  value: readonly Readonly<Record<string, unknown>>[],
): TrustedConnectorOperationContext["configurationPins"] {
  return Object.freeze(
    value.map((raw) => {
      const pin = raw as Readonly<{
        logicalRole: string;
        capabilityKey: string;
        exactContractVersion: string;
        projectIntegrationBindingRef: TrustedConnectorOperationContext["configurationPins"][number]["bindingRef"];
        profileRef: TrustedConnectorOperationContext["configurationPins"][number]["profileRef"];
        connectionRef: TrustedConnectorOperationContext["configurationPins"][number]["connectionRef"];
        validationReportRef: TrustedConnectorOperationContext["configurationPins"][number]["validationReportRef"];
        operationSetHash: TrustedConnectorOperationContext["configurationPins"][number]["operationSetHash"];
      }>;
      return Object.freeze({
        logicalRole: pin.logicalRole,
        capabilityKey: pin.capabilityKey,
        exactContractVersion: pin.exactContractVersion,
        bindingRef: pin.projectIntegrationBindingRef,
        profileRef: pin.profileRef,
        connectionRef: pin.connectionRef,
        validationReportRef: pin.validationReportRef,
        operationSetHash: pin.operationSetHash,
      });
    }),
  );
}

export function createLocalGitLabArtifactStorageAuthority(
  source: DataSource,
  environment: RuntimeEnvironment,
  transport: typeof fetch = fetch,
): GitLabArtifactStorageAuthority {
  if (
    !isGitLabLocalComposition(environment.composition) ||
    environment.environmentScope !== "LOCAL" ||
    !environment.mockHubUrl
  ) {
    throw new Error("GITLAB_ARTIFACT_LOCAL_AUTHORITY_REQUIRED");
  }
  const endpoint = new URL(environment.mockHubUrl);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "mock-hub"].includes(endpoint.hostname)
  ) {
    throw new Error("GITLAB_ARTIFACT_LOCAL_ENDPOINT_FORBIDDEN");
  }

  return Object.freeze({
    async materialize(
      reference: ArtifactStorageReference,
    ): Promise<GitLabArtifactStorageMaterialization> {
      const id = referenceId(reference);
      const rows = (await source.query(
        `
SELECT artifact.workspace_id,artifact.project_id,artifact.file_name,artifact.media_type,
       artifact.size_bytes,artifact.checksum,artifact.classification_key,
       membership.*,result.content_hash AS result_content_hash,
       attempt.authorization_basis_hash,attempt.executing_service_principal_id,
       session.target_snapshot,profile.content AS profile_content,profile.content_hash AS profile_content_hash,
       connection.content AS connection_content,connection.content_hash AS connection_content_hash,
       discovery.adapter_family,discovery.api_family,discovery.edition,discovery.exact_version,discovery.exact_build,
       discovery.numeric_project_id
FROM artifact_references artifact
JOIN qa_automation_artifact_memberships membership
  ON membership.workspace_id=artifact.workspace_id AND membership.project_id=artifact.project_id
 AND membership.artifact_reference_id=artifact.id
JOIN qa_automation_attempt_results result
  ON result.workspace_id=membership.workspace_id AND result.project_id=membership.project_id
 AND result.attempt_id=membership.attempt_id AND result.result_id=membership.result_id
JOIN qa_automation_attempts attempt
  ON attempt.workspace_id=membership.workspace_id AND attempt.project_id=membership.project_id
 AND attempt.attempt_id=membership.attempt_id
JOIN qa_test_sessions session
  ON session.workspace_id=membership.workspace_id AND session.project_id=membership.project_id
 AND session.session_id=membership.session_id
JOIN connector_profile_revisions profile
  ON profile.workspace_id=artifact.workspace_id AND profile.header_id=(membership.source_profile_ref->>'id')::uuid
 AND profile.version=(membership.source_profile_ref->>'version')::integer AND profile.status='PUBLISHED'
JOIN LATERAL (
  SELECT pin->'connectionRef' AS connection_ref
  FROM jsonb_array_elements(session.target_snapshot->'configurationPins') pin
  WHERE pin->>'logicalRole'='ARTIFACT_SOURCE'
) artifact_pin ON true
JOIN connection_revisions connection
  ON connection.workspace_id=artifact.workspace_id AND connection.header_id=(artifact_pin.connection_ref->>'id')::uuid
 AND connection.version=(artifact_pin.connection_ref->>'version')::integer AND connection.status='PUBLISHED'
JOIN gitlab_discovery_snapshots discovery
  ON discovery.workspace_id=artifact.workspace_id AND discovery.numeric_project_id>0
 AND discovery.validation_status='VALID' AND discovery.production_denied=true
WHERE artifact.id=$1 AND artifact.storage_provider_kind='GITLAB_CI'
ORDER BY discovery.collected_at DESC
LIMIT 1`,
        [id],
      )) as readonly Readonly<Record<string, unknown>>[];
      const row = rows[0];
      if (!row) throw new Error("GITLAB_ARTIFACT_AUTHORITY_NOT_FOUND");

      const target = json<
        Readonly<{ configurationPins: readonly Readonly<Record<string, unknown>>[] }>
      >(row.target_snapshot);
      const configurationPins = pins(target.configurationPins);
      const artifactPins = configurationPins.filter(
        ({ logicalRole }) => logicalRole === "ARTIFACT_SOURCE",
      );
      const artifactPin = artifactPins[0];
      const sourceProfileRef = json<{ id: string; version: number }>(row.source_profile_ref);
      if (
        artifactPins.length !== 1 ||
        !artifactPin ||
        artifactPin.profileRef.id !== sourceProfileRef.id ||
        artifactPin.profileRef.version !== sourceProfileRef.version ||
        artifactPin.profileRef.contentHash !== String(row.profile_content_hash) ||
        artifactPin.connectionRef.contentHash !== String(row.connection_content_hash)
      )
        throw new Error("GITLAB_ARTIFACT_CONFIGURATION_PIN_REVOKED");

      const connection = validateGitLabConnectionConfiguration(json(row.connection_content));
      const preflight = preflightGitLabProfile(json(row.profile_content), connection);
      if (preflight.status !== "SAFE_TO_DISCOVER" || !preflight.profile)
        throw new Error("GITLAB_ARTIFACT_PROFILE_REVOKED");
      const profile = preflight.profile;
      if (profile.numericGitLabProjectId !== Number(row.numeric_project_id))
        throw new Error("GITLAB_ARTIFACT_PROJECT_SCOPE_INVALID");
      const clock = Object.freeze({ now: () => new Date() });
      const auth = new GitLabAuth(
        connection,
        Object.freeze({
          async resolve(secretRef: string, allowedUseHash: Sha256Digest, signal: AbortSignal) {
            if (
              signal.aborted ||
              secretRef !== connection.identityReferences.read.reference ||
              allowedUseHash !== connection.identityReferences.read.referenceFingerprint
            ) {
              throw new Error("GITLAB_ARTIFACT_READ_CREDENTIAL_DENIED");
            }
            return Object.freeze({
              metadata: Object.freeze({ secretRef, allowedUseHash }),
              async use<T>(_now: Date, consumer: (material: Uint8Array) => Promise<T>): Promise<T> {
                return await consumer(new TextEncoder().encode("mock-gitlab-read"));
              },
            });
          },
        }),
        clock,
      );
      const client = new GitLabRestClient({
        baseUrl: endpoint.origin,
        numericProjectId: profile.numericGitLabProjectId,
        environmentClass: "LOCAL",
        allowedOrigins: Object.freeze([endpoint.origin]),
        allowedLocalHostnames: Object.freeze([endpoint.hostname]),
        transport,
        auth,
        clock,
        requestTimeoutMs: Number(profile.ratePolicy.requestTimeoutMs ?? 10_000),
      });
      const baseAuthority: GitLabArtifactAuthority = Object.freeze({
        workItemId: String(row.work_item_id),
        testSessionId: String(row.session_id),
        automationAttemptId: String(row.attempt_id),
        externalPipelineId: String(row.external_pipeline_id),
        externalJobId: String(row.external_job_id),
        logicalArtifactKey: `artifact-${Number(row.ordinal)}`,
        resultHash: String(row.result_content_hash) as Sha256Digest,
        artifactPath: String(row.logical_path),
        artifactKind: String(row.artifact_kind) as GitLabArtifactAuthority["artifactKind"],
        fileName: String(row.file_name),
        mediaType: String(row.media_type),
        byteSize: Number(row.size_bytes),
        checksum: String(row.checksum) as Sha256Digest,
        classification: String(row.classification_key),
        createdAt: new Date(String(row.registered_at)).toISOString(),
        expiresAt: new Date(String(row.expires_at)).toISOString(),
      });
      let activeStreamAuthority: GitLabArtifactStreamAuthority | undefined;
      const handler = new GitLabCiArtifactHandler({
        client,
        dialect: createGitLabDialect({
          adapterFamily: String(row.adapter_family) as "gitlab-rest-v4",
          apiFamily: String(row.api_family) as "v4",
          edition: String(row.edition) as "CE" | "EE",
          exactVersion: String(row.exact_version),
          exactBuild: String(row.exact_build),
          triggerDialect: profile.trigger.dialect,
          webhookDialect: profile.webhook.verificationMode,
        }),
        profile,
        clock,
        metadataAuthority: () => baseAuthority,
        streamAuthority: () => {
          if (!activeStreamAuthority) throw new Error("GITLAB_ARTIFACT_STREAM_AUTHORITY_NOT_BOUND");
          return activeStreamAuthority;
        },
      });
      const authorizationBasisHash = String(row.authorization_basis_hash) as Sha256Digest;
      const classification = defaultClassificationCatalog.reference(String(row.classification_key));
      const context: TrustedConnectorOperationContext = Object.freeze({
        scope: Object.freeze({
          kind: "PROJECT",
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
        }),
        actor: Object.freeze({
          kind: "SERVICE",
          principalId: String(row.executing_service_principal_id),
          serviceKey: "worker.gitlab-artifact",
        }),
        authorizationBasisHash,
        correlationId: String(row.correlation_id),
        causationId: String(row.causation_id),
        effectIdempotencyKey: `qa:artifact-stream:${id}:${authorizationBasisHash.slice("sha256:".length)}`,
        profileRef: artifactPin.profileRef,
        classification,
        signal: new AbortController().signal,
        configurationPins,
        deadlineAt: new Date(clock.now().getTime() + 60_000).toISOString(),
        telemetry: Object.freeze({
          correlationId: String(row.correlation_id),
          causationId: String(row.causation_id),
          operation: "artifact.stream",
        }),
      });
      const metadataRequest: CiArtifactMetadataRequest = Object.freeze({
        schemaVersion: "artifact.ci-read@1.0.0",
        messageType: "REQUEST",
        operation: "artifact.metadata",
        automationAttemptId: baseAuthority.automationAttemptId,
        externalPipelineId: baseAuthority.externalPipelineId,
        externalJobId: baseAuthority.externalJobId,
        logicalArtifactKey: baseAuthority.logicalArtifactKey,
        resultHash: baseAuthority.resultHash,
      });
      const authorizationRequestHash = digest(
        `${authorizationBasisHash}:${id}:${row.result_content_hash}`,
      );

      return Object.freeze({
        artifactReferenceId: id,
        scope: Object.freeze({
          workspaceId: String(row.workspace_id),
          projectId: String(row.project_id),
          numericProjectId: profile.numericGitLabProjectId,
        }),
        port: Object.freeze({
          metadata: handler.metadata.bind(handler),
          stream: handler.stream.bind(handler),
        }),
        context,
        metadataRequest,
        locator: Object.freeze({
          connectionHeaderId: artifactPin.connectionRef.id,
          connectionRef: artifactPin.connectionRef,
          profileRef: artifactPin.profileRef,
          artifactPathHash: digest(baseAuthority.artifactPath),
          sealedLocator: new TextEncoder().encode(
            JSON.stringify({
              artifactReferenceId: id,
              externalJobId: baseAuthority.externalJobId,
              artifactPath: baseAuthority.artifactPath,
            }),
          ),
        }),
        authorizedRequestRef: Object.freeze({
          id: deterministicUuid(`gitlab-artifact-request:${id}:${authorizationRequestHash}`),
          version: 1,
          contentHash: authorizationRequestHash,
        }),
        streamRequest(descriptor: CiArtifactDescriptor): CiArtifactStreamRequest {
          activeStreamAuthority = Object.freeze({
            ...baseAuthority,
            artifactReferenceId: id,
            descriptorId: descriptor.descriptorId,
            descriptorHash: descriptor.descriptorHash,
          });
          return Object.freeze({
            schemaVersion: "artifact.ci-read@1.0.0",
            messageType: "REQUEST",
            operation: "artifact.stream",
            artifactReferenceId: id,
            descriptorId: descriptor.descriptorId,
            descriptorHash: descriptor.descriptorHash,
            expectedByteSize: descriptor.byteSize,
            expectedChecksum: descriptor.checksum,
            expectedClassification: descriptor.classification,
          });
        },
      });
    },
  });
}
