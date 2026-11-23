export interface DummyIntakeInput {
  readonly sampleName: string;
  readonly message: string;
}
export interface DummyHistoryEntry {
  readonly at: string;
  readonly action: "CREATED" | "VIEWED";
  readonly actorId: string;
}
export interface DummyRequest {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly sampleName: string;
  readonly message: string;
  readonly history: readonly DummyHistoryEntry[];
  readonly rowVersion: number;
  readonly createdAt: Date;
}

export function validateDummyIntake(value: unknown): DummyIntakeInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Dummy intake must be an object");
  const object = value as Record<string, unknown>;
  if (
    typeof object.sampleName !== "string" ||
    object.sampleName.trim().length < 1 ||
    object.sampleName.length > 120
  )
    throw new Error("sampleName is required and must be at most 120 characters");
  if (
    typeof object.message !== "string" ||
    object.message.trim().length < 1 ||
    object.message.length > 2000
  )
    throw new Error("message is required and must be at most 2000 characters");
  if (Object.keys(object).some((key) => key !== "sampleName" && key !== "message"))
    throw new Error("Unknown Dummy intake fields are forbidden");
  return Object.freeze({ sampleName: object.sampleName, message: object.message });
}
