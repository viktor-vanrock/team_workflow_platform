import { createHash, randomBytes } from "node:crypto";

export interface AuthorizedProjectOption {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workspaceLabel: string;
  readonly projectLabel: string;
  readonly configurationHash: string;
}
export interface ProjectAuthorizationPort {
  options(
    principalId: string,
    classificationKey: string,
  ): Promise<readonly AuthorizedProjectOption[]>;
  reauthorize(principalId: string, option: AuthorizedProjectOption): Promise<boolean>;
}
export interface ProjectSelectionIntentRecord {
  readonly intentId: string;
  readonly tokenHash: string;
  readonly principalId: string;
  readonly oidcSessionHash: string;
  readonly continuationVersion: number;
  readonly option: AuthorizedProjectOption;
  readonly expiresAt: Date;
  status: "PENDING" | "CONSUMED" | "INVALIDATED";
  resultRef?: string;
  requestKey?: string;
}
export interface ProjectSelectionConsumeResult {
  readonly draftRef: string;
  readonly replayed: boolean;
  readonly option: AuthorizedProjectOption;
  readonly draftId?: string;
  readonly draft?: unknown;
}

const hash = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export class ProjectSelectionService {
  readonly #intents = new Map<string, ProjectSelectionIntentRecord>();
  readonly #inflight = new Map<string, Promise<ProjectSelectionConsumeResult>>();
  #issuance = 0;
  constructor(
    private readonly authorization: ProjectAuthorizationPort,
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 10 * 60_000,
  ) {}
  async issue(principalId: string, oidcSessionId: string, continuationVersion = 1) {
    this.#issuance += 1;
    const oidcSessionHash = hash(oidcSessionId);
    for (const intent of this.#intents.values())
      if (
        intent.principalId === principalId &&
        intent.oidcSessionHash === oidcSessionHash &&
        intent.continuationVersion === continuationVersion &&
        intent.status === "PENDING"
      )
        intent.status = "INVALIDATED";
    const options = (await this.authorization.options(principalId, "INTERNAL")).slice(0, 100);
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    return Object.freeze({
      items: Object.freeze(
        options.map((option, index) => {
          const intentId = `project-option:${hash(`${principalId}:${oidcSessionHash}:${continuationVersion}:${this.#issuance}:${option.projectId}:${index}:${expiresAt.toISOString()}`).slice(7, 39)}`;
          const intentToken = randomBytes(32).toString("base64url");
          this.#intents.set(intentId, {
            intentId,
            tokenHash: hash(intentToken),
            principalId,
            oidcSessionHash,
            continuationVersion,
            option: structuredClone(option),
            expiresAt,
            status: "PENDING",
          });
          return Object.freeze({
            intentId,
            intentToken,
            workspaceLabel: option.workspaceLabel,
            projectLabel: option.projectLabel,
            expiresAt: expiresAt.toISOString(),
          });
        }),
      ),
    });
  }
  async consume(input: {
    principalId: string;
    oidcSessionId: string;
    intentId: string;
    intentToken: string;
    requestKey: string;
    createDraft(
      option: AuthorizedProjectOption,
    ): Promise<Readonly<{ id: string; resultRef: string; draft?: unknown }>>;
  }): Promise<ProjectSelectionConsumeResult> {
    const intent = this.#intents.get(input.intentId);
    if (
      !intent ||
      intent.principalId !== input.principalId ||
      intent.oidcSessionHash !== hash(input.oidcSessionId) ||
      intent.tokenHash !== hash(input.intentToken)
    )
      throw new Error("PROJECT_SELECTION_INTENT_DENIED");
    if (intent.status === "CONSUMED") {
      if (intent.requestKey !== input.requestKey || !intent.resultRef)
        throw new Error("PROJECT_SELECTION_REPLAY_CONFLICT");
      return Object.freeze({
        draftRef: intent.resultRef,
        replayed: true,
        option: structuredClone(intent.option),
      });
    }
    if (intent.status !== "PENDING" || this.now() >= intent.expiresAt)
      throw new Error("PROJECT_SELECTION_INTENT_NOT_PENDING");
    const running = this.#inflight.get(input.intentId);
    if (running) {
      if (intent.requestKey !== input.requestKey)
        throw new Error("PROJECT_SELECTION_REPLAY_CONFLICT");
      const completed = await running;
      return Object.freeze({ ...completed, replayed: true });
    }
    intent.requestKey = input.requestKey;
    const operation = (async (): Promise<ProjectSelectionConsumeResult> => {
      if (!(await this.authorization.reauthorize(input.principalId, intent.option)))
        throw new Error("PROJECT_SELECTION_REAUTHORIZATION_DENIED");
      const draft = await input.createDraft(intent.option);
      intent.status = "CONSUMED";
      intent.resultRef = draft.resultRef;
      return Object.freeze({
        draftRef: draft.resultRef,
        draftId: draft.id,
        ...(draft.draft !== undefined ? { draft: structuredClone(draft.draft) } : {}),
        replayed: false,
        option: structuredClone(intent.option),
      });
    })();
    this.#inflight.set(input.intentId, operation);
    try {
      return await operation;
    } catch (error) {
      delete intent.requestKey;
      throw error;
    } finally {
      this.#inflight.delete(input.intentId);
    }
  }
  snapshot(intentId: string) {
    const value = this.#intents.get(intentId);
    return value ? structuredClone(value) : undefined;
  }
}
