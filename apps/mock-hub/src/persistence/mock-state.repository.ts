import type { DataSource } from "typeorm";

export type MockScenario =
  | "SUCCESS"
  | "TIMEOUT"
  | "AUTHENTICATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "DUPLICATE_EVENT"
  | "OUT_OF_ORDER_EVENT"
  | "SCHEMA_DRIFT"
  | "PARTIAL_EFFECT";

export interface MockScenarioState {
  readonly scenario: MockScenario;
  readonly appliesToNext: number;
}
export interface MockCallRecord {
  readonly sequence: number;
  readonly effectIdempotencyKey: string;
  readonly requestHash: string;
  readonly recordedAt: Date;
}
export interface MockEffectRecord {
  readonly effectIdempotencyKey: string;
  readonly requestHash: string;
  readonly effectCount: number;
  readonly externalRecordId: string;
  readonly result: unknown;
  readonly recordedAt: Date;
}
export interface MockEventRecord {
  readonly sequence: number;
  readonly eventId: string;
  readonly scenario: "NORMAL" | "DUPLICATE_EVENT" | "OUT_OF_ORDER_EVENT";
  readonly externalRecordId: string;
  readonly recordedAt: Date;
}

export interface MockStateRepository {
  reset(): Promise<void>;
  seed(seed: number): Promise<void>;
  setScenario(scenario: MockScenarioState): Promise<void>;
  consumeScenario(): Promise<MockScenario>;
  recordCall(input: Omit<MockCallRecord, "sequence" | "recordedAt">): Promise<MockCallRecord>;
  applyEffect(
    input: Omit<MockEffectRecord, "effectCount" | "recordedAt">,
  ): Promise<MockEffectRecord>;
  appendEvents(events: readonly Omit<MockEventRecord, "sequence" | "recordedAt">[]): Promise<void>;
  calls(): Promise<readonly MockCallRecord[]>;
  effects(): Promise<readonly MockEffectRecord[]>;
  events(): Promise<readonly MockEventRecord[]>;
}

export class InMemoryMockStateRepository implements MockStateRepository {
  #seed = 0;
  #scenario: MockScenarioState = { scenario: "SUCCESS", appliesToNext: 0 };
  readonly #calls: MockCallRecord[] = [];
  readonly #effects = new Map<string, MockEffectRecord>();
  readonly #events: MockEventRecord[] = [];

