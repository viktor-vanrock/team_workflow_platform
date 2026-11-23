import type { Sha256Digest } from "@awp/platform-contracts";

export interface EvidenceExportRequest {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly subjectRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly requesterPrincipalId: string;
  readonly redactionPolicyRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
  readonly exportPolicyRef: Readonly<{ id: string; version: number; contentHash: Sha256Digest }>;
}

export interface EvidenceExportPort {
  export(request: EvidenceExportRequest): Promise<
    Readonly<{
      status: "COMPLETED" | "DENIED" | "FAILED";
      resultHash?: Sha256Digest;
      safeReasonCode?: string;
    }>
  >;
}
