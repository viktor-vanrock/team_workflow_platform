import { FakeQaDraftAssistant, type QaDraftAssistant } from "@awp/competency-qa/node";

export type QaFakeDraftAssistantMode = "unset" | "valid" | "invalid" | "timeout" | "error";

export function createFakeQaDraftAssistant(
  source: NodeJS.ProcessEnv,
): Readonly<{ assistant?: QaDraftAssistant; mode: QaFakeDraftAssistantMode; provenance: string }> {
  const mode = (source.AWP_QA_DRAFT_ASSISTANT?.trim().toLowerCase() ||
    "unset") as QaFakeDraftAssistantMode;
  if (mode === "unset")
    return Object.freeze({ mode, provenance: "deterministic-fallback:MODEL_UNSET" });
  if (!(["valid", "invalid", "timeout", "error"] as const).includes(mode))
    return Object.freeze({
      mode: "unset",
      provenance: "deterministic-fallback:MODEL_CONFIGURATION_INVALID",
    });
  const behavior =
    mode === "valid"
      ? "VALID"
      : mode === "invalid"
        ? "INVALID"
        : mode === "timeout"
          ? "TIMEOUT"
          : "ERROR";
  return Object.freeze({
    assistant: new FakeQaDraftAssistant(behavior),
    mode,
    provenance: `fake-qa-draft-assistant:${mode}`,
  });
}
