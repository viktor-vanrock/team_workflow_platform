# Data model

Existing workspace membership + canonical project-registrar assignment and entitlement revisions, changed through PlatformAccessService. Existing local_seed_markers keyed 021-owner-project-registrar:<workspace UUID>, version1. Stable access request UUID derived from owner + workspace; journal request guards marker gaps. No table changes.

Own session workspaces[] adds optional permissions:string[]. Form destination is one allowed workspace; request identity includes destination and exact registration body. Retain non-scoped fields, reset owner IDs on destination change. Successful result includes target workspace ID for navigation/session refresh.
