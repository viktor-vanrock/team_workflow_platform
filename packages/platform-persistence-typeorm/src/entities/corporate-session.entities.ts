import { EntitySchema } from "typeorm";

export const CorporateSessionStateEntity = new EntitySchema({
  name: "CorporateSessionState",
  tableName: "corporate_session_states",
  columns: {
    namespace: { type: String, primary: true },
    stateKey: { name: "state_key", type: String, primary: true },
    ciphertext: { type: String },
    expiresAt: { name: "expires_at", type: "timestamptz" },
    createdAt: { name: "created_at", type: "timestamptz" },
  },
});
export const CorporateIdentityRevocationEntity = new EntitySchema({
  name: "CorporateIdentityRevocation",
  tableName: "corporate_identity_revocations",
  columns: {
    issuer: { type: String, primary: true },
    subject: { type: String, primary: true },
    revokedThrough: { name: "revoked_through", type: "bigint" },
    rowVersion: { name: "row_version", type: "bigint" },
  },
});
export const corporateSessionEntities = Object.freeze([
  CorporateSessionStateEntity,
  CorporateIdentityRevocationEntity,
]);
