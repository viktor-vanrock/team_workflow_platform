import type { Clock, IdGenerator } from "../shared/primitives.ts";

export type ExtensionKind = "CompetencyPack" | "Connector" | "CapabilityContract";
export type RegistrationOutcome = "ACCEPTED" | "REJECTED";

export interface CanonicalExtensionRegistration {
  readonly id: string;
  readonly kind: ExtensionKind;
  readonly key: string;
  readonly version: string;
  readonly manifestHash: `sha256:${string}`;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly status: "REGISTERED" | "DISABLED";
  readonly registeredAt: Date;
}

export interface ExtensionRegistrationAttempt {
  readonly id: string;
  readonly sourceComponentRef: string;
  readonly observedKind?: string;
  readonly observedKey?: string;
  readonly observedVersion?: string;
  readonly observedHash: `sha256:${string}`;
  readonly outcome: RegistrationOutcome;
  readonly diagnostics: readonly string[];
  readonly bootInstanceId: string;
  readonly observedAt: Date;
}

export interface RegistrationRepository {
  find(
    kind: ExtensionKind,
    key: string,
    version: string,
  ): Promise<CanonicalExtensionRegistration | undefined>;
  insert(registration: CanonicalExtensionRegistration): Promise<void>;
  appendAttempt(attempt: ExtensionRegistrationAttempt): Promise<void>;
  list(): Promise<readonly CanonicalExtensionRegistration[]>;
  attempts(): Promise<readonly ExtensionRegistrationAttempt[]>;
}

export interface ValidatedRegistrationCandidate {
  readonly kind: ExtensionKind;
  readonly key: string;
  readonly version: string;
  readonly manifestHash: `sha256:${string}`;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly sourceComponentRef: string;
  readonly bootInstanceId: string;
}

export class ExtensionRegistry {
  constructor(
    private readonly repository: RegistrationRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async register(candidate: ValidatedRegistrationCandidate): Promise<
    Readonly<{
      outcome: RegistrationOutcome;
      registration?: CanonicalExtensionRegistration;
      diagnostics: readonly string[];
    }>
  > {
    const current = await this.repository.find(candidate.kind, candidate.key, candidate.version);
    const collision = current !== undefined && current.manifestHash !== candidate.manifestHash;
    const diagnostics = collision
      ? Object.freeze([
          `IMMUTABLE_DIGEST_COLLISION:${candidate.kind}:${candidate.key}@${candidate.version}`,
        ])
      : Object.freeze([] as string[]);
    const outcome: RegistrationOutcome = collision ? "REJECTED" : "ACCEPTED";
    let registration = current;
    if (!registration && !collision) {
      registration = Object.freeze({
        id: this.ids.next(),
        kind: candidate.kind,
        key: candidate.key,
        version: candidate.version,
        manifestHash: candidate.manifestHash,
        manifest: structuredClone(candidate.manifest),
        status: "REGISTERED",
        registeredAt: this.clock.now(),
      });
      await this.repository.insert(registration);
    }
    await this.repository.appendAttempt(
      Object.freeze({
        id: this.ids.next(),
        sourceComponentRef: candidate.sourceComponentRef,
        observedKind: candidate.kind,
        observedKey: candidate.key,
        observedVersion: candidate.version,
        observedHash: candidate.manifestHash,
        outcome,
        diagnostics,
        bootInstanceId: candidate.bootInstanceId,
        observedAt: this.clock.now(),
      }),
    );
    return Object.freeze({ outcome, ...(registration ? { registration } : {}), diagnostics });
  }

  async rejectMalformed(
    input: Readonly<{
      sourceComponentRef: string;
      bootInstanceId: string;
      observedHash: `sha256:${string}`;
      observedKind?: string;
      observedKey?: string;
      observedVersion?: string;
      diagnostics: readonly string[];
    }>,
  ): Promise<void> {
    await this.repository.appendAttempt(
      Object.freeze({
        id: this.ids.next(),
        ...input,
        outcome: "REJECTED",
        observedAt: this.clock.now(),
      }),
    );
  }
}

export class InMemoryRegistrationRepository implements RegistrationRepository {
  readonly #registrations = new Map<string, CanonicalExtensionRegistration>();
  readonly #attempts: ExtensionRegistrationAttempt[] = [];
  async find(
    kind: ExtensionKind,
    key: string,
    version: string,
  ): Promise<CanonicalExtensionRegistration | undefined> {
    return this.#registrations.get(`${kind}:${key}@${version}`);
  }
  async insert(registration: CanonicalExtensionRegistration): Promise<void> {
    const key = `${registration.kind}:${registration.key}@${registration.version}`;
    if (this.#registrations.has(key))
      throw new Error(`Canonical registration already exists: ${key}`);
    this.#registrations.set(key, registration);
  }
  async appendAttempt(attempt: ExtensionRegistrationAttempt): Promise<void> {
    this.#attempts.push(attempt);
  }
  async list(): Promise<readonly CanonicalExtensionRegistration[]> {
    return [...this.#registrations.values()];
  }
  async attempts(): Promise<readonly ExtensionRegistrationAttempt[]> {
    return [...this.#attempts];
  }
}
