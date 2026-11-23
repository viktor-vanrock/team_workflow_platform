import { canonicalize, type JsonValue, sha256 } from "@awp/platform-contracts/canonical-hash";

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

export const INPUT_REQUIREMENTS_008 = Object.freeze({
  "IN-01": [
    "workspaceRef",
    "projectRefs",
    "workflowRef",
    "suiteRef",
    "environmentRef",
    "channelRefs",
  ],
  "IN-02": ["providers"],
  "IN-03": [
    "issuer",
    "audience",
    "tokenDialect",
    "groupMappingRef",
    "sessionPolicyRef",
    "stepUpPolicyRef",
  ],
  "IN-04": [
    "authMethod",
    "resolverPolicyRef",
    "secretRefs",
    "signingPolicyRef",
    "rotationPolicyRef",
    "breakGlassRef",
  ],
  "IN-05": ["origins", "trustPolicyRef", "egressPolicyRef", "callbackRoutes", "ingressPolicyRef"],
  "IN-06": ["telemetryPolicyRef", "retentionPolicyRef", "alertRouteRef", "onCallOwner"],
  "IN-07": ["artifactMode", "retentionPolicyRef", "verificationPolicyRef", "exportPolicyRef"],
  "IN-08": [
    "backupMethod",
    "destinationRef",
    "recoveryPolicyRef",
    "fencePolicyRef",
    "restoreOwner",
  ],
  "IN-09": ["scanPolicyRef", "scannerRef", "freshnessPolicyRef", "findingOwner"],
  "IN-10": ["cohortRef", "humanRefs", "sponsorRef", "qaLeadRef", "windowPolicyRef"],
  "IN-11": ["baselineMethod", "sourceRefs", "measurementProtocolRef", "spotCheckPolicyRef"],
  "IN-12": ["incidentRunbookRef", "rollbackRunbookRef", "resumePolicyRef", "onCallOwner"],
} as const);
export type InputId008 = keyof typeof INPUT_REQUIREMENTS_008;
export type InputStage008 = "C1" | "N2" | "P3";
function jsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return value.length <= 1000 && value.every((x) => jsonValue(x, depth + 1));
  return (
    record(value) &&
    Object.keys(value).length <= 200 &&
    Object.values(value).every((x) => jsonValue(x, depth + 1))
  );
}
export function canonicalInputHash008(value: unknown): string {
  if (!jsonValue(value)) throw new Error("INVALID_JSON_VALUE");
  return sha256(canonicalize(value));
}
export function containsSensitiveValue008(value: unknown): boolean {
  if (typeof value === "string")
    return /(?:bearer\s+\S+|-----BEGIN .*PRIVATE KEY|eyJ[A-Za-z0-9_-]{12,}\.|https?:\/\/[^\s/]+:[^\s/]+@)/iu.test(
      value,
    );
  if (Array.isArray(value)) return value.some(containsSensitiveValue008);
  return (
    record(value) &&
    Object.entries(value).some(
      ([key, v]) =>
        /^(?:password|clientSecret|privateKey|accessToken|refreshToken|secretValue|credentialValue|authorization|cookie|rawTestData)$/iu.test(
          key,
        ) || containsSensitiveValue008(v),
    )
  );
}
export function validateInputPackage008(
  value: unknown,
  stage: InputStage008 = "C1",
  now = Date.now(),
) {
  const reasonCodes: string[] = [],
    missingInputIds: string[] = [],
    validInputIds: string[] = [];
  const result = () => ({
    status: reasonCodes.length
      ? ("FAIL" as const)
      : missingInputIds.length
        ? ("BLOCKED_INPUT" as const)
        : ("PASS" as const),
    stage,
    corporateReady: false as const,
    validInputIds,
    missingInputIds,
    reasonCodes,
    inputHash: jsonValue(value) ? canonicalInputHash008(value) : undefined,
  });
  if (!jsonValue(value) || !record(value)) {
    reasonCodes.push("INPUT_SHAPE_INVALID");
    return result();
  }
  if (containsSensitiveValue008(value)) {
    reasonCodes.push("INLINE_SENSITIVE_DATA_FORBIDDEN");
    return { ...result(), inputHash: undefined };
  }
  if (
    Object.keys(value).some(
      (k) => !["schemaVersion", "id", "version", "profile", "scope", "entries"].includes(k),
    )
  )
    reasonCodes.push("INPUT_UNKNOWN_FIELD");
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    !value.id ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    !["local", "integration", "pilot"].includes(String(value.profile))
  )
    reasonCodes.push("INPUT_HEADER_INVALID");
  const scope = record(value.scope) ? value.scope : undefined;
  if (
    !scope ||
    typeof scope.workspaceId !== "string" ||
    !scope.workspaceId ||
    !Array.isArray(scope.projectIds) ||
    scope.projectIds.length === 0 ||
    scope.projectIds.some((x) => typeof x !== "string" || !x) ||
    new Set(scope.projectIds).size !== scope.projectIds.length
  )
    reasonCodes.push("INPUT_SCOPE_INVALID");
  if (
    value.profile !== "local" &&
    /fixture:|fixture-|STATEFUL_MOCK|\.fixture\.invalid/u.test(JSON.stringify(value))
  )
    reasonCodes.push("LOCAL_COMPONENT_REFERENCE_FORBIDDEN");
  if (!Array.isArray(value.entries)) {
    reasonCodes.push("INPUT_ENTRIES_INVALID");
    return result();
  }
  const seen = new Set<string>();
  for (const raw of value.entries) {
    if (
      !record(raw) ||
      typeof raw.id !== "string" ||
      !Object.hasOwn(INPUT_REQUIREMENTS_008, raw.id)
    ) {
      reasonCodes.push("INPUT_ID_INVALID");
      continue;
    }
    const id = raw.id as InputId008;
    if (seen.has(id)) {
      reasonCodes.push(`INPUT_DUPLICATE:${id}`);
      continue;
    }
    seen.add(id);
    const before = reasonCodes.length;
    if (
      Object.keys(raw).some(
        (k) =>
          ![
            "id",
            "version",
            "workspaceId",
            "projectIds",
            "synthetic",
            "status",
            "suppliedBy",
            "reviewedBy",
            "reviewedAt",
            "evidenceRef",
            "metadata",
            "contentHash",
          ].includes(k),
      )
    )
      reasonCodes.push(`ENTRY_UNKNOWN_FIELD:${id}`);
    if (
      raw.workspaceId !== scope?.workspaceId ||
      !Array.isArray(raw.projectIds) ||
      !raw.projectIds.length ||
      raw.projectIds.some((p) => !Array.isArray(scope?.projectIds) || !scope.projectIds.includes(p))
    )
      reasonCodes.push(`ENTRY_SCOPE_MISMATCH:${id}`);
    if (
      !Number.isSafeInteger(raw.version) ||
      Number(raw.version) < 1 ||
      [raw.suppliedBy, raw.reviewedBy, raw.evidenceRef].some((x) => typeof x !== "string" || !x)
    )
      reasonCodes.push(`ENTRY_PROVENANCE_MISSING:${id}`);
    if (raw.status !== undefined && raw.status !== "ACCEPTED")
      reasonCodes.push(`ENTRY_STATUS_INVALID:${id}`);
    if (value.profile !== "local" && raw.status !== "ACCEPTED")
      reasonCodes.push(`ENTRY_STATUS_NOT_ACCEPTED:${id}`);
    const reviewedAt = Date.parse(String(raw.reviewedAt ?? ""));
    if (!Number.isFinite(reviewedAt) || reviewedAt > now + 60_000)
      reasonCodes.push(`ENTRY_REVIEW_TIME_INVALID:${id}`);
    if (typeof raw.synthetic !== "boolean" || (value.profile !== "local" && raw.synthetic))
      reasonCodes.push(`SYNTHETIC_CORPORATE_INPUT:${id}`);
    const metadata = record(raw.metadata) ? raw.metadata : undefined;
    if (
      !metadata ||
      INPUT_REQUIREMENTS_008[id].some(
        (field) =>
          !Object.hasOwn(metadata, field) ||
          metadata[field] === null ||
          metadata[field] === "" ||
          (Array.isArray(metadata[field]) && metadata[field].length === 0),
      )
    )
      reasonCodes.push(`ENTRY_METADATA_INCOMPLETE:${id}`);
    if (metadata) {
      const listFields = new Set([
        "projectRefs",
        "channelRefs",
        "secretRefs",
        "origins",
        "callbackRoutes",
        "humanRefs",
        "sourceRefs",
      ]);
      for (const field of INPUT_REQUIREMENTS_008[id]) {
        const v = metadata[field];
        if (field === "providers") continue;
        if (
          listFields.has(field)
            ? !Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== "string" || !x)
            : typeof v !== "string" || !v
        )
          reasonCodes.push(`ENTRY_FIELD_TYPE_INVALID:${id}:${field}`);
      }
      if (id === "IN-07" && metadata.artifactMode !== "GITLAB_ONLY")
        reasonCodes.push("ARTIFACT_MODE_INVALID");
      if (id === "IN-08" && !["LOGICAL", "PHYSICAL_PITR"].includes(String(metadata.backupMethod)))
        reasonCodes.push("BACKUP_METHOD_INVALID");
    }
    if (metadata && id === "IN-02") {
      const providers = metadata.providers;
      if (
        !Array.isArray(providers) ||
        providers.length !== 3 ||
        new Set(providers.filter(record).map((p) => p.type)).size !== 3 ||
        providers.some(
          (p) =>
            !record(p) ||
            !["JIRA", "GITLAB", "MATTERMOST"].includes(String(p.type)) ||
            [
              p.edition,
              p.version,
              p.apiDialect,
              p.authStrategy,
              p.documentRef,
              p.permissionsRef,
            ].some((x) => typeof x !== "string" || !x || /^(?:latest|unknown|tbd)$/iu.test(x)),
        )
      )
        reasonCodes.push("PROVIDER_METADATA_UNPINNED");
    }
    if (metadata && id === "IN-03" && typeof metadata.issuer === "string") {
      try {
        const url = new URL(metadata.issuer);
        if (
          url.username ||
          url.password ||
          url.hash ||
          (value.profile !== "local" && url.protocol !== "https:")
        )
          reasonCodes.push("OIDC_ISSUER_UNSAFE");
      } catch {
        reasonCodes.push("OIDC_ISSUER_INVALID");
      }
    }
    const body = { ...raw };
    delete body.contentHash;
    if (raw.contentHash !== canonicalInputHash008(body))
      reasonCodes.push(`ENTRY_HASH_MISMATCH:${id}`);
    if (reasonCodes.length === before) validInputIds.push(id);
  }
  const required =
    stage === "C1" && value.profile !== "local"
      ? ["IN-01", "IN-02", "IN-03", "IN-04", "IN-05"]
      : Object.keys(INPUT_REQUIREMENTS_008);
  missingInputIds.push(...required.filter((id) => !seen.has(id)));
  return result();
}
