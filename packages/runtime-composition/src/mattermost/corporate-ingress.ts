import type { DataSource, EntityManager } from "typeorm";

import {
  normalizeDialogSubmission,
  normalizePostAction,
  verifyOpaqueIntent,
} from "@awp/connector-mattermost";
import type { JsonValue } from "@awp/platform-contracts";
import { type ExactRevisionRef, freezePilotValue } from "@awp/platform-core";

import type { TransactionalIngressSource } from "../pilot/ingress-runtime.ts";
import {
  assertIngressPolicy,
  ingressConfigurationHash,
  type ProviderIngressPolicy,
} from "../pilot/provider-conformance.ts";
import {
  assertOriginalFreshness,
  type AuthenticatedIngressSource,
  authenticatedIngressTlsKey,
  ingressRawHash,
  type ProviderIngressRequest,
  snapshotIngressRequest,
} from "../pilot/trusted-ingress.ts";

export interface MattermostIngressHumanAuthority {
  assertCurrent(
    input: Readonly<{
      workspaceId: string;
      projectId: string;
      actorPrincipalId: string;
      externalUserId: string;
      action: JsonValue;
    }>,
    manager: EntityManager,
  ): Promise<void>;
}
type Intent = {
  id: string;
  workspace_id: string;
  project_id: string;
  actor_principal_id: string;
  action: JsonValue;
  subject: JsonValue;
  transport: Record<string, unknown>;
  state: string;
  result_ref: string | null;
  result_hash: string | null;
  created_at: Date;
  expires_at: Date;
};

/** Source TLS is verified before any token lookup. Receiver-side finalization
 * rechecks the durable original intent and human even for an exact retry. */
export class MattermostCorporateIngressSource implements TransactionalIngressSource {
  readonly #policy: ProviderIngressPolicy;
  constructor(
    private readonly database: DataSource,
    policy: ProviderIngressPolicy,
    private readonly human: MattermostIngressHumanAuthority,
    private readonly kind: "POST_ACTION" | "DIALOG_SUBMISSION",
  ) {
    assertIngressPolicy(policy);
    if (policy.subject.provider !== "MATTERMOST")
      throw new Error("MATTERMOST_INGRESS_DIALECT_REQUIRED");
    this.#policy = freezePilotValue(structuredClone(policy));
  }
  async authenticate(
    input: ProviderIngressRequest,
    now: Date,
  ): Promise<AuthenticatedIngressSource> {
    const request = snapshotIngressRequest(this.#policy, input);
    const sourceKeyRef = authenticatedIngressTlsKey(this.#policy, request, now);
    return this.prove(this.database.manager, request, sourceKeyRef, now, false);
  }
  async finalize(
    manager: EntityManager,
    request: ProviderIngressRequest,
    proof: AuthenticatedIngressSource,
    receiptId: string,
    now: Date,
  ): Promise<void> {
    const current = await this.prove(manager, request, proof.sourceKeyRef, now, true);
    if (ingressConfigurationHash(current) !== ingressConfigurationHash(proof))
      throw new Error("MATTERMOST_INTENT_CHANGED");
    const rows = (await manager.query(
      `WITH consumed AS (UPDATE interaction_intents SET state='CONSUMED',result_ref=$2,result_hash=$3 WHERE id=$1 AND (state='PENDING' OR (state='CONSUMED' AND result_ref=$2 AND result_hash=$3)) RETURNING id) SELECT id FROM consumed`,
      [proof.semanticId, receiptId, proof.bodyHash],
    )) as unknown[];
    if (rows.length !== 1) throw new Error("MATTERMOST_INTENT_REPLAY_CONFLICT");
  }
  private async prove(
    manager: EntityManager,
    request: ProviderIngressRequest,
    sourceKeyRef: ExactRevisionRef,
    now: Date,
    lock: boolean,
  ): Promise<AuthenticatedIngressSource> {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(request.rawBody));
    } catch {
      throw new Error("MATTERMOST_CALLBACK_INVALID");
    }
    const normalized =
      this.kind === "POST_ACTION" ? normalizePostAction(body) : normalizeDialogSubmission(body);
    verifyOpaqueIntent(normalized.intentToken);
    const policy = this.#policy,
      scope = policy.subject;
    const rows = (await manager.query(
      `SELECT * FROM interaction_intents WHERE workspace_id=$1 AND project_id=$2 AND nonce_hash=$3${lock ? " FOR UPDATE" : ""}`,
      [scope.workspaceId, scope.projectId, ingressRawHash(normalized.intentToken)],
    )) as Intent[];
    const intent = rows[0],
      transport = intent?.transport;
    if (
      !intent ||
      !transport ||
      !["PENDING", "CONSUMED"].includes(intent.state) ||
      transport.kind !== `MATTERMOST_${this.kind}` ||
      transport.externalUserId !== normalized.externalUserId ||
      transport.teamId !== normalized.teamId ||
      transport.teamId !== scope.externalScopeId ||
      transport.channelId !== normalized.channelId ||
      ["bindingRef", "profileRef", "connectionRef"].some(
        (key) =>
          !transport[key] ||
          ingressConfigurationHash(transport[key]) !==
            ingressConfigurationHash(scope[key as "bindingRef" | "profileRef" | "connectionRef"]),
      ) ||
      ("postId" in normalized &&
        (transport.postId !== normalized.postId || transport.actionId !== normalized.actionId)) ||
      ("callbackId" in normalized && transport.callbackId !== normalized.callbackId)
    )
      throw new Error("MATTERMOST_INTENT_BINDING_DENIED");
    const occurredAt = new Date(intent.created_at).toISOString(),
      expiresAt = new Date(intent.expires_at).toISOString();
    assertOriginalFreshness(policy, occurredAt, expiresAt, now);
    const bodyHash = ingressRawHash(request.rawBody);
    if (intent.state === "CONSUMED" && intent.result_hash !== bodyHash)
      throw new Error("MATTERMOST_INTENT_REPLAY_CONFLICT");
    await this.human.assertCurrent(
      {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        actorPrincipalId: intent.actor_principal_id,
        externalUserId: normalized.externalUserId,
        action: intent.action,
      },
      manager,
    );
    return freezePilotValue({
      bodyHash,
      semanticId: intent.id,
      occurredAt,
      expiresAt,
      sourceIdentity: policy.sourceIdentity,
      sourceKeyRef,
      signal: {
        schemaVersion: "mattermost-intent-received@1.0.0",
        intentId: intent.id,
        actorPrincipalId: intent.actor_principal_id,
        action: intent.action,
        subject: intent.subject,
        ...("values" in normalized ? { values: normalized.values } : {}),
      } as JsonValue,
    });
  }
}
