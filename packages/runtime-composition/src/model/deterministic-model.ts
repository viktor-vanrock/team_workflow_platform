export interface ModelCompletionInput {
  readonly prompt: string;
  readonly correlationId: string;
}

export interface ModelCompletionResult {
  readonly provider: "deterministic-fake" | "deterministic-dummy";
  readonly reasonCode:
    | "MODEL_PROVIDER_CONFIGURED"
    | "MODEL_PROVIDER_UNSET"
    | "MODEL_PROVIDER_INVALID"
    | "MODEL_PROVIDER_TIMEOUT";
  readonly text: string;
}

export interface DeterministicModelOptions {
  readonly provider?: string;
  readonly timeoutMs?: number;
  readonly mockHub?: (input: ModelCompletionInput) => Promise<unknown>;
}

export class DeterministicModelGateway {
  constructor(private readonly options: DeterministicModelOptions) {}

  async complete(input: ModelCompletionInput): Promise<ModelCompletionResult> {
    const prompt = input.prompt.trim();
    if (this.options.provider === "deterministic-fake") {
      return Object.freeze({
        provider: "deterministic-fake",
        reasonCode: "MODEL_PROVIDER_CONFIGURED",
        text: `Fake model response: ${prompt}`,
      });
    }
    const reasonCode =
      this.options.provider === undefined || this.options.provider.trim() === ""
        ? "MODEL_PROVIDER_UNSET"
        : this.options.provider === "timeout"
          ? "MODEL_PROVIDER_TIMEOUT"
          : "MODEL_PROVIDER_INVALID";
    return Object.freeze({
      provider: "deterministic-dummy",
      reasonCode,
      text: `Dummy model response: ${prompt}`,
    });
  }
}
