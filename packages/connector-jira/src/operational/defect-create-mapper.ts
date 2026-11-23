import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface DefectAuthorityPin {
  readonly sequence: number;
  readonly purpose: "PRIMARY" | "AUXILIARY";
  readonly logicalRole: string;
  readonly authorityNamespaceHash: string;
}
export interface DefectCreatePayload {
  readonly summary: string;
  readonly description: string;
  readonly findingRef: Readonly<Record<string, string>>;
  readonly sessionRef: Readonly<Record<string, string>>;
  readonly buildRef: Readonly<Record<string, string>>;
  readonly evidenceRefs: readonly Readonly<Record<string, string>>[];
}
export function createDefectMapping(
  input: Readonly<{
    effectId: string;
    effectMarker: string;
    target: Readonly<{ projectId: string; issueTypeId: string }>;
    payload: DefectCreatePayload;
    requiredFields: readonly string[];
    pins: readonly DefectAuthorityPin[];
  }>,
) {
  const configurationChain = [...input.pins].sort((a, b) => a.sequence - b.sequence);
  if (
    configurationChain[0]?.purpose !== "PRIMARY" ||
    configurationChain[0]?.logicalRole !== "DEFECT_DESTINATION" ||
    configurationChain[1]?.logicalRole !== "QA_REQUEST_AUTHORITY"
  )
    throw new Error("DEFECT_AUTHORITY_CHAIN_INVALID");
  const fields = Object.freeze({
    summary: input.payload.summary,
    description: input.payload.description,
    customfield_awp_effect: input.effectMarker,
  });
  for (const key of input.requiredFields)
    if (!(key in fields) || !fields[key as keyof typeof fields])
      throw new Error(`DEFECT_REQUIRED_FIELD_MISSING:${key}`);
  return Object.freeze({
    target: Object.freeze({ ...input.target }),
    fields,
    effectMarker: input.effectMarker,
    payloadHash: sha256({
      target: input.target,
      payload: input.payload,
      effectId: input.effectId,
    } as unknown as JsonValue),
    configurationChain: Object.freeze(configurationChain),
  });
}
