import {
  type JiraEffectLookup,
  type RequestCreateObservation,
  type RequestCreatePort,
  type RequestSubEffect,
  type RequestSubEffectStore,
} from "@awp/connector-jira";
import { type JsonValue, sha256 } from "@awp/platform-contracts";

import {
  type JiraEffectClaim,
  JiraEffectRepository,
  type JiraSubEffectKind,
  type JiraSubEffectPlanEntry,
} from "./jira-effect.repository.ts";

function lookupRecord(lookup: JiraEffectLookup): Readonly<{
  state: JiraEffectLookup["state"];
  externalEntityId?: string;
  matchCount: number;
}> {
  if (lookup.state === "FOUND")
    return Object.freeze({
      state: lookup.state,
      externalEntityId: lookup.externalEntityId,
      matchCount: 1,
    });
  if (lookup.state === "MULTIPLE")
    return Object.freeze({ state: lookup.state, matchCount: lookup.candidates.length });
  return Object.freeze({ state: lookup.state, matchCount: 0 });
}

/** Adds a durable Connector-owned recovery ledger around the pure Jira port. */
export class PersistentJiraRequestCreatePort implements RequestCreatePort {
  constructor(
    private readonly delegate: RequestCreatePort,
    private readonly effects: JiraEffectRepository,
    private readonly claim: JiraEffectClaim,
  ) {}

  async lookup(marker: string): Promise<JiraEffectLookup> {
    this.#assertEffect(marker);
    const current = await this.effects.beginLookup(this.claim, new Date());
    const observed = await this.delegate.lookup(marker);
    // Pagination completeness is search visibility, not proof that an invoked
    // POST had no effect. An eventual index may still omit the created issue.
    const lookup: JiraEffectLookup =
      current.invocationStartedAt && observed.state === "PROVEN_ABSENT"
        ? Object.freeze({ state: "UNKNOWN" })
        : observed;
    await this.effects.recordLookup(
      this.claim,
      Object.freeze({
        ...lookupRecord(lookup),
        queryHash: sha256({ effectId: this.claim.effectId, marker } as JsonValue),
      }),
      new Date(),
    );
    if (
      current.externalEntityId &&
      (lookup.state !== "FOUND" || lookup.externalEntityId !== current.externalEntityId)
    ) {
      throw new Error("JIRA_EFFECT_EXTERNAL_OBSERVATION_CONFLICT");
    }
    return lookup;
  }

  async create(
    input: Readonly<{ fields: Readonly<Record<string, unknown>>; marker: string }>,
  ): Promise<Readonly<{ externalEntityId: string }>> {
    this.#assertEffect(input.marker);
    await this.effects.markInProgress(this.claim, new Date());
    const created = await this.delegate.create(input);
    await this.effects.recordCreated(this.claim, created.externalEntityId, new Date());
    return created;
  }

  async observe(externalEntityId: string): Promise<RequestCreateObservation> {
    await this.effects.assertClaim(this.claim, new Date());
    const observation = await this.delegate.observe(externalEntityId);
    await this.effects.confirm(
      this.claim,
      Object.freeze({
        externalEntityId: observation.externalEntityId,
        receiptHash: sha256(observation as unknown as JsonValue),
        externalRevisionToken: observation.externalRevisionToken,
        now: new Date(),
      }),
    );
    return observation;
  }

  async applySubEffect(externalEntityId: string, effect: RequestSubEffect): Promise<string> {
    if (!this.delegate.applySubEffect) throw new Error("JIRA_SUB_EFFECT_PORT_REQUIRED");
    await this.effects.assertClaim(this.claim, new Date());
    return await this.delegate.applySubEffect(externalEntityId, effect);
  }

  #assertEffect(marker: string): void {
    if (marker !== this.claim.effectId) throw new Error("JIRA_EFFECT_MARKER_IDENTITY_MISMATCH");
  }
}

function persistenceKind(kind: RequestSubEffect["kind"]): JiraSubEffectKind {
  if (kind === "LINK") return "ISSUE_LINK";
  if (kind === "REMOTE_LINK") return "REMOTE_LINK";
  return "COMMENT";
}

function planEntry(effect: RequestSubEffect, sequence: number): JiraSubEffectPlanEntry {
  return Object.freeze({
    sequence,
    kind: persistenceKind(effect.kind),
    semanticIdentity: effect.semanticIdentity,
    semanticHash: sha256({
      kind: effect.kind,
      semanticIdentity: effect.semanticIdentity,
      payload: effect.payload,
    } as JsonValue),
    required: effect.required !== false,
  });
}

/** Request-create receipt store backed by jira_effect_sub_effects. */
export class PersistentJiraRequestSubEffectStore implements RequestSubEffectStore {
  constructor(
    private readonly effects: JiraEffectRepository,
    private readonly claim: JiraEffectClaim,
  ) {}

  async prepare(effectId: string, effects: readonly RequestSubEffect[]): Promise<void> {
    this.#assertEffect(effectId);
    await this.effects.prepareSubEffects(
      this.claim,
      effects.map((effect, sequence) => planEntry(effect, sequence)),
      new Date(),
    );
  }

  async begin(effectId: string, semanticIdentity: string): Promise<void> {
    this.#assertEffect(effectId);
    await this.effects.beginSubEffect(this.claim, semanticIdentity, new Date());
  }

  async receipt(effectId: string, semanticIdentity: string): Promise<string | undefined> {
    this.#assertEffect(effectId);
    return await this.effects.subEffectReceipt(this.claim, semanticIdentity, new Date());
  }

  async confirm(effectId: string, semanticIdentity: string, receipt: string): Promise<void> {
    this.#assertEffect(effectId);
    await this.effects.confirmSubEffect(this.claim, semanticIdentity, receipt, new Date());
  }

  #assertEffect(effectId: string): void {
    if (effectId !== this.claim.effectId) throw new Error("JIRA_EFFECT_MARKER_IDENTITY_MISMATCH");
  }
}
