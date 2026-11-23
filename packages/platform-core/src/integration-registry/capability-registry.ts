import type { SemanticVersionReference } from "../shared/primitives.ts";

export type IdempotencyStrategy = "NATIVE_KEY" | "NATURAL_KEY_LOOKUP" | "RECONCILIATION";
export type ConfirmationMode = "SYNC_RECEIPT" | "READ_BACK" | "WEBHOOK";

export interface CapabilityOperationContract {
  readonly key: string;
  readonly effect: "READ" | "WRITE";
  readonly idempotencyStrategies: readonly IdempotencyStrategy[];
  readonly confirmationModes: readonly ConfirmationMode[];
}

export interface CapabilityContract {
  readonly key: string;
  readonly version: string;
  readonly operations: readonly CapabilityOperationContract[];
}

export interface ConnectorOperationImplementation {
  readonly key: string;
  readonly idempotencyStrategies: readonly IdempotencyStrategy[];
  readonly confirmationModes: readonly ConfirmationMode[];
}

export interface CapabilityImplementation {
  readonly connectorRef: SemanticVersionReference;
  readonly capabilityKey: string;
  readonly exactContractVersion: string;
  readonly operations: readonly ConnectorOperationImplementation[];
}

export interface CapabilityResolutionRequirement {
  readonly capabilityKey: string;
  readonly versionRange: string;
  readonly logicalRole: string;
  readonly operation: string;
}

export interface StrategySelection {
  readonly idempotencyStrategy: string;
  readonly confirmationMode: string;
}

export interface StrategyIntersection {
  readonly accepted: boolean;
  readonly idempotencyStrategies: readonly IdempotencyStrategy[];
  readonly confirmationModes: readonly ConfirmationMode[];
  readonly reasonCode?: "IDEMPOTENCY_STRATEGY_UNAVAILABLE" | "CONFIRMATION_MODE_UNAVAILABLE";
}

