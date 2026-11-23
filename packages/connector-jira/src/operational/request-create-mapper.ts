import { type JsonValue, sha256 } from "@awp/platform-contracts";

export interface RequestCreatePin {
  readonly sequence: number;
  readonly purpose: "PRIMARY" | "AUXILIARY";
  readonly logicalRole: string;
  readonly authorityNamespaceHash: string;
  readonly profileRef: Readonly<{ id: string; version: number }>;
  readonly mappingRef: Readonly<{ id: string; version: number }>;
  readonly connectionRef: Readonly<{ id: string; version: number }>;
}
export interface RequestCreatePinSet {
  readonly entries: readonly RequestCreatePin[];
}
export interface RequestCreateIdentity {
  readonly effectId: string;
  readonly effectMarker: string;
  readonly configurationHash: string;
}
export interface QaRequestMapping {
  readonly target: Readonly<{
    projectId: string;
    issueTypeId: string;
    projectDiscriminator: string;
  }>;
  readonly fields: Readonly<Record<string, JsonValue>>;
  readonly effectMarker: string;
  readonly payloadHash: `sha256:${string}`;
  readonly configurationChain: readonly RequestCreatePin[];
  readonly subEffects: readonly Readonly<{
    kind: "LINK" | "REMOTE_LINK" | "COMMENT";
    semanticIdentity: string;
    payload: Readonly<Record<string, JsonValue>>;
  }>[];
}

export function createQaRequestMapping(
  input: Readonly<{
    identity: RequestCreateIdentity;
    title: string;
    description: string;
    projectDiscriminator: string;
    projectId: string;
    issueTypeId: string;
    pins: RequestCreatePinSet;
  }>,
): QaRequestMapping {
  const configurationChain = [...input.pins.entries].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (
    configurationChain[0]?.purpose !== "PRIMARY" ||
    configurationChain[0]?.logicalRole !== "QA_REQUEST_AUTHORITY"
  )
    throw new Error("REQUEST_CREATE_PRIMARY_PIN_INVALID");
  if (configurationChain[1]?.logicalRole !== "SOURCE_CONTEXT")
    throw new Error("REQUEST_CREATE_SOURCE_CONTEXT_REQUIRED");
  const target = Object.freeze({
    projectId: input.projectId,
    issueTypeId: input.issueTypeId,
    projectDiscriminator: input.projectDiscriminator,
  });
  const fields = Object.freeze({
    summary: input.title,
    description: input.description,
    customfield_awp_project: input.projectDiscriminator,
    customfield_awp_effect: input.identity.effectMarker,
  });
  const subEffects = Object.freeze([
    {
      kind: "REMOTE_LINK" as const,
      semanticIdentity: `source:${input.identity.effectId}`,
      payload: Object.freeze({ marker: input.identity.effectMarker }),
    },
  ]);
  return Object.freeze({
    target,
    fields,
    effectMarker: input.identity.effectMarker,
    payloadHash: sha256({
      target,
      fields,
      configurationHash: input.identity.configurationHash,
    } as JsonValue),
    configurationChain: Object.freeze(configurationChain),
    subEffects,
  });
}
