import {
  assertExactRevisionRef,
  assertProjectScope,
  type BindingFunctionalAcceptance,
  type ExactRevisionRef,
  type HumanActorSnapshot,
  onboardingContentHash,
  type ProjectScope,
} from "@awp/platform-core";

export interface BindingAcceptanceInput extends ProjectScope {
  readonly acceptanceId: string;
  readonly bindingRef: ExactRevisionRef;
  readonly validationReportRef: ExactRevisionRef;
  readonly qaProjectContextRef: ExactRevisionRef;
  readonly acceptedResourceRefs: readonly ExactRevisionRef[];
  readonly checklistRef: ExactRevisionRef;
  readonly acceptedBy: HumanActorSnapshot;
  readonly acceptedAt: string;
  readonly safeIssueCodes?: readonly string[];
  readonly automationAcceptance?: Readonly<{
    readonly suiteRef: ExactRevisionRef;
    readonly bindingRef: ExactRevisionRef;
    readonly environmentRef: ExactRevisionRef;
    readonly evidencePolicyRef: ExactRevisionRef;
    readonly pipelineContractHash: string;
    readonly expectedPipelineContractHash: string;
    readonly safeIssueCodes: readonly string[];
  }>;
}

export function acceptBindingFunctionally(
  input: BindingAcceptanceInput,
): BindingFunctionalAcceptance {
  assertProjectScope(input);
  for (const ref of [
    input.bindingRef,
    input.validationReportRef,
    input.qaProjectContextRef,
    input.checklistRef,
    ...input.acceptedResourceRefs,
  ]) {
    assertExactRevisionRef(ref);
  }
  if (!input.acceptanceId || Number.isNaN(Date.parse(input.acceptedAt)))
    throw new Error("BINDING_ACCEPTANCE_INVALID");
  if (input.acceptedBy.kind !== "HUMAN" || input.acceptedBy.roleKey !== "qa-lead")
    throw new Error("BINDING_ACCEPTANCE_QA_LEAD_REQUIRED");
  const automation = input.automationAcceptance;
  if (automation) {
    for (const ref of [
      automation.suiteRef,
      automation.bindingRef,
      automation.environmentRef,
      automation.evidencePolicyRef,
    ])
      assertExactRevisionRef(ref);
  }
  const automationIssues =
    automation === undefined
      ? []
      : [
          ...automation.safeIssueCodes,
          ...(automation.bindingRef.id !== input.bindingRef.id ||
          automation.bindingRef.version !== input.bindingRef.version ||
          automation.bindingRef.contentHash !== input.bindingRef.contentHash
            ? ["AUTOMATION_BINDING_MISMATCH"]
            : []),
          ...(automation.pipelineContractHash !== automation.expectedPipelineContractHash
            ? ["PIPELINE_CONTRACT_MISMATCH"]
            : []),
          ...(!input.acceptedResourceRefs.some(
            (ref) =>
              ref.id === automation.suiteRef.id &&
              ref.version === automation.suiteRef.version &&
              ref.contentHash === automation.suiteRef.contentHash,
          )
            ? ["AUTOMATION_SUITE_NOT_ACCEPTED"]
            : []),
          ...(!input.acceptedResourceRefs.some(
            (ref) =>
              ref.id === automation.environmentRef.id &&
              ref.version === automation.environmentRef.version &&
              ref.contentHash === automation.environmentRef.contentHash,
          )
            ? ["AUTOMATION_ENVIRONMENT_NOT_ACCEPTED"]
            : []),
          ...(!input.acceptedResourceRefs.some(
            (ref) =>
              ref.id === automation.evidencePolicyRef.id &&
              ref.version === automation.evidencePolicyRef.version &&
              ref.contentHash === automation.evidencePolicyRef.contentHash,
          )
            ? ["EVIDENCE_POLICY_NOT_ACCEPTED"]
            : []),
        ];
  const safeIssueCodes = Object.freeze(
    [...new Set([...(input.safeIssueCodes ?? []), ...automationIssues])].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  const acceptedResourceRefs = Object.freeze(
    [...input.acceptedResourceRefs].sort((left, right) =>
      `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`),
    ),
  );
  const body = {
    acceptanceId: input.acceptanceId,
    version: 1 as const,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    bindingRef: input.bindingRef,
    validationReportRef: input.validationReportRef,
    qaProjectContextRef: input.qaProjectContextRef,
    acceptedResourceRefs,
    checklistRef: input.checklistRef,
    outcome: safeIssueCodes.length === 0 ? ("ACCEPTED" as const) : ("REJECTED" as const),
    safeIssueCodes,
    acceptedBy: input.acceptedBy,
    acceptedAt: input.acceptedAt,
  };
  return Object.freeze({ ...body, contentHash: onboardingContentHash(body as never) });
}
