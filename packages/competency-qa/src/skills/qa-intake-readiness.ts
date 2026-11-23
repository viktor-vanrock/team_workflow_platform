import { sha256 } from "@awp/platform-contracts";

export const qaIntakeReadinessSkill = Object.freeze({
  key: "qa-intake-readiness",
  version: "1.0.0",
  allowedSubjects: Object.freeze(["DRAFT"]),
  outputSchemaRef: Object.freeze({
    id: "urn:awp:schemas:004:intake-completeness:v1",
    version: 1,
    digest: sha256({ id: "urn:awp:schemas:004:intake-completeness:v1" }),
  }),
  actionAllowlist: Object.freeze([
    Object.freeze({ action: "draft.validate", effectClass: "READ_ONLY" }),
  ]),
  fallback: "DETERMINISTIC",
  maxClassification: "INTERNAL",
});
