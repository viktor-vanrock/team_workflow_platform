import { EntitySchema } from "typeorm";

export const SchemaVersionEntity = new EntitySchema({
  name: "SchemaVersion",
  tableName: "platform_schema_versions",
  columns: {
    namespace: { type: String, primary: true },
    version: { type: Number },
    appliedAt: { name: "applied_at", type: "timestamptz" },
  },
});
export const ClassificationEntity = new EntitySchema({
  name: "Classification",
  tableName: "classification_catalog",
  columns: {
    key: { type: String, primary: true },
    rank: { type: Number, unique: true },
    retiredAt: { name: "retired_at", type: "timestamptz", nullable: true },
  },
});
export const platformPrimitiveEntities = Object.freeze([SchemaVersionEntity, ClassificationEntity]);
