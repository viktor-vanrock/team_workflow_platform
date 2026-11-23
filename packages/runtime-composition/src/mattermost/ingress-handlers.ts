import { createHash } from "node:crypto";

import {
  mattermostIngressDeclarations,
  normalizeDialogSubmission,
  normalizePostAction,
  verifyOpaqueIntent,
  verifySignedProxy,
} from "@awp/connector-mattermost";

export interface MattermostIngressHandler {
  readonly contractKey: string;
  normalize(payload: unknown): unknown;
}

export class MattermostIngressRegistry {
  readonly #handlers = new Map<string, MattermostIngressHandler>();
  constructor(handlers: readonly MattermostIngressHandler[]) {
    for (const handler of handlers) {
      if (this.#handlers.has(handler.contractKey))
        throw new Error(`MATTERMOST_INGRESS_COLLISION:${handler.contractKey}`);
      this.#handlers.set(handler.contractKey, Object.freeze(handler));
    }
    for (const declaration of mattermostIngressDeclarations) {
      if (!this.#handlers.has(declaration.key))
        throw new Error(`MATTERMOST_INGRESS_HANDLER_MISSING:${declaration.key}`);
    }
  }
  resolve(contractKey: string): MattermostIngressHandler {
    const value = this.#handlers.get(contractKey);
    if (!value) throw new Error(`MATTERMOST_INGRESS_NOT_FOUND:${contractKey}`);
    return value;
  }
  declarations() {
    return mattermostIngressDeclarations;
  }
}

export function createMattermostIngressRegistry(): MattermostIngressRegistry {
  return new MattermostIngressRegistry([
    Object.freeze({
      contractKey: "mattermost.ingress.dialog-submission",
      normalize: normalizeDialogSubmission,
    }),
    Object.freeze({
      contractKey: "mattermost.ingress.post-action",
      normalize: normalizePostAction,
    }),
  ]);
}

export const mattermostCallbackAuthenticators = Object.freeze({
  opaqueIntent: verifyOpaqueIntent,
  signedProxy: verifySignedProxy,
});

export interface MattermostIngressScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly connectionId: string;
}
export interface MattermostIngressReceiptPort {
  claim(
    value: Readonly<{
      id: string;
      workspaceId: string;
      projectId: string;
      connectionId: string;
      transportKind: string;
      transportAttemptKey: string;
      bodyHash: string;
      normalizedEnvelope: unknown;
      resultRef?: string;
    }>,
  ): Promise<Readonly<{ replayed: boolean }>> | Readonly<{ replayed: boolean }>;
}
export interface MattermostIngressDispatchPort {
  dispatch(
    input: Readonly<{
      receiptId: string;
      scope: MattermostIngressScope;
      transportKind: "DIALOG_SUBMISSION" | "POST_ACTION";
      envelope: unknown;
    }>,
  ): Promise<void>;
}

const digest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const stableId = (value: string): string => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
};

export class MattermostIngressService {
  constructor(
    private readonly receipts: MattermostIngressReceiptPort,
    private readonly dispatch: MattermostIngressDispatchPort,
    private readonly resolveScope: (connectionId: string) => Promise<MattermostIngressScope>,
    private readonly signedProxySecret?: string,
  ) {}
  async accept(
    input: Readonly<{
      connectionId: string;
      kind: "DIALOG_SUBMISSION" | "POST_ACTION";
      body: unknown;
      rawBytes: Uint8Array;
      headers: Readonly<Record<string, string | undefined>>;
      receivedAt: Date;
    }>,
  ) {
    if (input.rawBytes.byteLength > 262_144) throw new Error("MATTERMOST_CALLBACK_TOO_LARGE");
    const scope = await this.resolveScope(input.connectionId);
    const normalized =
      input.kind === "DIALOG_SUBMISSION"
        ? normalizeDialogSubmission(input.body)
        : normalizePostAction(input.body);
    if (input.kind === "DIALOG_SUBMISSION") verifyOpaqueIntent(normalized.intentToken);
    else {
      const timestamp = input.headers["x-awp-timestamp"],
        signature = input.headers["x-awp-signature"]?.replace(/^sha256=/u, "");
      if (!this.signedProxySecret || !timestamp || !signature)
        throw new Error("MATTERMOST_CALLBACK_SIGNATURE_REQUIRED");
      verifySignedProxy({
        token: normalized.intentToken,
        body: input.rawBytes,
        timestamp,
        signatureHex: signature,
        secret: this.signedProxySecret,
        now: input.receivedAt,
        maxSkewSeconds: 300,
      });
    }
    const bodyHash = digest(input.rawBytes);
    const deliveryId = input.headers["x-mattermost-request-id"];
    const attemptKey = input.kind === "POST_ACTION" ? (deliveryId ?? bodyHash) : bodyHash;
    const receiptId = stableId(`${scope.connectionId}:${input.kind}:${attemptKey}`);
    const claim = await this.receipts.claim({
      id: receiptId,
      ...scope,
      transportKind: input.kind,
      transportAttemptKey: attemptKey,
      bodyHash,
      normalizedEnvelope: normalized,
    });
    if (!claim.replayed)
      await this.dispatch.dispatch({
        receiptId,
        scope,
        transportKind: input.kind,
        envelope: normalized,
      });
    return input.kind === "DIALOG_SUBMISSION"
      ? Object.freeze({ type: "ok" as const })
      : Object.freeze({
          ephemeral_text: claim.replayed ? "Действие уже принято" : "Действие принято",
        });
  }
}
