import { evidenceContentHash } from "@awp/competency-qa";

export async function exportVerifiedEvidence<TPayload, TRedacted>(
  input: Readonly<{
    authorized: () => Promise<boolean>;
    verified: () => Promise<boolean>;
    payload: TPayload;
    redact: (payload: TPayload) => TRedacted;
    audit: (record: Readonly<{ status: "COMPLETED"; resultHash: `sha256:${string}` }>) => void;
  }>,
): Promise<Readonly<{ status: "COMPLETED"; payload: TRedacted; resultHash: `sha256:${string}` }>> {
  if (!(await input.authorized())) throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  if (!(await input.verified())) throw new Error("EVIDENCE_SIGNATURE_INVALID");
  if (!(await input.authorized())) throw new Error("PROJECT_RESOURCE_NOT_AVAILABLE");
  const payload = input.redact(input.payload);
  const resultHash = evidenceContentHash(payload);
  const result = Object.freeze({ status: "COMPLETED" as const, payload, resultHash });
  input.audit(Object.freeze({ status: "COMPLETED", resultHash }));
  return result;
}
