import type { DataSource, EntityManager } from "typeorm";

import {
  assertExactRevisionRef,
  type ExactRevisionRef,
  freezePilotValue,
  pilotContentHash,
  type ProjectScope,
  samePilotRef,
  validateInputPackage008,
} from "@awp/platform-core";
import {
  type RuntimeConfigurationKind,
  type RuntimeConfigurationPublication,
  RuntimeConfigurationRepository,
} from "@awp/platform-persistence-typeorm";

import { type DeploymentPolicy, parseDeploymentPolicy } from "./deployment-config.ts";
import type { PilotInputReadiness, PilotInputReadinessPort } from "./readiness-query.ts";
import { DeploymentStartup, type DeploymentStartupOptions } from "./startup.ts";

const policyKinds = {
  inputPackageRef: "INPUT_PACKAGE",
  identityPolicyRef: "IDENTITY_POLICY",
  secretResolverPolicyRef: "SECRET_RESOLVER_POLICY",
  signingPolicyRef: "SIGNING_POLICY",
  telemetryPolicyRef: "TELEMETRY_POLICY",
  networkPolicyRef: "NETWORK_POLICY",
  artifactPolicyRef: "ARTIFACT_POLICY",
  modelPolicyRef: "MODEL_POLICY",
  recoveryPolicyRef: "RECOVERY_POLICY",
} as const;
type Row = Record<string, unknown>;
const denied = (): never => {
  throw new Error("DEPLOYMENT_INPUT_UNAVAILABLE");
};
const record = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return denied();
  return value as Row;
};
const array = (value: unknown): Row[] => {
  if (!Array.isArray(value)) return denied();
  return value.map(record);
};
const matches = (value: unknown, ref: ExactRevisionRef) => {
  const actual = record(value);
  return (
    actual.id === ref.id &&
    actual.version === ref.version &&
    (actual.contentHash === undefined || actual.contentHash === ref.contentHash)
  );
};
const sameProjects = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  left.every((id) => right.includes(id));
const ownerRoles = [
  "PROJECT_OWNER",
  "INTEGRATION_OWNER",
  "IDENTITY_OWNER",
  "SECURITY_OWNER",
  "NETWORK_OWNER",
  "OPERATIONS_OWNER",
  "ARTIFACT_OWNER",
  "RECOVERY_OWNER",
  "SECURITY_OWNER",
  "PILOT_SPONSOR",
  "QA_LEAD",
  "OPERATIONS_OWNER",
];

/** A bounded read of exact current publications. It proves configuration presence, never credentials,
 * endpoint conformance, a Project stage, or permission to issue an external command. */
