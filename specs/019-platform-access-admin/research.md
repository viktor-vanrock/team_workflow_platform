# Research

- Existing core supports multiple role assignments and DENY precedence, but local HTTP/UI caps rights by seed persona. Remove these caps only where authoritative DB checks replace them.
- Global administration is separate from ResourceScope. ADR 0013 and constitution 2.1.0 record explicit user authorization. Separate global assignment never grants business permissions.
- CorporateSessionService owns verified identity, cookie, CSRF and step-up. Add optional platform authorization and verified-login provisioning ports there; retain legacy default deny when policy absent. Research agent confirmed no corporate Keycloak config exists and existing OIDC fixtures can validate the flow.
- Role catalog belongs to runtime composition (core must not import QA/docs). Materialize exact project entitlements and ALL_PROJECTS roles; preserve unrelated assignments and all DENY.
- Store versioned per-person/workspace access heads and immutable changes with unique request keys. Serialize workspace access changes and project registration using workspace row locks. Retry requires identical input.
- Existing local owner receives separate global bootstrap once. Profile backfill includes active HUMAN members only; historical retired accounts remain absent. Repeated seed must not restore revocations.
- No new dependencies or additional human demo accounts. Browser uses existing React styles and auth clients. Corporate deployment remains explicitly composed; no invented credentials.
