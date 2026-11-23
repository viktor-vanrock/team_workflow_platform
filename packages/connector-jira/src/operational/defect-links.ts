import type { RequestSubEffect } from "./request-create-reconciliation.ts";

export function planDefectLinks(
  input: Readonly<{
    requestExternalEntityId?: string;
    requestPublishedUrl?: string;
    sessionRef: string;
    buildRef: string;
    evidenceRefs: readonly string[];
    sameAuthority: boolean;
  }>,
): readonly RequestSubEffect[] {
  const effects: RequestSubEffect[] = [];
  if (input.sameAuthority) {
    if (!input.requestExternalEntityId) throw new Error("DEFECT_REQUEST_ID_REQUIRED");
    effects.push({
      kind: "LINK",
      semanticIdentity: `request:${input.requestExternalEntityId}`,
      payload: { externalEntityId: input.requestExternalEntityId },
    });
  } else {
    if (!input.requestPublishedUrl?.startsWith("https://"))
      throw new Error("DEFECT_REQUEST_PUBLISHED_URL_REQUIRED");
    effects.push({
      kind: "REMOTE_LINK",
      semanticIdentity: `request-url:${input.requestPublishedUrl}`,
      payload: { url: input.requestPublishedUrl },
    });
  }
  effects.push(
    {
      kind: "COMMENT",
      semanticIdentity: `session:${input.sessionRef}`,
      payload: { reference: input.sessionRef },
    },
    {
      kind: "COMMENT",
      semanticIdentity: `build:${input.buildRef}`,
      payload: { reference: input.buildRef },
    },
    ...input.evidenceRefs.map((reference) => ({
      kind: "COMMENT" as const,
      semanticIdentity: `evidence:${reference}`,
      payload: { reference },
    })),
  );
  return Object.freeze(effects);
}
