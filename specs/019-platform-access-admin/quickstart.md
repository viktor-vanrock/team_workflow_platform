# Quickstart

1. Run normal local upgrade/seed without reset. After core 230, sign in first as the desired existing local user; this human receives the sole global role. Open /admin/users. Other users retain their existing working roles.
2. Select a named person/workspace, choose multiple domain roles, classification and reason, perform local step-up and save. Refresh the person's session and check the union of allowed actions; no project selector is required.
3. Revoke one role and verify the existing token is denied for its unique mutation while retained roles work. Use disposable test fixtures for these changes.
4. Verify every other user cannot open the global directory; a platform-only fixture can administer but cannot read business objects. Local and corporate bootstrap are independent and never reopen after revocation.
5. Corporate fixtures verify the first verified human receives the global role without groups, later users have pending profiles, and revocation, CSRF and fresh step-up are enforced.
6. Future Keycloak deployment supplies exact issuer/client/session policy and leaves provisioning enabled; no live corporate realm is configured by this feature. See the deployment guide and ADR-0015/0016.
