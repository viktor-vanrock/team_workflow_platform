import type { JiraEffectLookup } from "./jira-effect-control.ts";
import {
  InMemoryRequestSubEffectStore,
  reconcileRequestSubEffects,
  type RequestSubEffect,
  type RequestSubEffectStore,
} from "./request-create-reconciliation.ts";

export interface RequestCreateObservation {
  readonly externalEntityId: string;
  readonly externalDisplayKey: string;
  readonly externalRevisionToken: string;
  readonly authorityFieldsHash: string;
  readonly [key: string]: unknown;
}
export interface RequestCreatePort {
  lookup(marker: string): Promise<JiraEffectLookup>;
  create(
    input: Readonly<{ fields: Readonly<Record<string, unknown>>; marker: string }>,
  ): Promise<Readonly<{ externalEntityId: string }>>;
  observe(externalEntityId: string): Promise<RequestCreateObservation>;
  applySubEffect?(externalEntityId: string, effect: RequestSubEffect): Promise<string>;
}
export type RequestCreateResult =
  | Readonly<{
      status: "AMBIGUOUS";
      reasonCode: "MARKER_VISIBILITY_UNKNOWN" | "MARKER_MULTIPLE_MATCHES";
    }>
  | Readonly<{
      status: "CONFIRMED";
      externalEntityId: string;
      created: boolean;
      observation: RequestCreateObservation;
      subEffectReceipts: readonly string[];
    }>;
export interface RequestCreateExecution {
  readonly effectMarker: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly subEffects: readonly RequestSubEffect[];
}

export function assertRequestCreateAuthority(
  input: Readonly<{
    authorized: boolean;
    projectId: string;
    targetProjectId: string;
    profileStatus: "VALID" | "DRIFTED" | "INVALID";
    expectedAuthorityNamespace: string;
    actualAuthorityNamespace: string;
  }>,
): void {
  if (!input.authorized) throw new Error("REQUEST_CREATE_UNAUTHORIZED");
  if (input.projectId !== input.targetProjectId)
    throw new Error("REQUEST_CREATE_PROJECT_SCOPE_MISMATCH");
  if (input.profileStatus !== "VALID") throw new Error("REQUEST_CREATE_PROFILE_UNAVAILABLE");
  if (input.expectedAuthorityNamespace !== input.actualAuthorityNamespace)
    throw new Error("REQUEST_CREATE_AUTHORITY_NAMESPACE_MISMATCH");
}

export class JiraRequestCreateService {
  readonly #inFlight = new Map<string, Promise<RequestCreateResult>>();
  constructor(
    private readonly port: RequestCreatePort,
    private readonly receipts: RequestSubEffectStore = new InMemoryRequestSubEffectStore(),
  ) {}
  async execute(input: RequestCreateExecution): Promise<RequestCreateResult> {
    const current = this.#inFlight.get(input.effectMarker);
    if (current) return await current;
    const work = this.#execute(input);
    this.#inFlight.set(input.effectMarker, work);
    try {
      return await work;
    } finally {
      if (this.#inFlight.get(input.effectMarker) === work)
        this.#inFlight.delete(input.effectMarker);
    }
  }
  async #execute(input: RequestCreateExecution): Promise<RequestCreateResult> {
    const lookup = await this.port.lookup(input.effectMarker);
    if (lookup.state === "UNKNOWN")
      return Object.freeze({ status: "AMBIGUOUS", reasonCode: "MARKER_VISIBILITY_UNKNOWN" });
    if (lookup.state === "MULTIPLE")
      return Object.freeze({ status: "AMBIGUOUS", reasonCode: "MARKER_MULTIPLE_MATCHES" });
    let created = false;
    let externalEntityId: string;
    if (lookup.state === "PROVEN_ABSENT") {
      created = true;
      externalEntityId = (
        await this.port.create({ fields: input.fields, marker: input.effectMarker })
      ).externalEntityId;
    } else if (lookup.state === "FOUND") externalEntityId = lookup.externalEntityId;
    else throw new Error("REQUEST_CREATE_LOOKUP_STATE_UNREACHABLE");
    const subEffectReceipts = this.port.applySubEffect
      ? await reconcileRequestSubEffects(
          input.effectMarker,
          input.subEffects,
          this.receipts,
          async (effect) => await this.port.applySubEffect!(externalEntityId, effect),
        )
      : Object.freeze([] as string[]);
    const observation = await this.port.observe(externalEntityId);
    if (observation.externalEntityId !== externalEntityId)
      throw new Error("REQUEST_CREATE_READ_BACK_IDENTITY_MISMATCH");
    return Object.freeze({
      status: "CONFIRMED",
      externalEntityId,
      created,
      observation,
      subEffectReceipts,
    });
  }
}
