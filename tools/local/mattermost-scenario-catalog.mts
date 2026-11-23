export const mattermostScenarioCatalog = Object.freeze({
  "us1-guided-intake": "NORMAL",
  "us1-repeat-callback": "NORMAL",
  "us1-valid-fields-not-reasked": "NORMAL",
  "us2-jira-candidate-create": "NORMAL",
  "us2-jira-candidate-snooze": "NORMAL",
  "us2-jira-candidate-ignore": "NORMAL",
  "us2-source-version-update": "NORMAL",
  "us3-triage-valid": "NORMAL",
  "us3-source-drift-stale": "NORMAL",
  "us3-model-invalid-json": "NORMAL",
  "us3-model-timeout": "NORMAL",
  "us3-prompt-injection": "NORMAL",
  "us4-outage-before-send": "NETWORK_LOSS",
  "us4-rate-limit-recovery": "RATE_LIMIT_429",
  "us4-timeout-after-effect": "TIMEOUT_AFTER_EFFECT",
  "us4-permanent-auth-failure": "AUTHENTICATION_401",
  reset: "NORMAL",
} as const);
export type MattermostScenarioName = keyof typeof mattermostScenarioCatalog;
export type MattermostMockScenario = (typeof mattermostScenarioCatalog)[MattermostScenarioName];
export const documentedMattermostScenarioNames = Object.freeze(
  (Object.keys(mattermostScenarioCatalog) as MattermostScenarioName[]).filter(
    (name) => name !== "reset",
  ),
);
