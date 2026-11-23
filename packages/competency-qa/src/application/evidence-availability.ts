import type { QaEvidenceArtifactLink } from "./evidence-artifact-service.ts";

export function qaEvidenceAvailability(
  link: QaEvidenceArtifactLink,
): Readonly<{ availability: "AVAILABLE" | "EXPIRED"; checksum: string }> {
  return Object.freeze({ availability: link.availability, checksum: link.checksum });
}
