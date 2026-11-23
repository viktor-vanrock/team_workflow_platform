import type { QaContentHash, QaExactReference, QaHumanActor } from "./primitives.ts";

export interface QaPostCloseCorrectionMarker {
  readonly markerId: string;
  readonly manifestId: string;
  readonly previousRevisionRef: QaExactReference;
  readonly clericalRevisionRef: QaExactReference;
  readonly annotations: readonly Readonly<{ field: string; reason: string }>[];
  readonly basis: "HUMAN";
  readonly actor: QaHumanActor;
  readonly authorizationBasisHash: QaContentHash;
  readonly recordedAt: string;
}
