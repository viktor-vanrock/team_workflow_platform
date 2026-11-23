# Feature 006 contract examples

These fixtures exercise JSON Schema 2020-12 and the explicitly named composed
validators. Positive fixtures must validate; negative fixtures must fail at the
single boundary named below. An `invalid` row is rejected by JSON Schema itself;
`semantic-invalid` first passes JSON Schema and is then rejected by the composed
publication validator.

| Fixture | Schema | Expected | Boundary exercised |
|---|---|---:|---|
| `positive/business-calendar-utc-midnight.v1.json` | `schemas/business-calendar.v1.schema.json` | valid | `UTC` is a supported IANA identifier and `24:00:00` is legal only as an exclusive interval end. |
| `positive/qa-queue-facts-changed.v1.json` | `schemas/qa-queue-facts-changed.v1.schema.json` | valid | A Project-scoped invalidation carries exact, content-free readiness and session fact refs. |
| `positive/sla-warning-threshold-emission.v1.json` | `schemas/sla-threshold-emission.v1.schema.json` | valid | A `WARNING` crossing has a one-based warning index and the required `AT_RISK` target state. |
| `positive/sla-not-started-measure-only-with-policy.v1.json` | `schemas/sla-snapshot.v1.schema.json` | valid | A published MEASURE_ONLY policy may leave the target unconfigured, but a non-policy-missing NOT_STARTED response still pins policy/calendar/mapping/algorithm provenance. |
| `negative/capacity-admission-global-head-leak.v1.json` | `schemas/capacity-admission.v1.schema.json` | invalid | `expectedCapacityHeadVersion` is forbidden in the public expected-state witness because it could reveal hidden Project activity. Every other field is schema-valid. |
| `negative/business-calendar-invalid-start-midnight.v1.json` | `schemas/business-calendar.v1.schema.json` | invalid | `24:00:00` is forbidden as `startLocalTime`; it is reserved for exclusive interval ends. |
| `negative/business-calendar-duplicate-date-override.v1.json` | `schemas/business-calendar.v1.schema.json` | semantic-invalid | One local date cannot have both CLOSED and WORKING overrides; override dates are unique and have no precedence rule. |
| `negative/triage-assessment-wrapper-dimension.v1.1.json` | `schemas/triage-assessment.v1.1.schema.json` | invalid | Additive v1.1 preserves the legacy scalar dimension wire shape; evidence wrappers belong under `dimensionDetails`. |
| `negative/sla-not-started-measure-only-missing-policy.v1.json` | `schemas/sla-snapshot.v1.schema.json` | invalid | `NO_CONFIRMED_START_EVENT` under a published MEASURE_ONLY policy cannot omit policy/calendar/mapping/algorithm/input provenance merely because the target is NOT_CONFIGURED. |

The validation harness should register strict RFC 3339 `date` and `date-time`
formats plus RFC 4122 `uuid`, assert raw schema results, then run the calendar
publication validator for the semantic-negative row.