  async reset(): Promise<void> {
    this.#seed = 0;
    this.#scenario = { scenario: "SUCCESS", appliesToNext: 0 };
    this.#calls.length = 0;
    this.#effects.clear();
    this.#events.length = 0;
  }
  async seed(seed: number): Promise<void> {
    await this.reset();
    this.#seed = seed;
  }
  async setScenario(scenario: MockScenarioState): Promise<void> {
    if (!Number.isSafeInteger(scenario.appliesToNext) || scenario.appliesToNext < 1)
      throw new Error("INVALID_SCENARIO_COUNT");
    this.#scenario = structuredClone(scenario);
  }
  async consumeScenario(): Promise<MockScenario> {
    if (this.#scenario.appliesToNext < 1) return "SUCCESS";
    const scenario = this.#scenario.scenario;
    this.#scenario = { scenario, appliesToNext: this.#scenario.appliesToNext - 1 };
    return scenario;
  }
  async recordCall(
    input: Omit<MockCallRecord, "sequence" | "recordedAt">,
  ): Promise<MockCallRecord> {
    const record = Object.freeze({
      ...input,
      sequence: this.#calls.length + 1,
      recordedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    this.#calls.push(record);
    return structuredClone(record);
  }
  async applyEffect(
    input: Omit<MockEffectRecord, "effectCount" | "recordedAt">,
  ): Promise<MockEffectRecord> {
    const existing = this.#effects.get(input.effectIdempotencyKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash)
        throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
      return structuredClone(existing);
    }
    const record = Object.freeze({
      ...input,
      effectCount: 1,
      recordedAt: new Date(1_767_225_600_000 + this.#seed),
    });
    this.#effects.set(input.effectIdempotencyKey, record);
    return structuredClone(record);
  }
  async appendEvents(
    events: readonly Omit<MockEventRecord, "sequence" | "recordedAt">[],
  ): Promise<void> {
    for (const event of events)
      this.#events.push(
        Object.freeze({
          ...event,
          sequence: this.#events.length + 1,
          recordedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      );
  }
  async calls(): Promise<readonly MockCallRecord[]> {
    return structuredClone(this.#calls);
  }
  async effects(): Promise<readonly MockEffectRecord[]> {
    return structuredClone([...this.#effects.values()]);
  }
  async events(): Promise<readonly MockEventRecord[]> {
    return structuredClone(this.#events);
  }
}
type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T =>
  typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
const returnedRows = (value: unknown): Row[] =>
  Array.isArray(value) && Array.isArray(value[0]) ? (value[0] as Row[]) : (value as Row[]);
export class TypeOrmMockStateRepository implements MockStateRepository {
  constructor(private readonly dataSource: DataSource) {}
  async reset(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query("TRUNCATE mock_calls,mock_effects,mock_events RESTART IDENTITY");
      await manager.query(
        "UPDATE mock_scenario SET scenario='SUCCESS',applies_to_next=0 WHERE singleton=1",
      );
    });
  }
  async seed(seed: number): Promise<void> {
    await this.reset();
    await this.dataSource.query("UPDATE mock_seed_state SET seed=$1 WHERE singleton=1", [seed]);
  }
  async setScenario(value: MockScenarioState): Promise<void> {
    if (!Number.isSafeInteger(value.appliesToNext) || value.appliesToNext < 1)
      throw new Error("INVALID_SCENARIO_COUNT");
    await this.dataSource.query(
      "UPDATE mock_scenario SET scenario=$1,applies_to_next=$2 WHERE singleton=1",
      [value.scenario, value.appliesToNext],
    );
  }
  async consumeScenario(): Promise<MockScenario> {
    return await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        "SELECT * FROM mock_scenario WHERE singleton=1 FOR UPDATE",
      )) as Row[];
      const row = rows[0]!;
      if (Number(row.applies_to_next) < 1) return "SUCCESS";
      await manager.query(
        "UPDATE mock_scenario SET applies_to_next=applies_to_next-1 WHERE singleton=1",
      );
      return String(row.scenario) as MockScenario;
    });
  }
  async recordCall(
    input: Omit<MockCallRecord, "sequence" | "recordedAt">,
  ): Promise<MockCallRecord> {
    const rows = returnedRows(
      await this.dataSource.query(
        "INSERT INTO mock_calls(effect_idempotency_key,request_hash,recorded_at) VALUES($1,$2,clock_timestamp()) RETURNING *",
        [input.effectIdempotencyKey, input.requestHash],
      ),
    );
    const row = rows[0]!;
    return {
      ...input,
      sequence: Number(row.sequence),
      recordedAt: new Date(String(row.recorded_at)),
    };
  }
  async applyEffect(
    input: Omit<MockEffectRecord, "effectCount" | "recordedAt">,
  ): Promise<MockEffectRecord> {
    return await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        "SELECT * FROM mock_effects WHERE effect_idempotency_key=$1 FOR UPDATE",
        [input.effectIdempotencyKey],
      )) as Row[];
      const existing = rows[0];
      if (existing) {
        if (String(existing.request_hash) !== input.requestHash)
          throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
        return {
          effectIdempotencyKey: String(existing.effect_idempotency_key),
          requestHash: String(existing.request_hash),
          effectCount: 1,
          externalRecordId: String(existing.external_record_id),
          result: parse(existing.result),
          recordedAt: new Date(String(existing.recorded_at)),
        };
      }
      const inserted = returnedRows(
        await manager.query(
          "INSERT INTO mock_effects(effect_idempotency_key,request_hash,effect_count,external_record_id,result,recorded_at) VALUES($1,$2,1,$3,$4,clock_timestamp()) RETURNING *",
          [
            input.effectIdempotencyKey,
            input.requestHash,
            input.externalRecordId,
            JSON.stringify(input.result),
          ],
        ),
      );
      const row = inserted[0]!;
      return { ...input, effectCount: 1, recordedAt: new Date(String(row.recorded_at)) };
    });
  }
  async appendEvents(
    events: readonly Omit<MockEventRecord, "sequence" | "recordedAt">[],
  ): Promise<void> {
    for (const event of events)
      await this.dataSource.query(
        "INSERT INTO mock_events(event_id,scenario,external_record_id,recorded_at) VALUES($1,$2,$3,clock_timestamp())",
        [event.eventId, event.scenario, event.externalRecordId],
      );
  }
  async calls(): Promise<readonly MockCallRecord[]> {
    const rows = (await this.dataSource.query(
      "SELECT * FROM mock_calls ORDER BY sequence",
    )) as Row[];
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      effectIdempotencyKey: String(row.effect_idempotency_key),
      requestHash: String(row.request_hash),
      recordedAt: new Date(String(row.recorded_at)),
    }));
  }
  async effects(): Promise<readonly MockEffectRecord[]> {
    const rows = (await this.dataSource.query(
      "SELECT * FROM mock_effects ORDER BY effect_idempotency_key",
    )) as Row[];
    return rows.map((row) => ({
      effectIdempotencyKey: String(row.effect_idempotency_key),
      requestHash: String(row.request_hash),
      effectCount: Number(row.effect_count),
      externalRecordId: String(row.external_record_id),
      result: parse(row.result),
      recordedAt: new Date(String(row.recorded_at)),
    }));
  }
  async events(): Promise<readonly MockEventRecord[]> {
    const rows = (await this.dataSource.query(
      "SELECT * FROM mock_events ORDER BY sequence",
    )) as Row[];
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      eventId: String(row.event_id),
      scenario: String(row.scenario) as MockEventRecord["scenario"],
      externalRecordId: String(row.external_record_id),
      recordedAt: new Date(String(row.recorded_at)),
    }));
  }
}
