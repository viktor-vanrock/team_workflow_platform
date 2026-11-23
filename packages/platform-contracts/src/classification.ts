/** Stable ranks shared by Core and producers of classification references. */
export const defaultClassificationReferences = Object.freeze([
  Object.freeze({ key: "PUBLIC", rank: 0 }),
  Object.freeze({ key: "INTERNAL", rank: 10 }),
  Object.freeze({ key: "RESTRICTED", rank: 20 }),
  Object.freeze({ key: "CONFIDENTIAL", rank: 30 }),
]);

export function canonicalClassificationReference(
  key: string,
): Readonly<{ key: string; rank: number }> {
  const reference = defaultClassificationReferences.find((entry) => entry.key === key);
  if (!reference) throw new Error("CLASSIFICATION_UNKNOWN");
  return reference;
}