export class PublishedDeploymentReferences implements PilotInputReadinessPort {
  readonly policy: DeploymentPolicy;
  readonly #repository = new RuntimeConfigurationRepository();
  constructor(
    private readonly source: DataSource,
    policy: unknown,
    private readonly deadlineMs = 1000,
  ) {
    this.policy = parseDeploymentPolicy(policy);
    if (
      !Number.isSafeInteger(deadlineMs) ||
      deadlineMs < 100 ||
      deadlineMs > 5000 ||
      [this.policy.workspaceId, ...this.policy.projectIds].some(
        (id) => !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id),
      )
    )
      denied();
    // A single ID cannot stand in for different policy owners, or for all three connectors.
    const ids = [
      ...Object.keys(policyKinds).map((key) => this.policy[key as keyof typeof policyKinds].id),
      ...this.policy.connectorBindings.map((value) => value.ref.id),
    ];
    if (new Set(ids).size !== ids.length) denied();
  }
  async assertCurrent(
    policy: DeploymentPolicy,
    signal: AbortSignal,
  ): Promise<Readonly<{ validUntil: string }>> {
    const result = await this.load(policy, signal);
    return { validUntil: result.validUntil };
  }
  /** The complete factory consumes these same documents when constructing the concrete adapters. */
  async load(policy: DeploymentPolicy, signal: AbortSignal) {
    if (signal.aborted || pilotContentHash(policy) !== pilotContentHash(this.policy)) denied();
    signal = AbortSignal.any([signal, AbortSignal.timeout(this.deadlineMs)]);
    const publications: RuntimeConfigurationPublication[] = [];
    try {
      return await this.source.transaction("REPEATABLE READ", async (manager) => {
        if (signal.aborted) denied();
        await this.bound(manager);
        const read = async (ref: ExactRevisionRef, kind: RuntimeConfigurationKind) => {
          let result: RuntimeConfigurationPublication | undefined;
          for (const projectId of policy.projectIds) {
            if (signal.aborted) denied();
            const value = await this.#repository.current(
              manager,
              { workspaceId: policy.workspaceId, projectId },
              ref,
              kind,
            );
            if (!sameProjects(value.projectIds, policy.projectIds)) denied();
            result = value;
          }
          if (!result) return denied();
          publications.push(result);
          return result;
        };
        for (const key of Object.keys(policyKinds) as (keyof typeof policyKinds)[]) {
          const value = await read(policy[key], policyKinds[key]);
          if (key === "inputPackageRef") this.input(value, policy.projectIds[0]!);
          if (
            key === "networkPolicyRef" &&
            value.document.mode !==
              (policy.deploymentProfile === "local" ? "LOCAL_FIXTURE" : "CORPORATE")
          )
            denied();
        }
        for (const pin of policy.connectorBindings) {
          const value = await read(pin.ref, "CONNECTOR_BINDING");
          await this.connector(manager, pin.provider, value.document, signal);
        }
        const validUntil = Math.min(...publications.map((value) => Date.parse(value.validUntil)));
        if (signal.aborted || !Number.isFinite(validUntil) || validUntil <= Date.now()) denied();
        return freezePilotValue({ validUntil: new Date(validUntil).toISOString(), publications });
      });
    } catch {
      return denied();
    }
  }
  async current(
    manager: EntityManager,
    scope: ProjectScope,
    ref: ExactRevisionRef,
  ): Promise<PilotInputReadiness> {
    if (
      scope.workspaceId !== this.policy.workspaceId ||
      !this.policy.projectIds.includes(scope.projectId) ||
      !samePilotRef(ref, this.policy.inputPackageRef)
    )
      denied();
    await this.bound(manager);
    return this.input(
      await this.#repository.current(manager, scope, ref, "INPUT_PACKAGE"),
      scope.projectId,
    );
  }
  private input(value: RuntimeConfigurationPublication, projectId: string): PilotInputReadiness {
    const input = value.document;
    const scope = record(input.scope);
    const checked = validateInputPackage008(input, "N2");
    if (
      checked.status !== "PASS" ||
      input.id !== value.ref.id ||
      input.version !== value.ref.version ||
      input.profile !== this.policy.deploymentProfile ||
      scope.workspaceId !== this.policy.workspaceId ||
      !Array.isArray(scope.projectIds) ||
      !sameProjects(scope.projectIds as string[], this.policy.projectIds) ||
      !sameProjects(value.projectIds, this.policy.projectIds)
    )
      denied();
    const entries = array(input.entries);
    if (
      entries.some(
        (entry) =>
          !Array.isArray(entry.projectIds) ||
          !sameProjects(entry.projectIds as string[], this.policy.projectIds),
      )
    )
      denied();
    return freezePilotValue({
      workspaceId: this.policy.workspaceId,
      projectId,
      packageRef: value.ref,
      observedAt: value.publishedAt,
      validUntil: value.validUntil,
      entries: entries.map((entry) => ({
        id: String(entry.id),
        ownerRole: ownerRoles[Number(String(entry.id).slice(3)) - 1]!,
        status: "PASS" as const,
        reasonCodes: [],
      })),
    });
  }
  private async connector(
    manager: EntityManager,
    provider: string,
    document: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    const configuration = record(document);
    const projects = array(configuration.projects);
    if (
      configuration.provider !== provider ||
      !sameProjects(
        projects.map((value) => String(value.projectId)),
        this.policy.projectIds,
      )
    )
      denied();
    for (const value of projects) {
      if (signal.aborted) denied();
      const refs = [
        value.integrationBindingRef,
        value.profileRef,
        value.connectionRef,
      ] as ExactRevisionRef[];
      refs.forEach(assertExactRevisionRef);
      const [bindingRef, profileRef, connectionRef] = refs as [
        ExactRevisionRef,
        ExactRevisionRef,
        ExactRevisionRef,
      ];
      const current = async (
        table: "project_integration_binding" | "connector_profile" | "connection",
        ref: ExactRevisionRef,
      ) => {
        if (signal.aborted) denied();
        const binding = table === "project_integration_binding";
        const rows = (await manager.query(
          `SELECT r.content FROM ${table}_headers h JOIN ${table}_revisions r
          ON r.header_id=h.id AND r.workspace_id=h.workspace_id AND r.version=h.current_published_version${binding ? " AND r.project_id=h.project_id" : ""}
          WHERE h.workspace_id=$1 AND h.id=$2 AND r.version=$3 AND r.content_hash=$4 AND r.status='PUBLISHED'${binding ? " AND h.project_id=$5" : ""} FOR SHARE OF h`,
          [
            this.policy.workspaceId,
            ref.id,
            ref.version,
            ref.contentHash,
            ...(binding ? [value.projectId] : []),
          ],
        )) as { content: unknown }[];
        if (rows.length !== 1 || pilotContentHash(rows[0]!.content) !== ref.contentHash)
          return denied();
        return record(rows[0]!.content);
      };
      const binding = await current("project_integration_binding", bindingRef);
      const profile = await current("connector_profile", profileRef);
      const connection = await current("connection", connectionRef);
      const entries = array(binding.entries).filter((entry) =>
        matches(entry.profileRef, profileRef),
      );
      if (
        typeof value.connectorKey !== "string" ||
        !value.connectorKey ||
        profile.connectorKey !== value.connectorKey ||
        connection.connectorKey !== value.connectorKey ||
        !matches(profile.connectionRef, connectionRef) ||
        !entries.length ||
        entries.some((entry) => entry.environmentScope !== this.policy.environmentScope) ||
        entries.some(
          (entry) =>
            !array(profile.capabilityConfigurations).some(
              (capability) =>
                capability.capabilityKey === entry.capabilityKey &&
                capability.exactContractVersion === entry.exactContractVersion &&
                Array.isArray(capability.environmentScopes) &&
                capability.environmentScopes.includes(this.policy.environmentScope),
            ),
        ) ||
        typeof value.endpoint !== "string" ||
        connection.baseUrl !== value.endpoint ||
        this.policy.endpoints.find((endpoint) => endpoint.purpose === provider)?.url !==
          value.endpoint
      )
        denied();
    }
  }
  private async bound(manager: EntityManager) {
    if (!manager.queryRunner?.isTransactionActive) denied();
    await manager.query(
      "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
      [String(this.deadlineMs)],
    );
  }
}

/** Corporate startup obtains reference checks from persistence; callers cannot replace them with a
 * callback returning true. Concrete domain/API/worker assembly is still required before listening. */
export function createPublishedDeploymentStartup(
  source: DataSource,
  input: Omit<DeploymentStartupOptions, "references">,
) {
  const references = new PublishedDeploymentReferences(
    source,
    input.policy,
    input.validationDeadlineMs,
  );
  return new DeploymentStartup(source, { ...input, references });
}
