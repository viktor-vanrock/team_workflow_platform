import type { RequestSubEffect } from "./request-create-reconciliation.ts";

export function planSourceLink(
  input: Readonly<{
    sameAuthority: boolean;
    sourceExternalEntityId?: string;
    sourceUrl?: string;
    effectMarker: string;
  }>,
): RequestSubEffect {
  if (input.sameAuthority) {
    if (!input.sourceExternalEntityId) throw new Error("SOURCE_EXTERNAL_ID_REQUIRED");
    return Object.freeze({
      kind: "LINK",
      semanticIdentity: `issue:${input.sourceExternalEntityId}`,
      payload: Object.freeze({
        externalEntityId: input.sourceExternalEntityId,
        marker: input.effectMarker,
      }),
    });
  }
  if (!input.sourceUrl || !/^https:\/\//u.test(input.sourceUrl))
    throw new Error("PUBLISHED_SOURCE_URL_REQUIRED");
  return Object.freeze({
    kind: "REMOTE_LINK",
    semanticIdentity: `url:${input.sourceUrl}`,
    payload: Object.freeze({ url: input.sourceUrl, marker: input.effectMarker }),
  });
}
