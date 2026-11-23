import { createHash } from "node:crypto";

export interface RecoveryInventory008 {
  readonly schemaPins: Readonly<Record<string, number>>;
  readonly expectedSchemaPins: Readonly<Record<string, number>>;
  readonly bindings: readonly {
    readonly id: string;
    readonly expectedHash: string;
    readonly actualHash: string;
  }[];
  readonly audit: readonly {
    readonly id: string;
    readonly previousHash: string | null;
    readonly body: unknown;
    readonly contentHash: string;
  }[];
  readonly signatures: readonly {
    readonly id: string;
    readonly publicKeyRef: string;
    readonly status: "VALID" | "INVALID" | "KEY_UNAVAILABLE";
  }[];
  readonly artifacts: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly state: "AVAILABLE" | "EXPIRED" | "UNAVAILABLE";
    readonly metadataHash: string;
    readonly bytesHash?: string;
  }[];
  readonly secretStoreOwnerEvidenceRef: string | null;
}
const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
export function verifyRecoveryInventory008(input: RecoveryInventory008) {
  const failures: string[] = [];
  if (JSON.stringify(input.schemaPins) !== JSON.stringify(input.expectedSchemaPins))
    failures.push("RECOVERY_SCHEMA_PIN_MISMATCH");
  if (input.bindings.some((value) => value.actualHash !== value.expectedHash))
    failures.push("RECOVERY_BINDING_MISMATCH");
  let previous: string | null = null;
  for (const event of input.audit) {
    if (
      event.previousHash !== previous ||
      event.contentHash !==
        hash({ id: event.id, previousHash: event.previousHash, body: event.body })
    )
      failures.push("RECOVERY_AUDIT_CHAIN_INVALID");
    previous = event.contentHash;
  }
  if (input.signatures.some((value) => !value.publicKeyRef || value.status !== "VALID"))
    failures.push("RECOVERY_SIGNATURE_INVALID");
  if (
    input.artifacts.some(
      (value) =>
        !value.metadataHash ||
        (value.required && (value.state !== "AVAILABLE" || !value.bytesHash)),
    )
  )
    failures.push("RECOVERY_REQUIRED_ARTIFACT_MISSING");
  if (!input.secretStoreOwnerEvidenceRef) failures.push("RECOVERY_SECRET_OWNER_EVIDENCE_MISSING");
  return Object.freeze({
    status: failures.length ? ("FAIL" as const) : ("PASS" as const),
    reasonCodes: Object.freeze([...new Set(failures)]),
    measurements: Object.freeze({
      auditEvents: input.audit.length,
      signatures: input.signatures.length,
      requiredArtifacts: input.artifacts.filter((value) => value.required).length,
      expiredArtifactsWithMetadata: input.artifacts.filter(
        (value) => value.state === "EXPIRED" && !!value.metadataHash,
      ).length,
    }),
  });
}
export function recoveryAuditHash008(
  id: string,
  previousHash: string | null,
  body: unknown,
): string {
  return hash({ id, previousHash, body });
}
