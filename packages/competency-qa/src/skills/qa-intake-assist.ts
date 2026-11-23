import { sha256 } from "@awp/platform-contracts";

export const qaIntakeAssistSkill = Object.freeze({
  key: "qa-intake-assist",
  version: "1.0.0",
  allowedSubjects: Object.freeze(["DRAFT"]),
  outputSchemaRef: Object.freeze({
    id: "urn:awp:schemas:004:intake-draft-assistance:v1",
    version: 1,
    digest: sha256({ id: "urn:awp:schemas:004:intake-draft-assistance:v1" }),
  }),
  actionAllowlist: Object.freeze([
    Object.freeze({ action: "draft.propose-patch", effectClass: "DRAFT_MUTATION" }),
  ]),
  fallback: "DETERMINISTIC",
  maxClassification: "INTERNAL",
});
