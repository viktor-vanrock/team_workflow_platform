export interface CommandExecutionFence {
  readonly commandId: string;
  readonly attemptCount: number;
}

export interface SensitiveValue {
  utf8(): string;
  bytes(): Uint8Array;
}

export interface OneShotSensitiveLease {
  readonly fence: CommandExecutionFence;
  use<T>(consumer: (value: SensitiveValue) => T): T;
}

export interface PresentationMaterializerPort<TRequest> {
  open(request: TRequest, fence: CommandExecutionFence): OneShotSensitiveLease;
}

export function createOneShotSensitiveLease(
  bytes: Uint8Array,
  fence: CommandExecutionFence,
): OneShotSensitiveLease {
  let consumed = false;
  const secret = new Uint8Array(bytes);
  return Object.freeze({
    fence: Object.freeze({ ...fence }),
    use<T>(consumer: (value: SensitiveValue) => T): T {
      if (consumed) throw new Error("SENSITIVE_LEASE_CONSUMED");
      consumed = true;
      const value = Object.freeze({
        utf8: () => new TextDecoder().decode(secret),
        bytes: () => new Uint8Array(secret),
      });
      try {
        return consumer(value);
      } finally {
        secret.fill(0);
      }
    },
  });
}
