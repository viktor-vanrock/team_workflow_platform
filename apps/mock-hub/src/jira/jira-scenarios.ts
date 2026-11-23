import type { DataSource } from "typeorm";

export const jiraScenarios = Object.freeze([
  "NORMAL",
  "TIMEOUT_BEFORE_EFFECT",
  "TIMEOUT_AFTER_EFFECT",
  "AUTHENTICATION_401",
  "PERMISSION_403",
  "RATE_LIMIT_429",
  "SERVER_500",
  "SCHEMA_DRIFT",
  "EVENTUAL_SEARCH_ZERO",
  "DUPLICATE_WEBHOOK",
  "OUT_OF_ORDER_WEBHOOK",
  "VERIFIED_DIRECT_IMPORT",
  "OUT_OF_SCOPE_IMPORT",
  "CREATE_IMPORT_RACE",
  "DYNAMIC_WEBHOOK_EXPIRED",
  "CANDIDATE_TRIGGER",
  "CANDIDATE_VERSION_UPDATE",
] as const);

export type JiraScenario = (typeof jiraScenarios)[number];
export type JiraScenarioOperation = "LOOKUP" | "CREATE" | "READ" | "PROPERTY" | "LINK" | "COMMENT";

const scenarioSet: ReadonlySet<string> = new Set(jiraScenarios);
const writeOperations: ReadonlySet<JiraScenarioOperation> = new Set([
  "CREATE",
  "PROPERTY",
  "LINK",
  "COMMENT",
]);
const requestFaults = Object.freeze([
  "AUTHENTICATION_401",
  "PERMISSION_403",
  "RATE_LIMIT_429",
  "SERVER_500",
  "SCHEMA_DRIFT",
] satisfies readonly JiraScenario[]);

interface ScenarioRow {
  readonly scenario: unknown;
}

function assertScenario(value: string): asserts value is JiraScenario {
  if (!scenarioSet.has(value)) throw new Error("JIRA_MOCK_SCENARIO_INVALID");
}

function applicableScenarios(operation: JiraScenarioOperation): readonly JiraScenario[] {
  return Object.freeze([
    ...requestFaults,
    ...(operation === "LOOKUP" ? ["EVENTUAL_SEARCH_ZERO" as const] : []),
    ...(writeOperations.has(operation)
      ? ["TIMEOUT_BEFORE_EFFECT" as const, "TIMEOUT_AFTER_EFFECT" as const]
      : []),
  ]);
}

export interface JiraScenarioRepository {
  set(value: JiraScenario): Promise<void>;
  consume(applicable: readonly JiraScenario[]): Promise<JiraScenario>;
  current(): Promise<JiraScenario>;
}

export class InMemoryJiraScenarioRepository implements JiraScenarioRepository {
  #scenario: JiraScenario = "NORMAL";

  async set(value: JiraScenario): Promise<void> {
    this.#scenario = value;
  }

  async consume(applicable: readonly JiraScenario[]): Promise<JiraScenario> {
    const current = this.#scenario;
    if (current === "NORMAL" || !applicable.includes(current)) return "NORMAL";
    this.#scenario = "NORMAL";
    return current;
  }

  async current(): Promise<JiraScenario> {
    return this.#scenario;
  }
}

/**
 * PostgreSQL is authoritative for the one-shot fault. The conditional UPDATE
 * both claims and resets it, so concurrent requests cannot consume the same
 * injected failure and a process restart cannot lose a pending scenario.
 */
export class TypeOrmJiraScenarioRepository implements JiraScenarioRepository {
  constructor(private readonly source: DataSource) {}

  async set(value: JiraScenario): Promise<void> {
    await this.source.query(
      `INSERT INTO jira_mock_scenario(singleton,scenario) VALUES(1,$1)
       ON CONFLICT(singleton) DO UPDATE SET scenario=EXCLUDED.scenario`,
      [value],
    );
  }

  async consume(applicable: readonly JiraScenario[]): Promise<JiraScenario> {
    if (applicable.length === 0) return "NORMAL";
    return await this.source.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT scenario
           FROM jira_mock_scenario
          WHERE singleton=1
            AND scenario = ANY($1::text[])
          FOR UPDATE`,
        [[...applicable]],
      )) as readonly ScenarioRow[];
      const claimed = rows[0]?.scenario;
      if (typeof claimed !== "string") return "NORMAL";
      assertScenario(claimed);
      await manager.query("UPDATE jira_mock_scenario SET scenario='NORMAL' WHERE singleton=1");
      return claimed;
    });
  }

  async current(): Promise<JiraScenario> {
    const rows = (await this.source.query(
      "SELECT scenario FROM jira_mock_scenario WHERE singleton=1",
    )) as readonly { readonly scenario: unknown }[];
    const current = rows[0]?.scenario;
    if (typeof current !== "string") throw new Error("JIRA_MOCK_SCENARIO_STATE_MISSING");
    assertScenario(current);
    return current;
  }
}

export class JiraScenarioController {
  constructor(
    private readonly repository: JiraScenarioRepository = new InMemoryJiraScenarioRepository(),
  ) {}

  async set(value: JiraScenario): Promise<void> {
    assertScenario(value);
    await this.repository.set(value);
  }

  async consume(operation: JiraScenarioOperation): Promise<JiraScenario> {
    return await this.repository.consume(applicableScenarios(operation));
  }

  async current(): Promise<JiraScenario> {
    return await this.repository.current();
  }
}
