# Research

## Registration
Decision: reuse published POST and add protected registration-options on existing onboarding controller/service. READ uses current workspace system-administrator/project.register with verified corporate basis if configured; POST retains mandatory step-up. Return only active HUMAN member ID/displayName/username, four canonical classifications and STANDARD criticality (only established value). Legacy integrations continue unchanged.
Rationale: no need for platform directory rights to create a project; no raw UUID entry or new grants. Optional third callback operation parameter defaults MUTATE for compatibility.
Alternatives: global access directory leaks people across domains; static persona list fails corporate identities; inventing criticality semantics is unsupported.

Existing key contract is 2–32 uppercase characters. Five owner fields require active HUMAN members and allow the same person. Existing persistence stores their unique set, not a named responsibility matrix; UI collects the existing command shape without claiming a persisted matrix. Registration permits all canonical project classifications; this feature does not silently change that policy or use workspace authority fallback INTERNAL as a ceiling.

## Queue
Decision: one summary region and one compact row renderer, calculated order first then named pending requests. Keep exact original entries for lead commands. Technical details and order controls sit in expandable per-row details. Refresh loads both named subjects and queue; finish paged queue snapshot before identifying pending requests, reject cursor cycles and retry stale snapshot with a bounded restart.
Rationale: eliminates duplicate visual models without changing source priority, server authorization or comparator. Loading all pages avoids falsely labelling later-page entries as pending.
Alternatives: two card groups preserve user confusion; assigning synthetic priority misrepresents business state; global theme changes affect unrelated screens.

## UI reliability
Decision: dedicated /projects/new, names from scoped options; stable idempotency key per exact draft; block double submit; preserve form through token refresh and failed requests. Refresh session projects after creation so the resulting deep link is authorized. Errors use safe known messages and correlation reference where available.
