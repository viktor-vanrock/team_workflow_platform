import { describe, expect, it } from "vitest";

import {
  buildQaJiraLocalRevisionPlan,
  buildQaJiraLocalSourceRevisionPlan,
  qaJiraLocalBaseSeedRefs,
  qaJiraLocalSeedIds,
  qaJiraLocalSeedRefs,
} from "../../packages/runtime-composition/src/seed/qa-jira-local-seed.ts";
import { qaLocalSeedIds } from "../../packages/runtime-composition/src/seed/qa-local-seed.ts";

const sha = (character: string) => `sha256:${character.repeat(64)}` as const;

describe("qa-jira-local immutable seed revisions", () => {
  it("builds deterministic successors without changing any published qa-local content or hash", () => {
    const published = Object.freeze({
      connection: Object.freeze({
        revisionId: "92100000-0000-4000-8000-000000000001",
        version: 1,
        contentHash: sha("1"),
      }),
      mapping: Object.freeze({
        revisionId: "92100000-0000-4000-8000-000000000002",
        version: 1,
        contentHash: sha("2"),
      }),
      profile: Object.freeze({
        revisionId: qaLocalSeedIds.profileRevision4,
        version: 4,
        contentHash: sha("3"),
        content: Object.freeze({
          connectorKey: "operational.mock",
          connectionRef: Object.freeze({ id: qaLocalSeedIds.connection, version: 1 }),
          mappingRef: Object.freeze({
            id: qaLocalSeedIds.mapping,
            version: 1,
            contentHash: sha("2"),
          }),
          capabilityConfigurations: Object.freeze([
            Object.freeze({
              capabilityKey: "operational-work-item",
              operations: Object.freeze([
                Object.freeze({
                  operation: "request.create",
                  idempotencyStrategy: "NATIVE_KEY",
                  confirmationMode: "SYNC_RECEIPT",
                }),
              ]),
            }),
          ]),
        }),
      }),
      binding: Object.freeze({
        revisionId: qaLocalSeedIds.alphaBindingRevision4,
        version: 4,
        contentHash: sha("4"),
        content: Object.freeze({
          key: "qa-request-authority",
          entries: Object.freeze([
            Object.freeze({
              logicalRole: "QA_REQUEST_AUTHORITY",
              operations: Object.freeze(["request.create"]),
              profileRef: Object.freeze({ id: qaLocalSeedIds.profile, version: 4 }),
            }),
          ]),
        }),
      }),
    });
    const before = JSON.stringify(published);

    const baseFirst = buildQaJiraLocalRevisionPlan(published, "http://mock-hub:4010");
    const baseSecond = buildQaJiraLocalRevisionPlan(published, "http://mock-hub:4010");
    const publishedBase = Object.freeze({
      connection: Object.freeze({
        revisionId: baseFirst.connection.revisionId,
        version: baseFirst.connection.version,
        contentHash: baseFirst.connection.contentHash,
      }),
      mapping: Object.freeze({
        revisionId: baseFirst.mapping.revisionId,
        version: baseFirst.mapping.version,
        contentHash: baseFirst.mapping.contentHash,
      }),
      profile: Object.freeze({
        revisionId: baseFirst.profile.revisionId,
        version: baseFirst.profile.version,
        contentHash: baseFirst.profile.contentHash,
        content: baseFirst.profile.content,
      }),
      binding: Object.freeze({
        revisionId: baseFirst.binding.revisionId,
        version: baseFirst.binding.version,
        contentHash: baseFirst.binding.contentHash,
        content: baseFirst.binding.content,
      }),
    });
    const baseBeforeSource = JSON.stringify(publishedBase);
    const sourceFirst = buildQaJiraLocalSourceRevisionPlan(publishedBase);
    const sourceSecond = buildQaJiraLocalSourceRevisionPlan(publishedBase);

    expect(JSON.stringify(published)).toBe(before);
    expect(JSON.stringify(publishedBase)).toBe(baseBeforeSource);
    expect(baseSecond).toEqual(baseFirst);
    expect(sourceSecond).toEqual(sourceFirst);
    expect(baseFirst.refs).toEqual(qaJiraLocalBaseSeedRefs);
    expect(sourceFirst.refs).toEqual(qaJiraLocalSeedRefs);
    expect(baseFirst.profile.content.previousRef).toEqual({
      id: qaLocalSeedIds.profileRevision4,
      version: 4,
      contentHash: sha("3"),
    });
    expect(baseFirst.binding.content.previousRef).toEqual({
      id: qaLocalSeedIds.alphaBindingRevision4,
      version: 4,
      contentHash: sha("4"),
    });
    expect(sourceFirst.profile).toMatchObject({
      revisionId: qaJiraLocalSeedIds.profileSourcePolicyRevision,
      headerId: qaJiraLocalSeedRefs.profile.id,
      version: qaJiraLocalSeedRefs.profile.version,
    });
    expect(sourceFirst.profile.content).toMatchObject({
      sourceLinkPolicy: {
        strategy: "NATIVE_SAME_AUTHORITY",
        typeId: "10000",
        direction: "OUTWARD",
      },
      previousRef: {
        id: qaJiraLocalSeedIds.profileRevision,
        version: qaJiraLocalBaseSeedRefs.profile.version,
        contentHash: baseFirst.profile.contentHash,
      },
    });
    expect(sourceFirst.sourceMapping).toMatchObject({
      revisionId: qaJiraLocalSeedIds.sourceMappingRevision,
      headerId: qaJiraLocalSeedRefs.sourceMapping.id,
      version: 1,
      content: {
        logicalRole: "SOURCE_CONTEXT",
        sourceReferenceMapping: {
          rules: [
            { sourceKind: "JIRA_ISSUE", subEffectKind: "LINK" },
            { sourceKind: "URL", subEffectKind: "REMOTE_LINK" },
          ],
          commentPolicy: { mode: "DISABLED" },
        },
      },
    });
    expect(sourceFirst.sourceProfile).toMatchObject({
      revisionId: qaJiraLocalSeedIds.sourceProfileRevision,
      headerId: qaJiraLocalSeedRefs.sourceProfile.id,
      version: 1,
      content: {
        logicalRole: "SOURCE_CONTEXT",
        connectionRef: {
          ...qaJiraLocalSeedRefs.connection,
          contentHash: baseFirst.connection.contentHash,
        },
        mappingRef: {
          ...qaJiraLocalSeedRefs.sourceMapping,
          contentHash: sourceFirst.sourceMapping.contentHash,
        },
        allowedProjectIds: ["200"],
        allowedIssueTypeIds: ["10002"],
        jiraLinkTypes: [{ typeId: "10000", direction: "OUTWARD" }],
      },
    });
    expect(sourceFirst.binding.content.previousRef).toEqual({
      id: qaJiraLocalSeedIds.alphaBindingRevision,
      version: qaJiraLocalBaseSeedRefs.binding.version,
      contentHash: baseFirst.binding.contentHash,
    });
    expect(sourceFirst.binding.content.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalRole: "QA_REQUEST_AUTHORITY",
          profileRef: expect.objectContaining(qaJiraLocalSeedRefs.profile),
        }),
        expect.objectContaining({
          logicalRole: "SOURCE_CONTEXT",
          profileRef: expect.objectContaining(qaJiraLocalSeedRefs.sourceProfile),
        }),
      ]),
    );
    expect(sourceFirst.binding.content.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalRole: "SOURCE_CONTEXT",
          profileRef: expect.objectContaining(qaJiraLocalSeedRefs.profile),
        }),
      ]),
    );
  });
});
