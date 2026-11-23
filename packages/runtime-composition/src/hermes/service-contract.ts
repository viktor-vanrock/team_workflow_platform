import { createHash } from "node:crypto";

import type { ProjectDialogueDraft } from "@awp/competency-ui-sdk";

import { advanceProjectDialogue } from "./project-dialogue.ts";

export const HERMES_PROJECT_DIALOGUE = "HERMES_PROJECT_DIALOGUE";
export const hermesBodyLimit = 16_384;
export const hermesResponseLimit = 32_768;
export interface HermesRequest {
  schemaVersion: 1;
  workspaceId: string;
  principalId: string;
  dialogueId: string;
  requestKey: string;
  expectedVersion: number;
  draft: ProjectDialogueDraft;
  message: string;
}
export type HermesProposal = ReturnType<typeof advanceProjectDialogue> & {
  schemaVersion: 1;
  requestHash: string;
  mode: "DETERMINISTIC" | "MODEL" | "DETERMINISTIC_FALLBACK";
  reasonCode?: "MODEL_UNAVAILABLE" | "SERVICE_UNAVAILABLE";
};
export interface HermesDialoguePort {
  advance(input: HermesRequest): Promise<HermesProposal>;
  ready(): Promise<boolean>;
}
const invalid = (): never => {
  throw new Error("HERMES_CONTRACT_INVALID");
};
export function hermesObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    return invalid();
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
  return value.trim();
}
export function parseHermesDraft(value: unknown): ProjectDialogueDraft {
  const draft = hermesObject(value, ["key", "name", "purpose"]);
  const key = bounded(draft.key, 32);
  if (!/^[A-Z][A-Z0-9_-]{1,31}$/u.test(key)) return invalid();
  return {
    key,
    ...(draft.name !== undefined ? { name: bounded(draft.name, 256) } : {}),
    ...(draft.purpose !== undefined ? { purpose: bounded(draft.purpose, 2000) } : {}),
  };
}
export function parseHermesRequest(value: unknown): HermesRequest {
  const input = hermesObject(value, [
    "schemaVersion",
    "workspaceId",
    "principalId",
    "dialogueId",
    "requestKey",
    "expectedVersion",
    "draft",
    "message",
  ]);
  if (
    input.schemaVersion !== 1 ||
    !Number.isSafeInteger(input.expectedVersion) ||
    Number(input.expectedVersion) < 1
  )
    return invalid();
  const id = (key: string) => {
    const value = bounded(input[key], 36);
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(value)) return invalid();
    return value;
  };
  return {
    schemaVersion: 1,
    workspaceId: id("workspaceId"),
    principalId: id("principalId"),
    dialogueId: id("dialogueId"),
    requestKey: id("requestKey"),
    expectedVersion: Number(input.expectedVersion),
    draft: parseHermesDraft(input.draft),
    message: bounded(input.message, 2000),
  };
}
export const hermesRequestHash = (input: HermesRequest) =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify(parseHermesRequest(input)))
    .digest("hex")}`;
export function describeHermesDraft(draft: ProjectDialogueDraft) {
  // The fixed local renderer determines state and reply, never model-generated instructions.
  return advanceProjectDialogue(draft, `Ключ: ${draft.key}`);
}
export function localHermesProposal(
  input: HermesRequest,
  reasonCode?: HermesProposal["reasonCode"],
): HermesProposal {
  let result: ReturnType<typeof advanceProjectDialogue>;
  try {
    result = advanceProjectDialogue(input.draft, input.message);
  } catch (error) {
    // A long initial description remains in dialogue history; ask for a short name
    // while allowing the model to extract the fields from that description.
    if (!input.draft.name && input.message.length > 256 && !/(?:^|\n)ключ:/iu.test(input.message))
      result = describeHermesDraft(input.draft);
    else throw error;
  }
  return {
    ...result,
    schemaVersion: 1,
    requestHash: hermesRequestHash(input),
    mode: reasonCode ? "DETERMINISTIC_FALLBACK" : "DETERMINISTIC",
    ...(reasonCode ? { reasonCode } : {}),
  };
}
export function parseHermesProposal(value: unknown, input: HermesRequest): HermesProposal {
  const result = hermesObject(value, [
    "schemaVersion",
    "requestHash",
    "draft",
    "state",
    "reply",
    "mode",
    "reasonCode",
  ]);
  const draft = parseHermesDraft(result.draft),
    rendered = describeHermesDraft(draft);
  if (
    result.schemaVersion !== 1 ||
    result.requestHash !== hermesRequestHash(input) ||
    result.state !== rendered.state ||
    result.reply !== rendered.reply ||
    !["DETERMINISTIC", "MODEL", "DETERMINISTIC_FALLBACK"].includes(String(result.mode)) ||
    (result.reasonCode !== undefined &&
      !["MODEL_UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(String(result.reasonCode)))
  )
    return invalid();
  return {
    ...rendered,
    schemaVersion: 1,
    requestHash: hermesRequestHash(input),
    mode: result.mode as HermesProposal["mode"],
    ...(result.reasonCode
      ? { reasonCode: result.reasonCode as NonNullable<HermesProposal["reasonCode"]> }
      : {}),
  };
}
