import { randomUUID } from "node:crypto";
import type { JiraIssueRead } from "@awp/connector-jira";
import type { CorporateConnectorGrant } from "../pilot/connector-authority.ts";
import type { CorporateConnectorFactories } from "../pilot/connector-factories.ts";
import { jiraMappingRuntimeContent } from "./qa-connection-content.ts";
import {
  corporateJiraObservationMappings,
  normalizeCorporateJiraObservation,
} from "./corporate-issue-observation.ts";
import type { CorporateJiraCreateObservationAuthority } from "./qa-corporate-worker-steps.ts";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CORPORATE_JIRA_CREATE_OBSERVATION_INVALID");
  return value as Record<string, unknown>;
};

/** Read the actual Jira issue before persisting the create confirmation. */
export function createCorporateJiraCreateObservationAuthority(
  input: Readonly<{
    grants: readonly CorporateConnectorGrant[];
    factories: CorporateConnectorFactories;
  }>,
): CorporateJiraCreateObservationAuthority {
  return {
    async read(command, pins, result) {
      const grants = input.grants.filter(
        ({ binding, integrationBindingRef }) =>
          binding.provider === "JIRA" &&
          binding.workspaceId === command.workspaceId &&
          binding.projectId === command.projectId &&
          integrationBindingRef.id === pins.bindingRef.id &&
          integrationBindingRef.version === pins.bindingRef.version &&
          binding.profileRef.id === pins.profileRef.id &&
          binding.profileRef.version === pins.profileRef.version &&
          binding.connectionRef.id === pins.connectionRef.id &&
          binding.connectionRef.version === pins.connectionRef.version,
      );
      if (grants.length !== 1 || !/^[A-Za-z0-9._-]{1,128}$/u.test(result.externalEntityId))
        throw new Error("CORPORATE_JIRA_CREATE_BINDING_REQUIRED");
      const content = pins.profileContent;
      const envelope = content.profileConfiguration
        ? object(content.profileConfiguration)
        : undefined;
      const profile = envelope ? object(envelope.value ?? envelope) : content;
      const mapping = jiraMappingRuntimeContent(pins.mappingContent as Record<string, unknown>);
      const maps = corporateJiraObservationMappings(profile);
      const project = object(profile.project),
        identity = object(profile.identityPolicy);
      if (
        identity.requesterMode !== "VERIFIED_REPORTER" ||
        typeof project.id !== "string" ||
        typeof profile.projectDiscriminatorFieldId !== "string" ||
        !/^customfield_[0-9]+$/u.test(profile.projectDiscriminatorFieldId) ||
        typeof mapping.projectDiscriminator !== "string" ||
        !mapping.projectDiscriminator
      )
        throw new Error("CORPORATE_JIRA_CREATE_PROFILE_UNSUPPORTED");
      const response = await input.factories.jira(grants[0]!.binding.ref.id).request({
        method: "GET",
        path: `/rest/api/3/issue/${encodeURIComponent(result.externalEntityId)}`,
        signal: AbortSignal.timeout(10_000),
      });
      const raw = object(await response.json()),
        fields = object(raw.fields),
        reporter = object(fields.reporter);
      if (
        object(fields.project).id !== project.id ||
        fields[profile.projectDiscriminatorFieldId] !== mapping.projectDiscriminator ||
        typeof reporter.accountId !== "string" ||
        !reporter.accountId
      )
        throw new Error("CORPORATE_JIRA_CREATE_SCOPE_MISMATCH");
      const issue = {
        id: raw.id,
        key: raw.key,
        updated: fields.updated,
        fields: { ...fields, requester: { accountId: reporter.accountId } },
      } as unknown as JiraIssueRead;
      const observation = normalizeCorporateJiraObservation({
        issue,
        ...maps,
        expectedExternalEntityId: result.externalEntityId,
        observationId: randomUUID(),
        observedAt: new Date().toISOString(),
        source: "CREATE_READ_BACK",
        profileRef: pins.profileRef,
        mappingRef: pins.mappingRef,
        connectionRef: pins.connectionRef,
        adapterFamily: pins.adapterFamily,
        adapterContractVersion: pins.adapterContractVersion,
      });
      if (observation.normalizedStatus !== "NEW")
        throw new Error("CORPORATE_JIRA_CREATE_STATUS_MISMATCH");
      return observation;
    },
  };
}
