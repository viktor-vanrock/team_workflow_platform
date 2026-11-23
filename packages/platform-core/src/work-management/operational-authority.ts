import type { VersionedReference } from "../shared/primitives.ts";

export type ConfigurationPinPurpose = "PRIMARY" | "AUXILIARY";
export type CrossAuthorityLinkStrategy = "NATIVE_SAME_AUTHORITY" | "REMOTE_LINK";

export interface CommandConfigurationPin {
  readonly sequence: number;
  readonly purpose: ConfigurationPinPurpose;
  readonly logicalRole: string;
  readonly bindingRef: VersionedReference;
  readonly profileRef: VersionedReference;
  readonly mappingRef: VersionedReference;
  readonly connectionRef: VersionedReference;
  readonly contentHash: `sha256:${string}`;
  readonly adapterFamily: string;
  readonly adapterContractVersion: string;
  readonly authorityNamespaceHash: string;
}

function frozenPin(pin: CommandConfigurationPin): CommandConfigurationPin {
  return Object.freeze({
    ...pin,
    bindingRef: Object.freeze({ ...pin.bindingRef }),
    profileRef: Object.freeze({ ...pin.profileRef }),
    mappingRef: Object.freeze({ ...pin.mappingRef }),
    connectionRef: Object.freeze({ ...pin.connectionRef }),
  });
}

export class ConfigurationPinSet {
  readonly entries: readonly CommandConfigurationPin[];

  private constructor(entries: readonly CommandConfigurationPin[]) {
    this.entries = Object.freeze(entries.map(frozenPin));
    Object.freeze(this);
  }

  static create(input: readonly CommandConfigurationPin[]): ConfigurationPinSet {
    if (input.length === 0) throw new Error("CONFIGURATION_PIN_SET_EMPTY");
    const ordered = [...input].sort((left, right) => left.sequence - right.sequence);
    if (
      ordered.filter(({ purpose }) => purpose === "PRIMARY").length !== 1 ||
      ordered[0]?.purpose !== "PRIMARY"
    )
      throw new Error("CONFIGURATION_PIN_SET_REQUIRES_ONE_FIRST_PRIMARY");
    if (ordered.some((pin, index) => pin.sequence !== index))
      throw new Error("CONFIGURATION_PIN_SEQUENCE_INVALID");
    if (new Set(ordered.map(({ logicalRole }) => logicalRole)).size !== ordered.length)
      throw new Error("CONFIGURATION_PIN_LOGICAL_ROLE_DUPLICATED");
    return new ConfigurationPinSet(ordered);
  }

  assertLinkStrategy(strategy: CrossAuthorityLinkStrategy): void {
    if (
      strategy === "NATIVE_SAME_AUTHORITY" &&
      new Set(this.entries.map(({ authorityNamespaceHash }) => authorityNamespaceHash)).size !== 1
    )
      throw new Error("CROSS_AUTHORITY_NATIVE_LINK_FORBIDDEN");
  }
}

export type OperationalBindingState = "PENDING" | "ACTIVE" | "RETIRED";
export interface OperationalBindingIdentity {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workItemId: string;
  readonly connectionHeaderId: string;
  readonly externalEntityType: string;
  readonly externalEntityId: string;
}

export class OperationalAuthorityBindingAggregate {
  readonly identity: OperationalBindingIdentity;
  #state: OperationalBindingState = "PENDING";

  private constructor(identity: OperationalBindingIdentity) {
    if (
      !identity.workspaceId ||
      !identity.projectId ||
      !identity.workItemId ||
      !identity.connectionHeaderId ||
      !identity.externalEntityId
    )
      throw new Error("OPERATIONAL_BINDING_IDENTITY_INVALID");
    this.identity = Object.freeze({ ...identity });
  }

  static create(identity: OperationalBindingIdentity): OperationalAuthorityBindingAggregate {
    return new OperationalAuthorityBindingAggregate(identity);
  }

  get state(): OperationalBindingState {
    return this.#state;
  }
  activate(): this {
    if (this.#state !== "PENDING") throw new Error("BINDING_ALREADY_ACTIVE");
    this.#state = "ACTIVE";
    return this;
  }
  retire(): this {
    if (this.#state !== "ACTIVE") throw new Error("BINDING_NOT_ACTIVE");
    this.#state = "RETIRED";
    return this;
  }
}

export interface ExpectedOperationalState {
  readonly externalRevisionToken: string;
  readonly authorityFieldsHash: string;
  readonly expectedValueHash: string;
}

export interface PreparedOperationalAction {
  readonly operation:
    "request.transition" | "request.assign" | "request.set-priority" | "request.set-due-date";
  readonly workItemId: string;
  readonly expected: ExpectedOperationalState;
  readonly pins: ConfigurationPinSet;
  readonly projectionEtag: string;
}

export function prepareOperationalAction(
  input: PreparedOperationalAction,
  suppliedIfMatch: string,
): PreparedOperationalAction {
  if (suppliedIfMatch !== input.projectionEtag) throw new Error("PROJECTION_ETAG_STALE");
  return Object.freeze({ ...input });
}

const actionBodyKeys: Readonly<Record<PreparedOperationalAction["operation"], string>> =
  Object.freeze({
    "request.transition": "transition",
    "request.assign": "assignment",
    "request.set-priority": "priority",
    "request.set-due-date": "dueDate",
  });
export function assertOperationalActionRequest(
  input: Readonly<{
    operation: PreparedOperationalAction["operation"];
    payload: unknown;
    ifMatch: string;
  }>,
) {
  if (!/^W\/"[1-9][0-9]*"$/u.test(input.ifMatch))
    throw new Error("OPERATIONAL_ACTION_IF_MATCH_INVALID");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload))
    throw new Error("OPERATIONAL_ACTION_BODY_INVALID");
  const record = input.payload as Record<string, unknown>;
  const expected = actionBodyKeys[input.operation];
  if (Object.keys(record).length !== 1 || !(expected in record))
    throw new Error("OPERATIONAL_ACTION_BODY_CLOSED");
  const body = record[expected];
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("OPERATIONAL_ACTION_BODY_INVALID");
  const keys = Object.keys(body as Record<string, unknown>);
  const allowed =
    input.operation === "request.assign"
      ? ["canonicalPrincipalId", "unassign"]
      : input.operation === "request.set-due-date"
        ? ["value", "clear"]
        : input.operation === "request.transition"
          ? ["toStatusKey"]
          : ["normalizedKey"];
  if (keys.some((key) => !allowed.includes(key)) || keys.length === 0)
    throw new Error("OPERATIONAL_ACTION_BODY_CLOSED");
  return Object.freeze({ ...input });
}

export type OperationalConflictState = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPERSEDED";
export class OperationalSyncConflictAggregate {
  #state: OperationalConflictState = "OPEN";
  constructor(
    readonly id: string,
    readonly commandId: string,
    readonly immutableFact: Readonly<Record<string, unknown>>,
  ) {}
  get state(): OperationalConflictState {
    return this.#state;
  }
  acknowledge(): void {
    if (this.#state !== "OPEN") throw new Error("CONFLICT_STATE_INVALID");
    this.#state = "ACKNOWLEDGED";
  }
  resolve(): void {
    if (!new Set<OperationalConflictState>(["OPEN", "ACKNOWLEDGED"]).has(this.#state))
      throw new Error("CONFLICT_STATE_INVALID");
    this.#state = "RESOLVED";
  }
}