function versionTuple(version: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match) throw new Error(`INVALID_SEMVER:${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number {
  const a = versionTuple(left);
  const b = versionTuple(right);
  for (let index = 0; index < a.length; index += 1) {
    const difference = a[index]! - b[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

export function satisfiesVersionRange(version: string, range: string): boolean {
  if (range.trim() === "*" || range.trim() === version) return true;
  return range
    .trim()
    .split(/\s+/u)
    .every((clause) => {
      const match = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+)$/u.exec(clause);
      if (!match) return false;
      const operator = match[1] ?? "=";
      const compared = compareVersions(version, match[2]!);
      if (operator === ">=") return compared >= 0;
      if (operator === "<=") return compared <= 0;
      if (operator === ">") return compared > 0;
      if (operator === "<") return compared < 0;
      if (operator === "^")
        return compared >= 0 && versionTuple(version)[0] === versionTuple(match[2]!)[0];
      if (operator === "~") {
        const actual = versionTuple(version);
        const expected = versionTuple(match[2]!);
        return compared >= 0 && actual[0] === expected[0] && actual[1] === expected[1];
      }
      return compared === 0;
    });
}

export function intersectOperationStrategies(
  contract: Pick<CapabilityOperationContract, "idempotencyStrategies" | "confirmationModes">,
  implementation: Pick<
    ConnectorOperationImplementation,
    "idempotencyStrategies" | "confirmationModes"
  >,
  selection: StrategySelection,
): StrategyIntersection {
  const idempotencyStrategies = contract.idempotencyStrategies.filter((candidate) =>
    implementation.idempotencyStrategies.includes(candidate),
  );
  const confirmationModes = contract.confirmationModes.filter((candidate) =>
    implementation.confirmationModes.includes(candidate),
  );
  if (!idempotencyStrategies.includes(selection.idempotencyStrategy as IdempotencyStrategy)) {
    return Object.freeze({
      accepted: false,
      idempotencyStrategies,
      confirmationModes,
      reasonCode: "IDEMPOTENCY_STRATEGY_UNAVAILABLE",
    });
  }
  if (!confirmationModes.includes(selection.confirmationMode as ConfirmationMode)) {
    return Object.freeze({
      accepted: false,
      idempotencyStrategies,
      confirmationModes,
      reasonCode: "CONFIRMATION_MODE_UNAVAILABLE",
    });
  }
  return Object.freeze({ accepted: true, idempotencyStrategies, confirmationModes });
}

function registrationKey(key: string, version: string): string {
  return `${key}@${version}`;
}
function implementationKey(
  connector: SemanticVersionReference,
  capabilityKey: string,
  contractVersion: string,
): string {
  return `${connector.key}@${connector.version}:${capabilityKey}@${contractVersion}`;
}

export class CapabilityRegistry {
  readonly #contracts = new Map<string, CapabilityContract>();
  readonly #implementations = new Map<string, CapabilityImplementation>();

  static sampleRecord(): CapabilityRegistry {
    const registry = new CapabilityRegistry();
    registry.registerContract({
      key: "sample.record",
      version: "1.0.0",
      operations: [
        {
          key: "record.publish",
          effect: "WRITE",
          idempotencyStrategies: ["NATIVE_KEY", "RECONCILIATION"],
          confirmationModes: ["SYNC_RECEIPT", "READ_BACK"],
        },
      ],
    });
    registry.registerImplementation({
      connectorRef: { key: "sample.mock", version: "1.0.0" },
      capabilityKey: "sample.record",
      exactContractVersion: "1.0.0",
      operations: [
        {
          key: "record.publish",
          idempotencyStrategies: ["NATIVE_KEY"],
          confirmationModes: ["SYNC_RECEIPT"],
        },
      ],
    });
    return registry;
  }

  registerContract(contract: CapabilityContract): void {
    versionTuple(contract.version);
    const key = registrationKey(contract.key, contract.version);
    const current = this.#contracts.get(key);
    if (current && JSON.stringify(current) !== JSON.stringify(contract))
      throw new Error(`CAPABILITY_CONTRACT_COLLISION:${key}`);
    if (
      new Set(contract.operations.map((operation) => operation.key)).size !==
      contract.operations.length
    )
      throw new Error(`DUPLICATE_CAPABILITY_OPERATION:${key}`);
    this.#contracts.set(key, structuredClone(contract));
  }

  registerImplementation(implementation: CapabilityImplementation): void {
    const contract = this.contract(
      implementation.capabilityKey,
      implementation.exactContractVersion,
    );
    for (const operation of implementation.operations) {
      const declared = contract.operations.find((candidate) => candidate.key === operation.key);
      if (!declared) throw new Error(`UNKNOWN_CAPABILITY_OPERATION:${operation.key}`);
      if (
        !operation.idempotencyStrategies.some((candidate) =>
          declared.idempotencyStrategies.includes(candidate),
        )
      )
        throw new Error(`NO_IDEMPOTENCY_INTERSECTION:${operation.key}`);
      if (
        !operation.confirmationModes.some((candidate) =>
          declared.confirmationModes.includes(candidate),
        )
      )
        throw new Error(`NO_CONFIRMATION_INTERSECTION:${operation.key}`);
    }
    const key = implementationKey(
      implementation.connectorRef,
      implementation.capabilityKey,
      implementation.exactContractVersion,
    );
    const current = this.#implementations.get(key);
    if (current && JSON.stringify(current) !== JSON.stringify(implementation))
      throw new Error(`CAPABILITY_IMPLEMENTATION_COLLISION:${key}`);
    this.#implementations.set(key, structuredClone(implementation));
  }

  contract(key: string, version: string): CapabilityContract {
    const contract = this.#contracts.get(registrationKey(key, version));
    if (!contract) throw new Error(`CAPABILITY_CONTRACT_NOT_FOUND:${key}@${version}`);
    return structuredClone(contract);
  }

  implementation(
    connector: SemanticVersionReference,
    capabilityKey: string,
    contractVersion: string,
  ): CapabilityImplementation {
    const implementation = this.#implementations.get(
      implementationKey(connector, capabilityKey, contractVersion),
    );
    if (!implementation)
      throw new Error(
        `CAPABILITY_IMPLEMENTATION_NOT_FOUND:${connector.key}@${connector.version}:${capabilityKey}@${contractVersion}`,
      );
    return structuredClone(implementation);
  }

  resolveImplementation(
    requirement: CapabilityResolutionRequirement,
    connector: SemanticVersionReference,
  ): CapabilityImplementation {
    const candidates = [...this.#implementations.values()].filter(
      (candidate) =>
        candidate.connectorRef.key === connector.key &&
        candidate.connectorRef.version === connector.version &&
        candidate.capabilityKey === requirement.capabilityKey &&
        satisfiesVersionRange(candidate.exactContractVersion, requirement.versionRange) &&
        candidate.operations.some((operation) => operation.key === requirement.operation),
    );
    if (candidates.length !== 1)
      throw new Error(
        candidates.length === 0
          ? "CAPABILITY_IMPLEMENTATION_NOT_FOUND"
          : "CAPABILITY_IMPLEMENTATION_AMBIGUOUS",
      );
    return structuredClone(candidates[0]!);
  }
}
