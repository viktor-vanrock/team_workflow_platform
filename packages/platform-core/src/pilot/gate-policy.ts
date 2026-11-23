import type { ExactRevisionRef, ProjectScope } from "../project-onboarding/primitives.ts";
import {
  freezePilotValue,
  pilotContentHash,
  type PilotGateExecution,
  type PilotGateKind,
  type PilotOnboardingGateResult,
  samePilotRef,
} from "./model.ts";

export const gateRequirements: Readonly<Record<PilotGateKind, readonly string[]>> =
  freezePilotValue({
    L0: ["compatibility", "engineering"],
    C1: ["inputs"],
    N2: ["conformance", "ingress", "faults"],
    P3: ["N2", "security", "recovery", "shadow", "cohort", "baseline-protocol"],
  });

export interface PilotExecutionVerifier {
  /** Rehash report bytes, authenticate executor, scope, all child evidence and current fingerprints. */
  verify(execution: PilotGateExecution): Promise<boolean>;
}
export async function bridgePilotGate(
  input: ProjectScope &
    Readonly<{
      id: string;
      kind: PilotGateKind;
      subjectRef: ExactRevisionRef;
      evaluatedAt: string;
      evaluatorId: string;
      executions: readonly PilotGateExecution[];
    }>,
  verifier: PilotExecutionVerifier,
): Promise<PilotOnboardingGateResult> {
  input = freezePilotValue(structuredClone(input));
  const now = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(now) || !gateRequirements[input.kind] || !input.evaluatorId)
    throw new Error("PILOT_GATE_INPUT_INVALID");
  const required = gateRequirements[input.kind];
  const reasons = new Set<string>();
  let failed = false;
  let expiresAt = Infinity;
  const seen = new Set<string>();
  for (const run of input.executions) {
    if (seen.has(run.key) || !required.includes(run.key)) {
      failed = true;
      reasons.add("GATE_EXECUTION_UNEXPECTED");
    }
    seen.add(run.key);
    if (
      run.workspaceId !== input.workspaceId ||
      run.projectId !== input.projectId ||
      !samePilotRef(run.subjectRef, input.subjectRef)
    ) {
      failed = true;
      reasons.add("GATE_SCOPE_OR_SUBJECT_CONFLICT");
    }
    let verified = false;
    try {
      verified = await verifier.verify(run);
    } catch {
      /* Unavailable verification cannot authorize promotion. */
    }
    if (!verified) {
      failed = true;
      reasons.add("GATE_EVIDENCE_UNVERIFIED");
    }
    if (run.status === "FAIL" || run.checks.some((check) => check.status === "FAIL")) {
      failed = true;
      reasons.add("GATE_EXECUTION_FAILED");
    }
    if (
      run.status !== "PASS" ||
      !run.checks.length ||
      run.checks.some((check) => check.status !== "PASS")
    )
      reasons.add("GATE_EXECUTION_INCOMPLETE");
    if (new Set(run.checks.map(({ id }) => id)).size !== run.checks.length) {
      failed = true;
      reasons.add("GATE_CHECK_DUPLICATE");
    }
    const observed = Date.parse(run.evaluatedAt);
    const expiry = Date.parse(run.validUntil);
    if (
      run.assessment !== "CURRENT" ||
      !Number.isFinite(observed) ||
      observed > now ||
      !Number.isFinite(expiry) ||
      expiry <= now ||
      expiry <= observed
    )
      reasons.add("GATE_EVIDENCE_NOT_CURRENT");
    if (Number.isFinite(expiry)) expiresAt = Math.min(expiresAt, expiry);
  }
  if (required.some((key) => !seen.has(key))) reasons.add("GATE_EXECUTION_MISSING");
  const body: Omit<PilotOnboardingGateResult, "contentHash"> = {
    id: input.id,
    version: 1,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    gateKind: input.kind,
    subjectRef: { ...input.subjectRef },
    outcome: failed ? "FAIL" : reasons.size ? "BLOCKED_INPUT" : "PASS",
    safeIssueCodes: [...reasons].sort(),
    evidenceRefs: input.executions.map(({ reportRef }) => ({ ...reportRef })),
    evaluatedBy: input.evaluatorId,
    evaluatedAt: new Date(now).toISOString(),
    validUntil:
      Number.isFinite(expiresAt) && expiresAt > now ? new Date(expiresAt).toISOString() : null,
  };
  return freezePilotValue({ ...body, contentHash: pilotContentHash(body) });
}
