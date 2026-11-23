export class PolicyDenialHarness {
  #adapterCalls = 0;
  async execute<T>(allowed: boolean, adapter: () => Promise<T>): Promise<T> {
    if (!allowed) throw new Error("POLICY_DENIED");
    this.#adapterCalls += 1;
    return await adapter();
  }
  get adapterCalls(): number {
    return this.#adapterCalls;
  }
}
