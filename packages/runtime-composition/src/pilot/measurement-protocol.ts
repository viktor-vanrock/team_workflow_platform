import { type PilotMetricKey, pilotMetricKeys } from "@awp/competency-qa";
import { type JsonValue, sha256, type Sha256Digest } from "@awp/platform-contracts";

export interface PilotHumanAttestation {
  readonly principalId: string;
  readonly kind: "HUMAN";
  readonly role: "QA_LEAD" | "SPONSOR";
  readonly subjectHash: Sha256Digest;
  readonly authorizationRef: string;
  readonly signedAt: string;
}

export interface MeasurementWindow {
  readonly startAt: string;
  readonly endAt: string;
}
export interface MeasurementProtocol {
  readonly protocolId: string;
  readonly version: number;
  readonly metricDefinitions: readonly PilotMetricKey[];
  readonly sourceMappings: Readonly<Record<string, "CORE" | "QA" | "CONNECTOR">>;
  readonly inclusionRules: readonly string[];
  readonly exclusionRules: readonly string[];
  readonly timezone: string;
  readonly baselineWindow: MeasurementWindow;
  readonly comparisonWindow: MeasurementWindow | null;
  readonly minimumSample: number | null;
  readonly targetValues: Readonly<Partial<Record<PilotMetricKey, number>>> | null;
  readonly baselineRef: Readonly<{
    id: string;
    contentHash: Sha256Digest;
    completedAt: string;
  }> | null;
  readonly missingDataPolicy: "REPORT_UNKNOWN_AND_INSUFFICIENT";
  readonly attestations: readonly PilotHumanAttestation[];
  readonly createdAt: string;
  readonly contentHash: Sha256Digest;
}

function assertWindow(window: MeasurementWindow): void {
  if (
    Number.isNaN(Date.parse(window.startAt)) ||
    Date.parse(window.endAt) <= Date.parse(window.startAt)
  )
    throw new Error("PILOT_MEASUREMENT_WINDOW_INVALID");
}

function assertAttestations(
  attestations: readonly PilotHumanAttestation[],
  subjectHash: Sha256Digest,
  createdAt: string,
): void {
  const qa = attestations.filter((value) => value.role === "QA_LEAD");
  const sponsor = attestations.filter((value) => value.role === "SPONSOR");
  if (
    qa.length !== 1 ||
    sponsor.length !== 1 ||
    qa[0]!.principalId === sponsor[0]!.principalId ||
    attestations.some(
      (value) =>
        value.kind !== "HUMAN" ||
        value.subjectHash !== subjectHash ||
        !value.authorizationRef ||
        Number.isNaN(Date.parse(value.signedAt)) ||
        Date.parse(value.signedAt) > Date.parse(createdAt),
    )
  ) {
    throw new Error("PILOT_MEASUREMENT_ATTESTATION_INVALID");
  }
}

export function measurementProtocolSubjectHash(
  input: Omit<MeasurementProtocol, "attestations" | "contentHash">,
): Sha256Digest {
  return sha256(input as unknown as JsonValue);
}

export function createMeasurementProtocol(
  input: Omit<MeasurementProtocol, "contentHash">,
): MeasurementProtocol {
  if (
    !input.protocolId ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    input.metricDefinitions.length === 0 ||
    new Set(input.metricDefinitions).size !== input.metricDefinitions.length ||
    input.metricDefinitions.some((key) => !pilotMetricKeys.includes(key))
  )
    throw new Error("PILOT_MEASUREMENT_PROTOCOL_INVALID");
  assertWindow(input.baselineWindow);
  if (input.comparisonWindow) assertWindow(input.comparisonWindow);
  const { attestations, ...unsigned } = input;
  const unsignedHash = measurementProtocolSubjectHash(unsigned);
  assertAttestations(attestations, unsignedHash, input.createdAt);
  if (input.targetValues === null) {
    if (
      input.baselineRef !== null ||
      input.comparisonWindow !== null ||
      input.minimumSample !== null
    )
      throw new Error("PILOT_BASELINE_PROTOCOL_ORDER_INVALID");
  } else {
    if (
      !input.baselineRef ||
      !input.comparisonWindow ||
      !Number.isSafeInteger(input.minimumSample) ||
      input.minimumSample! < 1 ||
      Date.parse(input.baselineRef.completedAt) >= Date.parse(input.createdAt) ||
      Date.parse(input.comparisonWindow.startAt) < Date.parse(input.createdAt) ||
      Object.keys(input.targetValues).some(
        (key) => !input.metricDefinitions.includes(key as PilotMetricKey),
      )
    ) {
      throw new Error("PILOT_COMPARISON_PROTOCOL_ORDER_INVALID");
    }
  }
  const body = structuredClone(input);
  return Object.freeze({ ...body, contentHash: sha256(body as unknown as JsonValue) });
}
