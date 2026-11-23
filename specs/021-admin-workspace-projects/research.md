# Research

Decision: enroll only owner.local as project-registrar where project registration is missing. This COMMON role grants only project.register, project.catalog.read and project.onboarding.read. Full system-administrator outside the existing workspace was rejected by automatic approval review as broader than authorized. Do not grant that role or disguise narrow grants under its key. Registration checks the current permission and creates read-only starter access for the registrar. Integration publication, access management and domain work permissions remain absent.

There are three active seed workspaces: local-functional, local-isolated, local-tech-writing. Use a separate per-workspace local_seed_markers key; never bump old LOCAL_SEED_VERSION 5. Stable request UUID and platform_access_changes guard crash/retry. Skip pre-existing revoked member/registrar assignments and disabled global bootstrap; retain DENY and unrelated assignments.

Own session workspaces gain permissions computed by existing current policy. UI filters project.register and never hardcodes persona keys or global role. Destination stays form-local until successful cross-domain creation, then session and route move together. Owners reload on destination change; key/name/reason remain. Existing contribution precedence and implicit project were blocking /projects/new in documentation; common routes need explicit precedence and workspace-level scope.

Live check exposed an existing exchange-controller bug: the generic anti-authority guard rejected the explicitly supported workspaceId selector. Replaced this invocation with a strict two-field input allowlist and existing server-side membership resolution; added a real HTTP regression for member/nonmember/invalid target/authority injection.
