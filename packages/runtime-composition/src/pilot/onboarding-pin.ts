import {
  type ExactRevisionRef,
  isSystemAdministratorRole,
  pilotContentHash,
  type ProjectScope,
  samePilotRef,
} from "@awp/platform-core";

interface QueryPort {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}
type Onboarding = Readonly<{
  onboardingId: string;
  revisionId: string;
  workspaceId: string;
  projectId: string;
  version: number;
  stage: string;
  operationalState: string;
  contentHash: string;
  causationId?: string;
  actor?: { principalId?: string };
  reasonCode?: string;
}>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const verified = (value: Onboarding) => {
  const { contentHash, ...body } = value;
  return pilotContentHash(body) === contentHash;
};

/** A pre-activation pin survives only its exact, independently approved activation. */
export async function matchesPilotOnboardingPin(
  source: QueryPort,
  scope: ProjectScope,
  pin: ExactRevisionRef,
  current: Onboarding,
): Promise<boolean> {
  if (
    !verified(current) ||
    current.workspaceId !== scope.workspaceId ||
    current.projectId !== scope.projectId ||
    current.stage !== "PILOT_ACTIVE" ||
    current.operationalState !== "ACTIVE"
  )
    return false;
  if (
    pin.version === current.version &&
    pin.contentHash === current.contentHash &&
    [current.revisionId, current.onboardingId].includes(pin.id)
  )
    return true;
  if (
    pin.version + 1 !== current.version ||
    !current.causationId ||
    !uuid.test(current.causationId)
  )
    return false;
  const rows = (await source.query(
    `SELECT r.semantic_body AS previous,r.content_hash,c.semantic_body AS candidate,c.content_hash AS persisted_hash,
            a.candidate_ref,a.candidate_hash AS action_hash,ap.subject,ap.subject_hash,ap.decision_state,ap.effect_authorization_state
     FROM project_onboarding_revisions r
     JOIN platform_actions a ON a.workspace_id=r.workspace_id AND a.project_id=r.project_id AND a.id=$5
     JOIN project_operational_action_candidates c ON (c.workspace_id,c.project_id,c.action_id)=(a.workspace_id,a.project_id,a.id)
     JOIN approvals ap ON (ap.workspace_id,ap.project_id,ap.action_id)=(a.workspace_id,a.project_id,a.id)
     WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.onboarding_id=$3 AND r.version=$4
       AND a.action_kind='ONBOARDING_PILOT_ACTIVATE' AND a.state='COMPLETED'
       AND c.action_kind='ONBOARDING_PILOT_ACTIVATE' AND ap.decision_state='APPROVED'
       AND ap.effect_authorization_state='CONSUMED' LIMIT 2`,
    [scope.workspaceId, scope.projectId, current.onboardingId, pin.version, current.causationId],
  )) as readonly {
    previous: Onboarding;
    content_hash: string;
    candidate: Record<string, unknown>;
    persisted_hash: string;
    action_hash: string;
    candidate_ref: Record<string, unknown>;
    subject: Record<string, unknown>;
    subject_hash: string;
  }[];
  if (rows.length !== 1) return false;
  const row = rows[0]!,
    previous = row.previous,
    candidate = row.candidate,
    approval = row.subject;
  if (
    !previous ||
    !verified(previous) ||
    previous.contentHash !== row.content_hash ||
    previous.workspaceId !== scope.workspaceId ||
    previous.projectId !== scope.projectId ||
    previous.onboardingId !== current.onboardingId ||
    previous.version !== pin.version ||
    previous.stage !== "SHADOW" ||
    previous.operationalState !== "ACTIVE" ||
    ![previous.revisionId, previous.onboardingId].includes(pin.id) ||
    previous.contentHash !== pin.contentHash ||
    !candidate ||
    !approval
  )
    return false;
  const { contentHash: candidateHash, ...candidateBody } = candidate;
  const initiator = candidate.initiator as { principalId?: unknown } | undefined;
  const approver = approval.approver as { principalId?: unknown; roleKey?: unknown } | undefined;
  return (
    candidateHash === row.persisted_hash &&
    candidateHash === row.action_hash &&
    candidateHash === row.subject_hash &&
    pilotContentHash(candidateBody) === candidateHash &&
    pilotContentHash(row.candidate_ref) === pilotContentHash(candidate) &&
    candidate.kind === "ONBOARDING_PILOT_ACTIVATE" &&
    candidate.actionId === current.causationId &&
    candidate.workspaceId === scope.workspaceId &&
    candidate.projectId === scope.projectId &&
    candidate.expectedOnboardingVersion === pin.version &&
    samePilotRef(candidate.targetRef as ExactRevisionRef, {
      id: previous.revisionId,
      version: previous.version,
      contentHash: previous.contentHash as `sha256:${string}`,
    }) &&
    approval.actionKind === candidate.kind &&
    approval.actionId === candidate.actionId &&
    approval.targetHash === candidateHash &&
    approval.initiatorPrincipalId === initiator?.principalId &&
    typeof approver?.principalId === "string" &&
    approver.principalId !== initiator?.principalId &&
    typeof approver.roleKey === "string" &&
    isSystemAdministratorRole(approver.roleKey) &&
    current.actor?.principalId === approver.principalId &&
    current.reasonCode === "ONBOARDING_PILOT_ACTIVATED" &&
    typeof approval.stepUpAt === "string" &&
    Number.isFinite(Date.parse(approval.stepUpAt))
  );
}
