import type { QaScope } from "../domain/primitives.ts";
import type { QaPreviousSessionRef } from "../domain/qa-request-input-revision.ts";

export interface QaRetestLineageResolution {
  readonly valid: boolean;
  readonly code?: "RETEST_LINEAGE_INVALID" | "QA_NATIVE_SESSION_LINEAGE_UNAVAILABLE";
  readonly exactRef?: QaPreviousSessionRef;
}

export interface QaRetestLineageResolver {
  resolve(scope: QaScope, ref: QaPreviousSessionRef): Promise<QaRetestLineageResolution>;
}

export class QaUs2RetestLineageResolver implements QaRetestLineageResolver {
  async resolve(_scope: QaScope, ref: QaPreviousSessionRef): Promise<QaRetestLineageResolution> {
    if (ref.kind === "QA_SESSION")
      return Object.freeze({ valid: false, code: "QA_NATIVE_SESSION_LINEAGE_UNAVAILABLE" });
    const historical = ref.historicalSessionRef;
    if (!historical.id || !historical.version || !historical.contentHash.startsWith("sha256:"))
      return Object.freeze({ valid: false, code: "RETEST_LINEAGE_INVALID" });
    return Object.freeze({ valid: true, exactRef: structuredClone(ref) });
  }
}
