export interface ExternalEntityObservationSignal {
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly connectionRef: Readonly<{ id: string; version: number }>;
  readonly externalEntityType: string;
  readonly externalEntityId: string;
  readonly deliveryIdentity: string;
  readonly action: "AUTHORITATIVE_REREAD_REQUIRED";
  readonly receivedAt: string;
}

export function assertExternalObservationSignal(signal: ExternalEntityObservationSignal): void {
  if (
    !signal.connectionRef.id ||
    !signal.externalEntityId ||
    !signal.deliveryIdentity ||
    signal.action !== "AUTHORITATIVE_REREAD_REQUIRED"
  )
    throw new Error("EXTERNAL_OBSERVATION_SIGNAL_INVALID");
}
