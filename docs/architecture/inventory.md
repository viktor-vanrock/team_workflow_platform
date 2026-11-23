# Технический каталог архитектуры

Снимок: 2026-09-10T12:52:30.332Z. HEAD: `3a7b21c` + рабочие изменения.

Автоматический разбор TypeScript AST. Декларация контроллера не означает его подключение в каждом runtime profile. Список таблиц отражает EntitySchema в исходниках, а не запрос к развёрнутой БД; таблицы, создаваемые только SQL-миграциями, сюда не входят. Source imports включают type-only imports и re-exports.

[Основная схема](README.md)

## Пакеты и зависимости

| Пакет | Исходники | Импорты других пакетов |
|---|---:|---|
| [@awp/api](../../apps/api/package.json) | 98 | `@awp/competency-dummy`, `@awp/competency-qa`, `@awp/competency-tech-writing`, `@awp/competency-ui-sdk`, `@awp/platform-contracts`, `@awp/platform-core`, `@awp/platform-persistence-typeorm`, `@awp/platform-runtime-nest`, `@awp/runtime-composition` |
| [@awp/fake-idp](../../apps/fake-idp/package.json) | 2 | — |
| [@awp/mock-hub](../../apps/mock-hub/package.json) | 49 | — |
| [@awp/web](../../apps/web/package.json) | 35 | `@awp/competency-dummy`, `@awp/competency-qa`, `@awp/competency-tech-writing`, `@awp/competency-ui-sdk`, `@awp/platform-ui` |
| [@awp/worker](../../apps/worker/package.json) | 5 | `@awp/platform-core`, `@awp/platform-runtime-nest`, `@awp/runtime-composition` |
| [@awp/competency-dummy](../../packages/competency-dummy/package.json) | 11 | `@awp/competency-sdk`, `@awp/competency-ui-sdk`, `@awp/platform-core`, `@awp/platform-ui` |
| [@awp/competency-qa](../../packages/competency-qa/package.json) | 245 | `@awp/competency-sdk`, `@awp/competency-ui-sdk`, `@awp/platform-contracts`, `@awp/platform-ui` |
| [@awp/competency-sdk](../../packages/competency-sdk/package.json) | 3 | `@awp/platform-contracts`, `@awp/platform-core` |
| [@awp/competency-tech-writing](../../packages/competency-tech-writing/package.json) | 7 | `@awp/competency-sdk`, `@awp/competency-ui-sdk`, `@awp/platform-ui` |
| [@awp/competency-ui-sdk](../../packages/competency-ui-sdk/package.json) | 2 | — |
| [@awp/connector-gitlab](../../packages/connector-gitlab/package.json) | 16 | `@awp/connector-sdk`, `@awp/platform-contracts` |
| [@awp/connector-gitlab-persistence-typeorm](../../packages/connector-gitlab-persistence-typeorm/package.json) | 13 | `@awp/platform-contracts` |
| [@awp/connector-jira](../../packages/connector-jira/package.json) | 38 | `@awp/platform-contracts` |
| [@awp/connector-jira-persistence-typeorm](../../packages/connector-jira-persistence-typeorm/package.json) | 14 | `@awp/connector-jira`, `@awp/platform-contracts` |
| [@awp/connector-mattermost](../../packages/connector-mattermost/package.json) | 12 | `@awp/connector-sdk`, `@awp/platform-contracts` |
| [@awp/connector-mock](../../packages/connector-mock/package.json) | 5 | `@awp/connector-sdk` |
| [@awp/connector-sdk](../../packages/connector-sdk/package.json) | 10 | `@awp/platform-contracts` |
| [@awp/platform-contracts](../../packages/platform-contracts/package.json) | 12 | — |
| [@awp/platform-core](../../packages/platform-core/package.json) | 87 | `@awp/platform-contracts` |
| [@awp/platform-persistence-typeorm](../../packages/platform-persistence-typeorm/package.json) | 113 | `@awp/platform-contracts`, `@awp/platform-core` |
| [@awp/platform-runtime-nest](../../packages/platform-runtime-nest/package.json) | 35 | `@awp/platform-core` |
| [@awp/platform-testkit](../../packages/platform-testkit/package.json) | 7 | `@awp/platform-core` |
| [@awp/platform-ui](../../packages/platform-ui/package.json) | 8 | — |
| [@awp/runtime-composition](../../packages/runtime-composition/package.json) | 237 | `@awp/competency-dummy`, `@awp/competency-qa`, `@awp/competency-tech-writing`, `@awp/competency-ui-sdk`, `@awp/connector-gitlab`, `@awp/connector-gitlab-persistence-typeorm`, `@awp/connector-jira`, `@awp/connector-jira-persistence-typeorm`, `@awp/connector-mattermost`, `@awp/connector-mock`, `@awp/connector-sdk`, `@awp/platform-contracts`, `@awp/platform-core`, `@awp/platform-persistence-typeorm`, `@awp/platform-runtime-nest` |

## Модули NestJS

| Модуль | Контроллеры в статическом декораторе | Импорты / dynamic | Источник |
|---|---|---|---|
| CorporateAccessModule | — | —; register() — состав см. в коде | [apps/api/src/access/access.module.ts:9](../../apps/api/src/access/access.module.ts#L9) |
| LocalApiModule | LocalHealthController, LocalOpenApiController, LocalPersonaController, LocalAccessController, WorkspaceSubjectsController, TechWritingController, LocalWalkingSkeletonController | — | [apps/api/src/app.module.ts:260](../../apps/api/src/app.module.ts#L260) |
| QaLocalApiModule | LocalHealthController, LocalOpenApiController, LocalPersonaController, LocalAccessController, WorkspaceSubjectsController, TechWritingController, LocalWalkingSkeletonController, QaPackController, QaReadinessController, QaRequiredSessionPlansController, QaSessionsController, QaManualExecutionController, QaEvidenceController, QaSessionReviewController, QaFindingsController, QaDefectsController, QaVerdictCompletionController | — | [apps/api/src/app.module.ts:300](../../apps/api/src/app.module.ts#L300) |
| QaJiraLocalApiModule | LocalHealthController, LocalOpenApiController, LocalPersonaController, LocalAccessController, WorkspaceSubjectsController, TechWritingController, LocalWalkingSkeletonController, QaPackController, QaReadinessController, QaRequiredSessionPlansController, QaSessionsController, QaManualExecutionController, QaEvidenceController, QaSessionReviewController, QaFindingsController, QaDefectsController, QaVerdictCompletionController, ConnectorWebhooksController, OperationalAuthorityController, ApprovalsV11Controller, QueueController, PortfolioQueueController, QueueControlsController, QueuePoliciesController | QueueFoundationApiModule | [apps/api/src/app.module.ts:450](../../apps/api/src/app.module.ts#L450) |
| QaJiraGitLabLocalApiModule | qaGitLabAutomationControllers | QaJiraLocalApiModule | [apps/api/src/app.module.ts:877](../../apps/api/src/app.module.ts#L877) |
| QaJiraMattermostLocalApiModule | MattermostIntegrationController, MattermostBootstrapController, MattermostProjectSelectionController, MattermostIngressController, IntakeDraftRevisionsController, IntakeCandidatesController, AgentRunsController, NotificationIntentsController, QaHermesProposalsController, QaHermesProposalResourcesController, OnboardingController, ProjectDialogueController, PublishedOnboardingController, ProjectReadsController, EvidenceIntegrityController, ProjectOperationsController, PublishedProjectOperationsController | QaJiraLocalApiModule | [apps/api/src/app.module.ts:884](../../apps/api/src/app.module.ts#L884) |
| QaJiraGitLabMattermostLocalApiModule | qaGitLabAutomationControllers | QaJiraMattermostLocalApiModule, QaJiraLocalApiModule | [apps/api/src/app.module.ts:1032](../../apps/api/src/app.module.ts#L1032) |
| CoreApiModule | HealthController | — | [apps/api/src/app.module.ts:1039](../../apps/api/src/app.module.ts#L1039) |
| PilotNonLocalApiModule | — | —; register() — состав см. в коде | [apps/api/src/app.module.ts:1053](../../apps/api/src/app.module.ts#L1053) |
| PublishedAutomationAvailabilityModule | — | —; register() — состав см. в коде | [apps/api/src/extensions/gitlab-automation/published-automation-availability.module.ts:21](../../apps/api/src/extensions/gitlab-automation/published-automation-availability.module.ts#L21) |
| CorporateOnboardingModule | — | —; register() — состав см. в коде | [apps/api/src/extensions/onboarding/corporate-onboarding.module.ts:66](../../apps/api/src/extensions/onboarding/corporate-onboarding.module.ts#L66) |
| PilotDeadLetterModule | — | —; register() — состав см. в коде | [apps/api/src/extensions/pilot/dead-letter.module.ts:15](../../apps/api/src/extensions/pilot/dead-letter.module.ts#L15) |
| ProviderIngressModule | — | —; register() — состав см. в коде | [apps/api/src/extensions/pilot/provider-ingress.module.ts:96](../../apps/api/src/extensions/pilot/provider-ingress.module.ts#L96) |
| QueueFoundationApiModule | — | — | [apps/api/src/extensions/queue/queue.module.ts:6](../../apps/api/src/extensions/queue/queue.module.ts#L6) |
| WorkspaceInstallationModule | — | —; register() — состав см. в коде | [apps/api/src/workspace/workspace.module.ts:86](../../apps/api/src/workspace/workspace.module.ts#L86) |
| FakeIdpModule | IdpHealthController, FakeOidcController | — | [apps/fake-idp/src/main.ts:20](../../apps/fake-idp/src/main.ts#L20) |
| MockHubAppModule | — | — | [apps/mock-hub/src/app.module.ts:21](../../apps/mock-hub/src/app.module.ts#L21) |
| ConfiguredMockHubModule | MockHealthController, MockHubController, OperationalController, PilotCapabilitiesController | JiraModule.configured(source), MattermostModule.configured(source), GitLabModule.configured(source) | [apps/mock-hub/src/app.module.ts:24](../../apps/mock-hub/src/app.module.ts#L24) |
| GitLabModule | — | — | [apps/mock-hub/src/gitlab/gitlab.module.ts:57](../../apps/mock-hub/src/gitlab/gitlab.module.ts#L57) |
| JiraModule | — | — | [apps/mock-hub/src/jira/jira.module.ts:8](../../apps/mock-hub/src/jira/jira.module.ts#L8) |
| MattermostModule | — | — | [apps/mock-hub/src/mattermost/mattermost.module.ts:19](../../apps/mock-hub/src/mattermost/mattermost.module.ts#L19) |
| OperationalModule | OperationalController | — | [apps/mock-hub/src/operational/operational.module.ts:5](../../apps/mock-hub/src/operational/operational.module.ts#L5) |
| LocalWorkerAppModule | LocalWorkerHealthController | — | [apps/worker/src/app.module.ts:339](../../apps/worker/src/app.module.ts#L339) |
| QaLocalWorkerAppModule | LocalWorkerHealthController | — | [apps/worker/src/app.module.ts:357](../../apps/worker/src/app.module.ts#L357) |
| QaJiraLocalWorkerAppModule | LocalWorkerHealthController | — | [apps/worker/src/app.module.ts:383](../../apps/worker/src/app.module.ts#L383) |
| QaJiraGitLabLocalWorkerAppModule | — | QaJiraLocalWorkerAppModule | [apps/worker/src/app.module.ts:506](../../apps/worker/src/app.module.ts#L506) |
| QaJiraMattermostLocalWorkerAppModule | LocalWorkerHealthController | — | [apps/worker/src/app.module.ts:509](../../apps/worker/src/app.module.ts#L509) |
| QaJiraGitLabMattermostLocalWorkerAppModule | — | QaJiraMattermostLocalWorkerAppModule | [apps/worker/src/app.module.ts:646](../../apps/worker/src/app.module.ts#L646) |
| CoreWorkerAppModule | HealthController | — | [apps/worker/src/app.module.ts:649](../../apps/worker/src/app.module.ts#L649) |
| PilotNonLocalWorkerAppModule | — | —; register() — состав см. в коде | [apps/worker/src/app.module.ts:654](../../apps/worker/src/app.module.ts#L654) |
| CorporateAuthenticationModule | — | — | [packages/platform-runtime-nest/src/auth/corporate-session.controller.ts:102](../../packages/platform-runtime-nest/src/auth/corporate-session.controller.ts#L102) |
| InstrumentedRuntimeModule | — | — | [packages/platform-runtime-nest/src/observability/runtime-module.ts:23](../../packages/platform-runtime-nest/src/observability/runtime-module.ts#L23) |

## Таблицы EntitySchema

Найдено 242 деклараций. Ownership — пакет с декларацией; один PostgreSQL, логические владельцы и префиксы таблиц.

### @awp/mock-hub

| Таблица | Entity | Источник |
|---|---|---|
| `mattermost_mock_callbacks` | MattermostMockCallback | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:71](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L71) |
| `mattermost_mock_channels` | MattermostMockChannel | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:13](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L13) |
| `mattermost_mock_effect_calls` | MattermostMockEffectCall | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:84](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L84) |
| `mattermost_mock_faults` | MattermostMockFault | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:61](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L61) |
| `mattermost_mock_memberships` | MattermostMockMembership | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:36](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L36) |
| `mattermost_mock_teams` | MattermostMockTeam | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:3](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L3) |
| `mattermost_mock_users` | MattermostMockUser | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:25](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L25) |
| `mock_calls` | MockCall | [apps/mock-hub/src/persistence/entities.ts:7](../../apps/mock-hub/src/persistence/entities.ts#L7) |
| `mock_effects` | MockEffect | [apps/mock-hub/src/persistence/entities.ts:17](../../apps/mock-hub/src/persistence/entities.ts#L17) |
| `mock_events` | MockEvent | [apps/mock-hub/src/persistence/entities.ts:29](../../apps/mock-hub/src/persistence/entities.ts#L29) |
| `mock_gitlab_artifacts` | GitLabMockArtifact | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:103](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L103) |
| `mock_gitlab_call_audit` | GitLabMockCallAudit | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:151](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L151) |
| `mock_gitlab_commits` | GitLabMockCommit | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:28](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L28) |
| `mock_gitlab_faults` | GitLabMockFault | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:139](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L139) |
| `mock_gitlab_jobs` | GitLabMockJob | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:71](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L71) |
| `mock_gitlab_machine_results` | GitLabMockMachineResult | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:88](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L88) |
| `mock_gitlab_merge_requests` | GitLabMockMergeRequest | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:38](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L38) |
| `mock_gitlab_pipelines` | GitLabMockPipeline | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:53](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L53) |
| `mock_gitlab_projects` | GitLabMockProject | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:8](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L8) |
| `mock_gitlab_webhook_deliveries` | GitLabMockWebhookDelivery | [apps/mock-hub/src/gitlab/state/gitlab.entities.ts:121](../../apps/mock-hub/src/gitlab/state/gitlab.entities.ts#L121) |
| `mock_mattermost_posts` | MattermostMockPost | [apps/mock-hub/src/mattermost/state/mattermost.entities.ts:47](../../apps/mock-hub/src/mattermost/state/mattermost.entities.ts#L47) |
| `mock_scenario` | MockScenario | [apps/mock-hub/src/persistence/entities.ts:40](../../apps/mock-hub/src/persistence/entities.ts#L40) |
| `mock_seed_state` | MockSeed | [apps/mock-hub/src/persistence/entities.ts:49](../../apps/mock-hub/src/persistence/entities.ts#L49) |
| `operational_completion_effects` | OperationalCompletionEffect | [apps/mock-hub/src/operational/operational.entities.ts:86](../../apps/mock-hub/src/operational/operational.entities.ts#L86) |
| `operational_defect_effects` | OperationalDefectEffect | [apps/mock-hub/src/operational/operational.entities.ts:70](../../apps/mock-hub/src/operational/operational.entities.ts#L70) |
| `operational_defects` | OperationalDefect | [apps/mock-hub/src/operational/operational.entities.ts:48](../../apps/mock-hub/src/operational/operational.entities.ts#L48) |
| `operational_request_effects` | OperationalRequestEffect | [apps/mock-hub/src/operational/operational.entities.ts:32](../../apps/mock-hub/src/operational/operational.entities.ts#L32) |
| `operational_requests` | OperationalRequest | [apps/mock-hub/src/operational/operational.entities.ts:3](../../apps/mock-hub/src/operational/operational.entities.ts#L3) |

### @awp/competency-dummy

| Таблица | Entity | Источник |
|---|---|---|
| `dummy_requests` | DummyRequest | [packages/competency-dummy/src/persistence/entities.ts:3](../../packages/competency-dummy/src/persistence/entities.ts#L3) |

### @awp/competency-qa

| Таблица | Entity | Источник |
|---|---|---|
| `qa_account_pool_references` | QaAccountPoolReference | [packages/competency-qa/src/persistence/entities.ts:1674](../../packages/competency-qa/src/persistence/entities.ts#L1674) |
| `qa_attempt_identities` | QaAttemptIdentity | [packages/competency-qa/src/persistence/entities.ts:1167](../../packages/competency-qa/src/persistence/entities.ts#L1167) |
| `qa_automation_artifact_memberships` | QaAutomationArtifactMembership | [packages/competency-qa/src/persistence/entities.ts:1373](../../packages/competency-qa/src/persistence/entities.ts#L1373) |
| `qa_automation_attempt_results` | QaAutomationAttemptResult | [packages/competency-qa/src/persistence/entities.ts:1304](../../packages/competency-qa/src/persistence/entities.ts#L1304) |
| `qa_automation_attempt_status_revisions` | QaAutomationAttemptStatusRevision | [packages/competency-qa/src/persistence/entities.ts:1275](../../packages/competency-qa/src/persistence/entities.ts#L1275) |
| `qa_automation_attempts` | QaAutomationAttempt | [packages/competency-qa/src/persistence/entities.ts:1226](../../packages/competency-qa/src/persistence/entities.ts#L1226) |
| `qa_automation_launch_requests` | QaAutomationLaunchRequest | [packages/competency-qa/src/persistence/entities.ts:1191](../../packages/competency-qa/src/persistence/entities.ts#L1191) |
| `qa_automation_quarantine_revisions` | QaAutomationQuarantineRevision | [packages/competency-qa/src/persistence/entities.ts:1433](../../packages/competency-qa/src/persistence/entities.ts#L1433) |
| `qa_automation_quarantines` | QaAutomationQuarantine | [packages/competency-qa/src/persistence/entities.ts:1410](../../packages/competency-qa/src/persistence/entities.ts#L1410) |
| `qa_automation_retry_decisions` | QaAutomationRetryDecision | [packages/competency-qa/src/persistence/entities.ts:1346](../../packages/competency-qa/src/persistence/entities.ts#L1346) |
| `qa_automation_review_freezes` | QaAutomationReviewFreeze | [packages/competency-qa/src/persistence/entities.ts:1467](../../packages/competency-qa/src/persistence/entities.ts#L1467) |
| `qa_automation_session_configuration_pins` | QaAutomationSessionConfigurationPin | [packages/competency-qa/src/persistence/entities.ts:1133](../../packages/competency-qa/src/persistence/entities.ts#L1133) |
| `qa_automation_suite_binding_versions` | QaAutomationSuiteBindingVersion | [packages/competency-qa/src/persistence/entities.ts:1062](../../packages/competency-qa/src/persistence/entities.ts#L1062) |
| `qa_automation_suite_bindings` | QaAutomationSuiteBinding | [packages/competency-qa/src/persistence/entities.ts:1042](../../packages/competency-qa/src/persistence/entities.ts#L1042) |
| `qa_automation_suite_validation_reports` | QaAutomationSuiteValidationReport | [packages/competency-qa/src/persistence/entities.ts:1107](../../packages/competency-qa/src/persistence/entities.ts#L1107) |
| `qa_completion_candidates` | QaCompletionCandidate | [packages/competency-qa/src/persistence/entities.ts:908](../../packages/competency-qa/src/persistence/entities.ts#L908) |
| `qa_defect_draft_proposals` | QaDefectProposal | [packages/competency-qa/src/persistence/entities.ts:1912](../../packages/competency-qa/src/persistence/entities.ts#L1912) |
| `qa_defect_drafts` | QaDefectDraft | [packages/competency-qa/src/persistence/entities.ts:762](../../packages/competency-qa/src/persistence/entities.ts#L762) |
| `qa_defect_links` | QaDefectLink | [packages/competency-qa/src/persistence/entities.ts:802](../../packages/competency-qa/src/persistence/entities.ts#L802) |
| `qa_dod_assessments` | QaDodAssessment | [packages/competency-qa/src/persistence/entities.ts:886](../../packages/competency-qa/src/persistence/entities.ts#L886) |
| `qa_evidence_artifact_links` | QaEvidenceArtifactLink | [packages/competency-qa/src/persistence/entities.ts:522](../../packages/competency-qa/src/persistence/entities.ts#L522) |
| `qa_evidence_manifest_artifact_memberships` | QaEvidenceManifestArtifactMembership | [packages/competency-qa/src/persistence/entities.ts:610](../../packages/competency-qa/src/persistence/entities.ts#L610) |
| `qa_evidence_manifest_artifact_memberships_v2` | QaEvidenceManifestArtifactMembershipV2 | [packages/competency-qa/src/persistence/entities.ts:1815](../../packages/competency-qa/src/persistence/entities.ts#L1815) |
| `qa_evidence_manifest_headers_v2` | QaEvidenceManifestHeaderV2 | [packages/competency-qa/src/persistence/entities.ts:1767](../../packages/competency-qa/src/persistence/entities.ts#L1767) |
| `qa_evidence_manifest_revisions` | QaEvidenceManifestRevision | [packages/competency-qa/src/persistence/entities.ts:587](../../packages/competency-qa/src/persistence/entities.ts#L587) |
| `qa_evidence_manifest_revisions_v2` | QaEvidenceManifestRevisionV2 | [packages/competency-qa/src/persistence/entities.ts:1785](../../packages/competency-qa/src/persistence/entities.ts#L1785) |
| `qa_evidence_manifests` | QaEvidenceManifest | [packages/competency-qa/src/persistence/entities.ts:566](../../packages/competency-qa/src/persistence/entities.ts#L566) |
| `qa_evidence_packages` | QaEvidencePackage | [packages/competency-qa/src/persistence/entities.ts:1858](../../packages/competency-qa/src/persistence/entities.ts#L1858) |
| `qa_evidence_signature_envelopes` | QaEvidenceSignatureEnvelope | [packages/competency-qa/src/persistence/entities.ts:1831](../../packages/competency-qa/src/persistence/entities.ts#L1831) |
| `qa_evidence_uploads` | QaEvidenceUpload | [packages/competency-qa/src/persistence/entities.ts:1880](../../packages/competency-qa/src/persistence/entities.ts#L1880) |
| `qa_final_close_confirmations` | QaFinalCloseConfirmation | [packages/competency-qa/src/persistence/entities.ts:952](../../packages/competency-qa/src/persistence/entities.ts#L952) |
| `qa_finding_observations` | QaFindingObservation | [packages/competency-qa/src/persistence/entities.ts:686](../../packages/competency-qa/src/persistence/entities.ts#L686) |
| `qa_finding_review_revisions` | QaFindingReviewRevision | [packages/competency-qa/src/persistence/entities.ts:706](../../packages/competency-qa/src/persistence/entities.ts#L706) |
| `qa_findings` | QaFinding | [packages/competency-qa/src/persistence/entities.ts:660](../../packages/competency-qa/src/persistence/entities.ts#L660) |
| `qa_manual_attempts` | QaManualAttempt | [packages/competency-qa/src/persistence/entities.ts:386](../../packages/competency-qa/src/persistence/entities.ts#L386) |
| `qa_observations` | QaObservation | [packages/competency-qa/src/persistence/entities.ts:410](../../packages/competency-qa/src/persistence/entities.ts#L410) |
| `qa_plan_item_result_attempt_memberships` | QaPlanItemResultAttemptMembership | [packages/competency-qa/src/persistence/entities.ts:489](../../packages/competency-qa/src/persistence/entities.ts#L489) |
| `qa_plan_item_result_evidence_memberships` | QaPlanItemResultEvidenceMembership | [packages/competency-qa/src/persistence/entities.ts:550](../../packages/competency-qa/src/persistence/entities.ts#L550) |
| `qa_plan_item_result_flaky_observation_memberships` | QaPlanItemResultFlakyObservationMembership | [packages/competency-qa/src/persistence/entities.ts:744](../../packages/competency-qa/src/persistence/entities.ts#L744) |
| `qa_plan_item_result_observation_memberships` | QaPlanItemResultObservationMembership | [packages/competency-qa/src/persistence/entities.ts:505](../../packages/competency-qa/src/persistence/entities.ts#L505) |
| `qa_plan_item_result_revisions` | QaPlanItemResultRevision | [packages/competency-qa/src/persistence/entities.ts:437](../../packages/competency-qa/src/persistence/entities.ts#L437) |
| `qa_plan_items` | QaPlanItem | [packages/competency-qa/src/persistence/entities.ts:357](../../packages/competency-qa/src/persistence/entities.ts#L357) |
| `qa_post_close_correction_markers` | QaPostCloseCorrectionMarker | [packages/competency-qa/src/persistence/entities.ts:977](../../packages/competency-qa/src/persistence/entities.ts#L977) |
| `qa_project_context_headers_v2` | QaProjectContextHeaderV2 | [packages/competency-qa/src/persistence/entities.ts:1564](../../packages/competency-qa/src/persistence/entities.ts#L1564) |
| `qa_project_context_revisions_v2` | QaProjectContextRevisionV2 | [packages/competency-qa/src/persistence/entities.ts:1580](../../packages/competency-qa/src/persistence/entities.ts#L1580) |
| `qa_project_context_versions` | QaProjectContextVersion | [packages/competency-qa/src/persistence/entities.ts:32](../../packages/competency-qa/src/persistence/entities.ts#L32) |
| `qa_project_contexts` | QaProjectContext | [packages/competency-qa/src/persistence/entities.ts:10](../../packages/competency-qa/src/persistence/entities.ts#L10) |
| `qa_project_environment_headers` | QaProjectEnvironmentHeader | [packages/competency-qa/src/persistence/entities.ts:1605](../../packages/competency-qa/src/persistence/entities.ts#L1605) |
| `qa_project_environment_revisions` | QaProjectEnvironmentRevision | [packages/competency-qa/src/persistence/entities.ts:1622](../../packages/competency-qa/src/persistence/entities.ts#L1622) |
| `qa_queue_fact_current_indexes` | QaQueueFactCurrentIndex | [packages/competency-qa/src/persistence/entities.ts:1547](../../packages/competency-qa/src/persistence/entities.ts#L1547) |
| `qa_queue_fact_heads` | QaQueueFactHead | [packages/competency-qa/src/persistence/entities.ts:1508](../../packages/competency-qa/src/persistence/entities.ts#L1508) |
| `qa_queue_fact_revisions` | QaQueueFactRevision | [packages/competency-qa/src/persistence/entities.ts:1525](../../packages/competency-qa/src/persistence/entities.ts#L1525) |
| `qa_readiness_assessments` | QaReadinessAssessment | [packages/competency-qa/src/persistence/entities.ts:175](../../packages/competency-qa/src/persistence/entities.ts#L175) |
| `qa_request_extensions` | QaRequestExtension | [packages/competency-qa/src/persistence/entities.ts:90](../../packages/competency-qa/src/persistence/entities.ts#L90) |
| `qa_request_input_revisions` | QaRequestInputRevision | [packages/competency-qa/src/persistence/entities.ts:140](../../packages/competency-qa/src/persistence/entities.ts#L140) |
| `qa_required_session_plan_requirements` | QaRequiredSessionPlanRequirement | [packages/competency-qa/src/persistence/entities.ts:250](../../packages/competency-qa/src/persistence/entities.ts#L250) |
| `qa_required_session_plan_versions` | QaRequiredSessionPlanVersion | [packages/competency-qa/src/persistence/entities.ts:231](../../packages/competency-qa/src/persistence/entities.ts#L231) |
| `qa_required_session_plans` | QaRequiredSessionPlan | [packages/competency-qa/src/persistence/entities.ts:213](../../packages/competency-qa/src/persistence/entities.ts#L213) |
| `qa_risk_review_policies` | QaRiskReviewPolicy | [packages/competency-qa/src/persistence/entities.ts:50](../../packages/competency-qa/src/persistence/entities.ts#L50) |
| `qa_risk_review_policy_versions` | QaRiskReviewPolicyVersion | [packages/competency-qa/src/persistence/entities.ts:72](../../packages/competency-qa/src/persistence/entities.ts#L72) |
| `qa_session_plan_proposals` | QaSessionPlanProposal | [packages/competency-qa/src/persistence/entities.ts:1018](../../packages/competency-qa/src/persistence/entities.ts#L1018) |
| `qa_session_reviews` | QaSessionReview | [packages/competency-qa/src/persistence/entities.ts:630](../../packages/competency-qa/src/persistence/entities.ts#L630) |
| `qa_target_snapshots_v2` | QaTargetSnapshotV2 | [packages/competency-qa/src/persistence/entities.ts:1747](../../packages/competency-qa/src/persistence/entities.ts#L1747) |
| `qa_test_account_lease_heads` | QaTestAccountLeaseHead | [packages/competency-qa/src/persistence/entities.ts:1722](../../packages/competency-qa/src/persistence/entities.ts#L1722) |
| `qa_test_account_leases` | QaTestAccountLease | [packages/competency-qa/src/persistence/entities.ts:1694](../../packages/competency-qa/src/persistence/entities.ts#L1694) |
| `qa_test_data_catalog_entries` | QaTestDataCatalogEntry | [packages/competency-qa/src/persistence/entities.ts:1654](../../packages/competency-qa/src/persistence/entities.ts#L1654) |
| `qa_test_sessions` | QaTestSession | [packages/competency-qa/src/persistence/entities.ts:281](../../packages/competency-qa/src/persistence/entities.ts#L281) |
| `qa_triage_assessments` | QaTriageAssessment | [packages/competency-qa/src/persistence/entities.ts:997](../../packages/competency-qa/src/persistence/entities.ts#L997) |
| `qa_verdict_signatures` | QaVerdictSignature | [packages/competency-qa/src/persistence/entities.ts:867](../../packages/competency-qa/src/persistence/entities.ts#L867) |
| `qa_verdicts` | QaVerdict | [packages/competency-qa/src/persistence/entities.ts:835](../../packages/competency-qa/src/persistence/entities.ts#L835) |
| `qa_waivers` | QaWaiver | [packages/competency-qa/src/persistence/entities.ts:195](../../packages/competency-qa/src/persistence/entities.ts#L195) |

### @awp/connector-gitlab-persistence-typeorm

| Таблица | Entity | Источник |
|---|---|---|
| `gitlab_artifact_locator_revisions` | GitLabArtifactLocatorRevision | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:277](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L277) |
| `gitlab_artifact_stream_receipts` | GitLabArtifactStreamReceipt | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:306](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L306) |
| `gitlab_discovery_snapshots` | GitLabDiscoverySnapshot | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:9](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L9) |
| `gitlab_effect_lookup_observations` | GitLabEffectLookupObservation | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:256](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L256) |
| `gitlab_effect_reconciliations` | GitLabEffectReconciliation | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:216](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L216) |
| `gitlab_pipeline_observations` | GitLabPipelineObservation | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:127](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L127) |
| `gitlab_pipeline_projection_heads` | GitLabPipelineProjectionHead | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:153](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L153) |
| `gitlab_profile_validation_details` | GitLabProfileValidationDetail | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:44](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L44) |
| `gitlab_rate_limit_snapshots` | GitLabRateLimitSnapshot | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:194](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L194) |
| `gitlab_reconciliation_cursors` | GitLabReconciliationCursor | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:170](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L170) |
| `gitlab_suite_contract_probes` | GitLabSuiteContractProbe | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:74](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L74) |
| `gitlab_webhook_receipts` | GitLabWebhookReceipt | [packages/connector-gitlab-persistence-typeorm/src/entities.ts:99](../../packages/connector-gitlab-persistence-typeorm/src/entities.ts#L99) |

### @awp/connector-jira-persistence-typeorm

| Таблица | Entity | Источник |
|---|---|---|
| `jira_ambiguity_resolutions` | JiraAmbiguityResolution | [packages/connector-jira-persistence-typeorm/src/entities.ts:124](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L124) |
| `jira_discovery_snapshots` | JiraDiscoverySnapshot | [packages/connector-jira-persistence-typeorm/src/entities.ts:3](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L3) |
| `jira_effect_reconciliations` | JiraEffectReconciliation | [packages/connector-jira-persistence-typeorm/src/entities.ts:77](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L77) |
| `jira_effect_sub_effects` | JiraEffectSubEffect | [packages/connector-jira-persistence-typeorm/src/entities.ts:106](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L106) |
| `jira_profile_validation_details` | JiraProfileValidationDetail | [packages/connector-jira-persistence-typeorm/src/entities.ts:23](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L23) |
| `jira_rate_limit_snapshots` | JiraRateLimitSnapshot | [packages/connector-jira-persistence-typeorm/src/entities.ts:61](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L61) |
| `jira_webhook_normalizations` | JiraWebhookNormalization | [packages/connector-jira-persistence-typeorm/src/entities.ts:39](../../packages/connector-jira-persistence-typeorm/src/entities.ts#L39) |

### @awp/platform-persistence-typeorm

| Таблица | Entity | Источник |
|---|---|---|
| `action_provenance_records` | ActionProvenance | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:7](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L7) |
| `agent_run_grants` | AgentRunGrant | [packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts:19](../../packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts#L19) |
| `agent_run_steps` | AgentRunStep | [packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts:25](../../packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts#L25) |
| `agent_runs` | AgentRun | [packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts:7](../../packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts#L7) |
| `agent_tool_invocations` | AgentToolInvocation | [packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts:31](../../packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts#L31) |
| `approvals` | Approval | [packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts#L3) |
| `artifact_availability_heads` | ArtifactAvailabilityHead | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:61](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L61) |
| `artifact_availability_revisions` | ArtifactAvailabilityRevision | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:74](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L74) |
| `artifact_references` | ArtifactReference | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:36](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L36) |
| `artifact_retention_decisions` | ArtifactRetentionDecision | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:113](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L113) |
| `audit_events` | AuditEvent | [packages/platform-persistence-typeorm/src/entities/audit.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/audit.entities.ts#L3) |
| `authorized_scope_queue_policy_facet_heads` | AuthorizedScopeQueuePolicyFacetHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:171](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L171) |
| `authorized_scope_queue_policy_facet_projects` | AuthorizedScopeQueuePolicyFacetProject | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:198](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L198) |
| `authorized_scope_queue_policy_facet_revisions` | AuthorizedScopeQueuePolicyFacetRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:184](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L184) |
| `binding_functional_acceptances` | BindingFunctionalAcceptance | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:107](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L107) |
| `capability_contracts` | CapabilityContract | [packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts:83](../../packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts#L83) |
| `capability_mode_assessments` | CapabilityModeAssessment | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:160](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L160) |
| `capability_probe_results` | CapabilityProbeResult | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:129](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L129) |
| `capacity_admission_decisions` | CapacityAdmissionDecision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:598](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L598) |
| `capacity_scope_projection_heads` | CapacityScopeProjectionHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:521](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L521) |
| `capacity_scope_projection_projects` | CapacityScopeProjectionProject | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:550](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L550) |
| `capacity_scope_projection_revisions` | CapacityScopeProjectionRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:535](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L535) |
| `classification_catalog` | Classification | [packages/platform-persistence-typeorm/src/entities/platform-primitives.entities.ts:12](../../packages/platform-persistence-typeorm/src/entities/platform-primitives.entities.ts#L12) |
| `client_request_idempotency` | ClientRequestIdempotency | [packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts:44](../../packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts#L44) |
| `command_outbox` | CommandOutbox | [packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts:28](../../packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts#L28) |
| `competency_pack_registrations` | PackRegistration | [packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts#L3) |
| `connection_headers` | ConnectionHeader | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:21](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L21) |
| `connection_health` | ConnectionHealth | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:95](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L95) |
| `connection_revisions` | ConnectionRevision | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:27](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L27) |
| `connector_command_configuration_pins` | ConnectorCommandConfigurationPin | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:96](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L96) |
| `connector_commands` | ConnectorCommand | [packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts#L3) |
| `connector_mapping_headers` | MappingHeader | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:33](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L33) |
| `connector_mapping_revisions` | MappingRevision | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:39](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L39) |
| `connector_profile_headers` | ProfileHeader | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:45](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L45) |
| `connector_profile_revisions` | ProfileRevision | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:51](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L51) |
| `connector_registrations` | ConnectorRegistration | [packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts:69](../../packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts#L69) |
| `connector_target_execution_lanes` | ConnectorTargetExecutionLane | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:115](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L115) |
| `consumer_inbox` | ConsumerInbox | [packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts:58](../../packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts#L58) |
| `corporate_identity_revocations` | CorporateIdentityRevocation | [packages/platform-persistence-typeorm/src/entities/corporate-session.entities.ts:14](../../packages/platform-persistence-typeorm/src/entities/corporate-session.entities.ts#L14) |
| `corporate_session_states` | CorporateSessionState | [packages/platform-persistence-typeorm/src/entities/corporate-session.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/corporate-session.entities.ts#L3) |
| `event_outbox` | EventOutbox | [packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts:68](../../packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts#L68) |
| `evidence_export_records` | EvidenceExportRecord | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:135](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L135) |
| `extension_registration_attempts` | ExtensionRegistrationAttempt | [packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts:19](../../packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts#L19) |
| `external_interaction_receipts` | ExternalInteractionReceipt | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:79](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L79) |
| `external_principal_bindings` | ExternalPrincipalBinding | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:133](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L133) |
| `identities` | Identity | [packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts:7](../../packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts#L7) |
| `intake_candidate_decisions` | IntakeCandidateDecision | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:43](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L43) |
| `intake_candidate_source_observations` | IntakeCandidateObservation | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:30](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L30) |
| `intake_candidates` | IntakeCandidate | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:18](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L18) |
| `intake_draft_confirmations` | IntakeDraftConfirmation | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:65](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L65) |
| `intake_draft_revisions` | IntakeDraftRevision | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:55](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L55) |
| `intake_drafts` | IntakeDraft | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L3) |
| `integration_validation_reports` | ValidationReport | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:79](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L79) |
| `interaction_intents` | InteractionIntent | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:94](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L94) |
| `interaction_presentation_secrets` | InteractionPresentationSecret | [packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts:108](../../packages/platform-persistence-typeorm/src/entities/intake-interaction.entities.ts#L108) |
| `notification_delivery_attempts` | NotificationDeliveryAttempt | [packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts:56](../../packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts#L56) |
| `notification_intents` | NotificationIntent | [packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts:40](../../packages/platform-persistence-typeorm/src/entities/agent-notification.entities.ts#L40) |
| `operational_bindings` | OperationalBinding | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:8](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L8) |
| `operational_import_intents` | OperationalImportIntent | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:157](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L157) |
| `operational_projection_revisions` | OperationalProjectionRevision | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:49](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L49) |
| `operational_sync_conflicts` | OperationalSyncConflict | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:74](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L74) |
| `pilot_record_headers` | PilotRecordHeader | [packages/platform-persistence-typeorm/src/entities/pilot.entities.ts:21](../../packages/platform-persistence-typeorm/src/entities/pilot.entities.ts#L21) |
| `pilot_record_revisions` | PilotRecordRevision | [packages/platform-persistence-typeorm/src/entities/pilot.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/pilot.entities.ts#L3) |
| `pilot_runtime_registrations` | PilotRuntimeRegistration | [packages/platform-persistence-typeorm/src/entities/runtime-registration.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/runtime-registration.entities.ts#L3) |
| `platform_actions` | PlatformAction | [packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts:27](../../packages/platform-persistence-typeorm/src/entities/approvals-idempotency.entities.ts#L27) |
| `platform_schema_versions` | SchemaVersion | [packages/platform-persistence-typeorm/src/entities/platform-primitives.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/platform-primitives.entities.ts#L3) |
| `project_entitlement_headers` | ProjectEntitlementHeader | [packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts:47](../../packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts#L47) |
| `project_entitlement_permissions` | ProjectEntitlementPermission | [packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts:39](../../packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts#L39) |
| `project_entitlement_revisions` | ProjectEntitlementRevision | [packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts:66](../../packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts#L66) |
| `project_entitlements` | ProjectEntitlement | [packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts:20](../../packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts#L20) |
| `project_incident_dispositions` | ProjectIncidentDisposition | [packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts:128](../../packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts#L128) |
| `project_integration_binding_headers` | BindingHeader | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:57](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L57) |
| `project_integration_binding_revisions` | BindingRevision | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:63](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L63) |
| `project_onboarding_gate_results` | ProjectOnboardingGateResult | [packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts:89](../../packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts#L89) |
| `project_onboarding_headers` | ProjectOnboardingHeader | [packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts:35](../../packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts#L35) |
| `project_onboarding_revisions` | ProjectOnboardingRevision | [packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts:57](../../packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts#L57) |
| `project_operational_action_candidates` | ProjectOperationalActionCandidate | [packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts:183](../../packages/platform-persistence-typeorm/src/entities/integration-configuration.entities.ts#L183) |
| `project_queue_policy_facet_heads` | ProjectQueuePolicyFacetHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:144](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L144) |
| `project_queue_policy_facet_revisions` | ProjectQueuePolicyFacetRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:157](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L157) |
| `project_registry_revisions` | ProjectRegistryRevision | [packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts:6](../../packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts#L6) |
| `projects` | Project | [packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts:3](../../packages/platform-persistence-typeorm/src/entities/projects-entitlements.entities.ts#L3) |
| `queue_action_candidates` | QueueActionCandidate | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:475](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L475) |
| `queue_entry_heads` | QueueEntryHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:223](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L223) |
| `queue_entry_revisions` | QueueEntryRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:240](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L240) |
| `queue_order_invalidation_heads` | QueueOrderInvalidationHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:449](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L449) |
| `queue_order_invalidation_revisions` | QueueOrderInvalidationRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:461](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L461) |
| `queue_order_overrides` | QueueOrderOverride | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:434](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L434) |
| `queue_order_scope_heads` | QueueOrderScopeHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:410](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L410) |
| `queue_order_scope_projects` | QueueOrderScopeProject | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:424](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L424) |
| `queue_projection_generations` | QueueProjectionGeneration | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:209](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L209) |
| `reconciliation_cursors` | ReconciliationCursor | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:200](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L200) |
| `reconciliation_runs` | ReconciliationRun | [packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts:223](../../packages/platform-persistence-typeorm/src/entities/operational-authority.entities.ts#L223) |
| `review_capacity_reservations` | ReviewCapacityReservation | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:579](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L579) |
| `role_assignments` | RoleAssignment | [packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts:45](../../packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts#L45) |
| `runtime_configuration_events` | RuntimeConfigurationEvent | [packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts:44](../../packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts#L44) |
| `runtime_configuration_headers` | RuntimeConfigurationHeader | [packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts:32](../../packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts#L32) |
| `runtime_configuration_projects` | RuntimeConfigurationProject | [packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts:23](../../packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts#L23) |
| `runtime_configuration_revisions` | RuntimeConfigurationRevision | [packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts:8](../../packages/platform-persistence-typeorm/src/entities/runtime-configuration.entities.ts#L8) |
| `sla_clock_heads` | SlaClockHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:256](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L256) |
| `sla_clock_revisions` | SlaClockRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:275](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L275) |
| `sla_clock_segment_heads` | SlaClockSegmentHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:293](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L293) |
| `sla_clock_segments` | SlaClockSegment | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:312](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L312) |
| `sla_rollout_verification_receipts` | SlaRolloutVerificationReceipt | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:360](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L360) |
| `sla_threshold_emissions` | SlaThresholdEmission | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:330](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L330) |
| `webhook_receipts` | WebhookReceipt | [packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts:48](../../packages/platform-persistence-typeorm/src/entities/connector-delivery.entities.ts#L48) |
| `work_item_human_wip_claims` | WorkItemHumanWipClaim | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:560](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L560) |
| `work_item_queue_control_heads` | WorkItemQueueControlHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:383](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L383) |
| `work_item_queue_control_revisions` | WorkItemQueueControlRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:395](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L395) |
| `work_items` | WorkItem | [packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts:20](../../packages/platform-persistence-typeorm/src/entities/work-and-artifacts.entities.ts#L20) |
| `work_type_definitions` | WorkTypeDefinition | [packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts:35](../../packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts#L35) |
| `workspace_business_calendar_heads` | WorkspaceBusinessCalendarHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:38](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L38) |
| `workspace_business_calendar_revisions` | WorkspaceBusinessCalendarRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:52](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L52) |
| `workspace_capacity_heads` | WorkspaceCapacityHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:491](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L491) |
| `workspace_capacity_reconciliation_checkpoints` | WorkspaceCapacityReconciliationCheckpoint | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:504](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L504) |
| `workspace_memberships` | WorkspaceMembership | [packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts:31](../../packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts#L31) |
| `workspace_project_rollout_leases` | WorkspaceProjectRolloutLease | [packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts:113](../../packages/platform-persistence-typeorm/src/entities/project-onboarding.entities.ts#L113) |
| `workspace_queue_configuration_requests` | WorkspaceQueueConfigurationRequest | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:98](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L98) |
| `workspace_queue_policy_heads` | WorkspaceQueuePolicyHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:69](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L69) |
| `workspace_queue_policy_revisions` | WorkspaceQueuePolicyRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:83](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L83) |
| `workspace_queue_policy_view_heads` | WorkspaceQueuePolicyViewHead | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:117](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L117) |
| `workspace_queue_policy_view_revisions` | WorkspaceQueuePolicyViewRevision | [packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts:130](../../packages/platform-persistence-typeorm/src/entities/queue-management.entities.ts#L130) |
| `workspace_work_types` | WorkspaceWorkType | [packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts:53](../../packages/platform-persistence-typeorm/src/entities/extension-registry.entities.ts#L53) |
| `workspaces` | Workspace | [packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts:20](../../packages/platform-persistence-typeorm/src/entities/identity-workspace.entities.ts#L20) |

## Объявленные HTTP-маршруты

Это каталог исходного кода. Локальные fixtures, reusable controllers и корпоративные routes указаны вместе, но не являются одним подключённым API. Рабочие поверхности показаны в основной схеме.

### CorporateAccessController

@awp/api · [apps/api/src/access/corporate-access.controller.ts:11](../../apps/api/src/access/corporate-access.controller.ts#L11)

| Метод | Путь | Handler |
|---|---|---|

### LocalAccessController

@awp/api · [apps/api/src/access/local-access.controller.ts:11](../../apps/api/src/access/local-access.controller.ts#L11) · class guard: `LocalSessionGuard`

| Метод | Путь | Handler |
|---|---|---|

### DummyPackController

@awp/api · [apps/api/src/extensions/dummy-pack.controller.ts:7](../../apps/api/src/extensions/dummy-pack.controller.ts#L7)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/dummy-pack.controller.ts` | `getSampleWorkItemExtension` |
| POST | `apps/api/src/extensions/dummy-pack.controller.ts` | `publishSampleRecord` |

### GitLabWebhookController

@awp/api · [apps/api/src/extensions/gitlab-automation/gitlab-webhook.controller.ts:38](../../apps/api/src/extensions/gitlab-automation/gitlab-webhook.controller.ts#L38)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/gitlab-automation/gitlab-webhook.controller.ts` | `receive` |

### QaAutomatedSessionsController

@awp/api · [apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts:39](../../apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts#L39) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts` | `create` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automated-sessions.controller.ts` | `get` |

### QaAutomationAttemptsController

@awp/api · [apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts:163](../../apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts#L163) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `launchConfirmation` |
| POST | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `launch` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `list` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `detail` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `statusHistory` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `result` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `retryDecision` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-attempts.controller.ts` | `artifacts` |

### QaAutomationAvailabilityController

@awp/api · [apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts:43](../../apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts#L43) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-availability.controller.ts` | `current` |

### QaAutomationQuarantinesController

@awp/api · [apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts:707](../../apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts#L707) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts` | `list` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts` | `get` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts` | `revisions` |
| POST | `apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts` | `activate` |
| POST | `apps/api/src/extensions/gitlab-automation/qa-automation-quarantines.controller.ts` | `lift` |

### QaAutomationSuiteBindingsController

@awp/api · [apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts:74](../../apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts#L74) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts` | `list` |
| POST | `apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts` | `create` |
| POST | `apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts` | `validate` |
| GET | `apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts` | `reports` |
| POST | `apps/api/src/extensions/gitlab-automation/qa-automation-suite-bindings.controller.ts` | `publish` |

### MattermostBootstrapController

@awp/api · [apps/api/src/extensions/mattermost-bootstrap.controller.ts:5](../../apps/api/src/extensions/mattermost-bootstrap.controller.ts#L5)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/mattermost-bootstrap.controller.ts` | `bootstrap` |

### MattermostIngressController

@awp/api · [apps/api/src/extensions/mattermost-ingress.controller.ts:11](../../apps/api/src/extensions/mattermost-ingress.controller.ts#L11)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/mattermost-ingress.controller.ts` | `dialog` |
| POST | `apps/api/src/extensions/mattermost-ingress.controller.ts` | `action` |

### MattermostIntegrationController

@awp/api · [apps/api/src/extensions/mattermost-integration.controller.ts:32](../../apps/api/src/extensions/mattermost-integration.controller.ts#L32)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/mattermost-integration.controller.ts` | `discover` |
| POST | `apps/api/src/extensions/mattermost-integration.controller.ts` | `validate` |
| POST | `apps/api/src/extensions/mattermost-integration.controller.ts` | `preview` |
| POST | `apps/api/src/extensions/mattermost-integration.controller.ts` | `dryRun` |

### MattermostProjectSelectionController

@awp/api · [apps/api/src/extensions/mattermost-project-selection.controller.ts:14](../../apps/api/src/extensions/mattermost-project-selection.controller.ts#L14) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/mattermost-project-selection.controller.ts` | `options` |
| POST | `apps/api/src/extensions/mattermost-project-selection.controller.ts` | `select` |

### EvidenceIntegrityController

@awp/api · [apps/api/src/extensions/onboarding/evidence.controller.ts:82](../../apps/api/src/extensions/onboarding/evidence.controller.ts#L82) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/onboarding/evidence.controller.ts` | `verify` |
| GET | `apps/api/src/extensions/onboarding/evidence.controller.ts` | `package` |
| GET | `apps/api/src/extensions/onboarding/evidence.controller.ts` | `exportOptions` |
| POST | `apps/api/src/extensions/onboarding/evidence.controller.ts` | `correct` |
| POST | `apps/api/src/extensions/onboarding/evidence.controller.ts` | `exportPackage` |
| GET | `apps/api/src/extensions/onboarding/evidence.controller.ts` | `exportResult` |

### OnboardingController

@awp/api · [apps/api/src/extensions/onboarding/onboarding.controller.ts:53](../../apps/api/src/extensions/onboarding/onboarding.controller.ts#L53)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `catalog` |
| GET | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `registrationOptions` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `register` |
| GET | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `projectMetadata` |
| PUT | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `updateProjectMetadata` |
| GET | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `onboarding` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `grantEntitlement` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `replaceEntitlement` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `revokeEntitlement` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `publishQaEnvironment` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `publishQaContext` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `publishQaResource` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `acquireAccountLease` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `releaseAccountLease` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `validateBinding` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `acceptBinding` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `evaluate` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `applyBindingLifecycleAction` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `activatePilot` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `prepareBinding` |
| POST | `apps/api/src/extensions/onboarding/onboarding.controller.ts` | `preparePilot` |

### ProjectDialogueController

@awp/api · [apps/api/src/extensions/onboarding/project-dialogue.controller.ts:35](../../apps/api/src/extensions/onboarding/project-dialogue.controller.ts#L35) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/onboarding/project-dialogue.controller.ts` | `list` |
| POST | `apps/api/src/extensions/onboarding/project-dialogue.controller.ts` | `start` |
| POST | `apps/api/src/extensions/onboarding/project-dialogue.controller.ts` | `message` |
| POST | `apps/api/src/extensions/onboarding/project-dialogue.controller.ts` | `confirm` |

### ProjectOperationsController

@awp/api · [apps/api/src/extensions/onboarding/project-operations.controller.ts:33](../../apps/api/src/extensions/onboarding/project-operations.controller.ts#L33) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/onboarding/project-operations.controller.ts` | `read` |
| POST | `apps/api/src/extensions/onboarding/project-operations.controller.ts` | `suspend` |
| POST | `apps/api/src/extensions/onboarding/project-operations.controller.ts` | `disposition` |
| POST | `apps/api/src/extensions/onboarding/project-operations.controller.ts` | `prepare` |
| POST | `apps/api/src/extensions/onboarding/project-operations.controller.ts` | `approve` |
| POST | `apps/api/src/extensions/onboarding/project-operations.controller.ts` | `resume` |

### ProjectReadsController

@awp/api · [apps/api/src/extensions/onboarding/project-reads.controller.ts:18](../../apps/api/src/extensions/onboarding/project-reads.controller.ts#L18) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/onboarding/project-reads.controller.ts` | `search` |
| GET | `apps/api/src/extensions/onboarding/project-reads.controller.ts` | `events` |
| GET | `apps/api/src/extensions/onboarding/project-reads.controller.ts` | `item` |

### PublishedOnboardingController

@awp/api · [apps/api/src/extensions/onboarding/published.controllers.ts:30](../../apps/api/src/extensions/onboarding/published.controllers.ts#L30)

| Метод | Путь | Handler |
|---|---|---|

### PublishedProjectOperationsController

@awp/api · [apps/api/src/extensions/onboarding/published.controllers.ts:44](../../apps/api/src/extensions/onboarding/published.controllers.ts#L44)

| Метод | Путь | Handler |
|---|---|---|

### PilotController

@awp/api · [apps/api/src/extensions/pilot/pilot.controller.ts:125](../../apps/api/src/extensions/pilot/pilot.controller.ts#L125) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/pilot/pilot.controller.ts` | `health` |
| GET | `apps/api/src/extensions/pilot/pilot.controller.ts` | `readiness` |
| POST | `apps/api/src/extensions/pilot/pilot.controller.ts` | `evidenceImport` |
| GET | `apps/api/src/extensions/pilot/pilot.controller.ts` | `run` |
| GET | `apps/api/src/extensions/pilot/pilot.controller.ts` | `metrics` |
| POST | `apps/api/src/extensions/pilot/pilot.controller.ts` | `measurementProtocol` |
| POST | `apps/api/src/extensions/pilot/pilot.controller.ts` | `baselineImport` |
| POST | `apps/api/src/extensions/pilot/pilot.controller.ts` | `review` |

### PilotDeadLetterController

@awp/api · [apps/api/src/extensions/pilot/pilot.controller.ts:417](../../apps/api/src/extensions/pilot/pilot.controller.ts#L417) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/pilot/pilot.controller.ts` | `deadLetters` |
| GET | `apps/api/src/extensions/pilot/pilot.controller.ts` | `recovery` |
| POST | `apps/api/src/extensions/pilot/pilot.controller.ts` | `captureDiagnostics` |
| POST | `apps/api/src/extensions/pilot/pilot.controller.ts` | `replayDecision` |

### ProviderIngressController

@awp/api · [apps/api/src/extensions/pilot/provider-ingress.module.ts:36](../../apps/api/src/extensions/pilot/provider-ingress.module.ts#L36)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/pilot/provider-ingress.module.ts` | `receive` |

### QaArtifactsController

@awp/api · [apps/api/src/extensions/qa-artifacts.controller.ts:27](../../apps/api/src/extensions/qa-artifacts.controller.ts#L27) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-artifacts.controller.ts` | `metadata` |
| GET | `apps/api/src/extensions/qa-artifacts.controller.ts` | `content` |

### QaDefectsController

@awp/api · [apps/api/src/extensions/qa-defects.controller.ts:62](../../apps/api/src/extensions/qa-defects.controller.ts#L62) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/qa-defects.controller.ts` | `propose` |
| GET | `apps/api/src/extensions/qa-defects.controller.ts` | `proposal` |
| GET | `apps/api/src/extensions/qa-defects.controller.ts` | `drafts` |
| POST | `apps/api/src/extensions/qa-defects.controller.ts` | `create` |
| POST | `apps/api/src/extensions/qa-defects.controller.ts` | `reject` |
| POST | `apps/api/src/extensions/qa-defects.controller.ts` | `publish` |
| GET | `apps/api/src/extensions/qa-defects.controller.ts` | `links` |
| POST | `apps/api/src/extensions/qa-defects.controller.ts` | `approve` |
| GET | `apps/api/src/extensions/qa-defects.controller.ts` | `link` |

### QaEvidenceController

@awp/api · [apps/api/src/extensions/qa-evidence.controller.ts:47](../../apps/api/src/extensions/qa-evidence.controller.ts#L47) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-evidence.controller.ts` | `list` |
| GET | `apps/api/src/extensions/qa-evidence.controller.ts` | `get` |
| GET | `apps/api/src/extensions/qa-evidence.controller.ts` | `manifests` |
| GET | `apps/api/src/extensions/qa-evidence.controller.ts` | `history` |
| GET | `apps/api/src/extensions/qa-evidence.controller.ts` | `revision` |
| POST | `apps/api/src/extensions/qa-evidence.controller.ts` | `postCloseCorrection` |

### QaFindingsController

@awp/api · [apps/api/src/extensions/qa-findings.controller.ts:59](../../apps/api/src/extensions/qa-findings.controller.ts#L59) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-findings.controller.ts` | `list` |
| POST | `apps/api/src/extensions/qa-findings.controller.ts` | `create` |
| GET | `apps/api/src/extensions/qa-findings.controller.ts` | `memberships` |
| POST | `apps/api/src/extensions/qa-findings.controller.ts` | `assign` |
| POST | `apps/api/src/extensions/qa-findings.controller.ts` | `release` |
| PUT | `apps/api/src/extensions/qa-findings.controller.ts` | `classify` |
| PUT | `apps/api/src/extensions/qa-findings.controller.ts` | `dispose` |

### QaHermesProposalsController

@awp/api · [apps/api/src/extensions/qa-hermes-proposals.controller.ts:11](../../apps/api/src/extensions/qa-hermes-proposals.controller.ts#L11) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-hermes-proposals.controller.ts` | `triage` |
| GET | `apps/api/src/extensions/qa-hermes-proposals.controller.ts` | `plans` |

### QaHermesProposalResourcesController

@awp/api · [apps/api/src/extensions/qa-hermes-proposals.controller.ts:44](../../apps/api/src/extensions/qa-hermes-proposals.controller.ts#L44) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-hermes-proposals.controller.ts` | `assessment` |
| GET | `apps/api/src/extensions/qa-hermes-proposals.controller.ts` | `proposal` |

### QaManualExecutionController

@awp/api · [apps/api/src/extensions/qa-manual-execution.controller.ts:124](../../apps/api/src/extensions/qa-manual-execution.controller.ts#L124) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `listAttempts` |
| POST | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `startAttempt` |
| POST | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `completeAttempt` |
| GET | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `listObservations` |
| POST | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `recordObservation` |
| GET | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `listResults` |
| POST | `apps/api/src/extensions/qa-manual-execution.controller.ts` | `recordResult` |

### QaPackController

@awp/api · [apps/api/src/extensions/qa-pack.controller.ts:100](../../apps/api/src/extensions/qa-pack.controller.ts#L100) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/qa-pack.controller.ts` | `createDraft` |
| POST | `apps/api/src/extensions/qa-pack.controller.ts` | `confirmDraft` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `status` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `backlog` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `backlogItem` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `currentInput` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `inputHistory` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `requestExtension` |
| GET | `apps/api/src/extensions/qa-pack.controller.ts` | `detail` |

### QaReadinessController

@awp/api · [apps/api/src/extensions/qa-readiness.controller.ts:54](../../apps/api/src/extensions/qa-readiness.controller.ts#L54) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/qa-readiness.controller.ts` | `revise` |
| POST | `apps/api/src/extensions/qa-readiness.controller.ts` | `assess` |
| GET | `apps/api/src/extensions/qa-readiness.controller.ts` | `history` |
| POST | `apps/api/src/extensions/qa-readiness.controller.ts` | `confirm` |
| POST | `apps/api/src/extensions/qa-readiness.controller.ts` | `requestWaiver` |

### QaRequiredSessionPlansController

@awp/api · [apps/api/src/extensions/qa-required-session-plans.controller.ts:40](../../apps/api/src/extensions/qa-required-session-plans.controller.ts#L40) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-required-session-plans.controller.ts` | `current` |
| GET | `apps/api/src/extensions/qa-required-session-plans.controller.ts` | `history` |
| GET | `apps/api/src/extensions/qa-required-session-plans.controller.ts` | `currentRevision` |
| GET | `apps/api/src/extensions/qa-required-session-plans.controller.ts` | `revision` |
| POST | `apps/api/src/extensions/qa-required-session-plans.controller.ts` | `publish` |

### QaSessionReviewController

@awp/api · [apps/api/src/extensions/qa-session-review.controller.ts:60](../../apps/api/src/extensions/qa-session-review.controller.ts#L60) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/qa-session-review.controller.ts` | `publish` |

### QaSessionsController

@awp/api · [apps/api/src/extensions/qa-sessions.controller.ts:253](../../apps/api/src/extensions/qa-sessions.controller.ts#L253) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-sessions.controller.ts` | `list` |
| POST | `apps/api/src/extensions/qa-sessions.controller.ts` | `create` |
| GET | `apps/api/src/extensions/qa-sessions.controller.ts` | `get` |
| POST | `apps/api/src/extensions/qa-sessions.controller.ts` | `transition` |
| GET | `apps/api/src/extensions/qa-sessions.controller.ts` | `listPlanItems` |
| POST | `apps/api/src/extensions/qa-sessions.controller.ts` | `createPlanItem` |
| GET | `apps/api/src/extensions/qa-sessions.controller.ts` | `getPlanItem` |
| PATCH | `apps/api/src/extensions/qa-sessions.controller.ts` | `updatePlanItem` |

### QaVerdictCompletionController

@awp/api · [apps/api/src/extensions/qa-verdict-completion.controller.ts:63](../../apps/api/src/extensions/qa-verdict-completion.controller.ts#L63) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `detail` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `createVerdict` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `signVerdict` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `requestCosign` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `approveCosign` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `supersedeVerdict` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `assessDod` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `createCandidate` |
| GET | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `candidate` |
| GET | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `finalClose` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `requestCompletion` |
| POST | `apps/api/src/extensions/qa-verdict-completion.controller.ts` | `approveCompletion` |

### QueueControlsController

@awp/api · [apps/api/src/extensions/queue/queue-controls.controller.ts:39](../../apps/api/src/extensions/queue/queue-controls.controller.ts#L39) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/api/src/extensions/queue/queue-controls.controller.ts` | `control` |
| POST | `apps/api/src/extensions/queue/queue-controls.controller.ts` | `projectOrder` |
| POST | `apps/api/src/extensions/queue/queue-controls.controller.ts` | `portfolioOrder` |

### QueuePoliciesController

@awp/api · [apps/api/src/extensions/queue/queue-policies.controller.ts:39](../../apps/api/src/extensions/queue/queue-policies.controller.ts#L39) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/queue/queue-policies.controller.ts` | `policy` |
| GET | `apps/api/src/extensions/queue/queue-policies.controller.ts` | `calendar` |

### QueueController

@awp/api · [apps/api/src/extensions/queue/queue.controller.ts:52](../../apps/api/src/extensions/queue/queue.controller.ts#L52) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/queue/queue.controller.ts` | `lane` |
| GET | `apps/api/src/extensions/queue/queue.controller.ts` | `item` |
| GET | `apps/api/src/extensions/queue/queue.controller.ts` | `sla` |
| GET | `apps/api/src/extensions/queue/queue.controller.ts` | `capacity` |

### PortfolioQueueController

@awp/api · [apps/api/src/extensions/queue/queue.controller.ts:139](../../apps/api/src/extensions/queue/queue.controller.ts#L139) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/extensions/queue/queue.controller.ts` | `portfolio` |
| GET | `apps/api/src/extensions/queue/queue.controller.ts` | `capacity` |

### HealthController

@awp/api · [apps/api/src/health.controller.ts:10](../../apps/api/src/health.controller.ts#L10)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/health.controller.ts` | `live` |
| GET | `apps/api/src/health.controller.ts` | `ready` |

### LocalHealthController

@awp/api · [apps/api/src/local/local-health.controller.ts:8](../../apps/api/src/local/local-health.controller.ts#L8)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/local/local-health.controller.ts` | `live` |
| GET | `apps/api/src/local/local-health.controller.ts` | `ready` |

### LocalOpenApiController

@awp/api · [apps/api/src/local/local-openapi.controller.ts:5](../../apps/api/src/local/local-openapi.controller.ts#L5)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/local/local-openapi.controller.ts` | `docs` |
| GET | `apps/api/src/local/local-openapi.controller.ts` | `openapi` |

### LocalPersonaController

@awp/api · [apps/api/src/local/local-persona.controller.ts:276](../../apps/api/src/local/local-persona.controller.ts#L276)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/local/local-persona.controller.ts` | `options` |
| POST | `apps/api/src/local/local-persona.controller.ts` | `exchange` |
| POST | `apps/api/src/local/local-persona.controller.ts` | `selectProject` |
| POST | `apps/api/src/local/local-persona.controller.ts` | `stepUp` |

### LocalWalkingSkeletonController

@awp/api · [apps/api/src/local/local-walking-skeleton.controller.ts:37](../../apps/api/src/local/local-walking-skeleton.controller.ts#L37) · class guard: `LocalSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/local/local-walking-skeleton.controller.ts` | `overview` |
| POST | `apps/api/src/local/local-walking-skeleton.controller.ts` | `submitDummy` |
| POST | `apps/api/src/local/local-walking-skeleton.controller.ts` | `command` |
| POST | `apps/api/src/local/local-walking-skeleton.controller.ts` | `approve` |

### TechWritingController

@awp/api · [apps/api/src/local/tech-writing.controller.ts:19](../../apps/api/src/local/tech-writing.controller.ts#L19) · class guard: `LocalSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/local/tech-writing.controller.ts` | `list` |
| GET | `apps/api/src/local/tech-writing.controller.ts` | `get` |
| POST | `apps/api/src/local/tech-writing.controller.ts` | `create` |
| POST | `apps/api/src/local/tech-writing.controller.ts` | `act` |

### WorkspaceSubjectsController

@awp/api · [apps/api/src/local/workspace-subjects.controller.ts:20](../../apps/api/src/local/workspace-subjects.controller.ts#L20) · class guard: `LocalSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/local/workspace-subjects.controller.ts` | `list` |

### WorkspaceProjectsController

@awp/api · [apps/api/src/workspace/workspace.module.ts:30](../../apps/api/src/workspace/workspace.module.ts#L30) · class guard: `QaSessionGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/workspace/workspace.module.ts` | `catalog` |
| GET | `apps/api/src/workspace/workspace.module.ts` | `options` |
| POST | `apps/api/src/workspace/workspace.module.ts` | `register` |
| GET | `apps/api/src/workspace/workspace.module.ts` | `metadata` |
| PUT | `apps/api/src/workspace/workspace.module.ts` | `update` |

### WorkspaceHealthController

@awp/api · [apps/api/src/workspace/workspace.module.ts:76](../../apps/api/src/workspace/workspace.module.ts#L76)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/api/src/workspace/workspace.module.ts` | `live` |
| GET | `apps/api/src/workspace/workspace.module.ts` | `ready` |

### IdpHealthController

@awp/fake-idp · [apps/fake-idp/src/main.ts:10](../../apps/fake-idp/src/main.ts#L10)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/fake-idp/src/main.ts` | `live` |
| GET | `apps/fake-idp/src/main.ts` | `ready` |

### FakeOidcController

@awp/fake-idp · [apps/fake-idp/src/oidc.controller.ts:128](../../apps/fake-idp/src/oidc.controller.ts#L128)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/fake-idp/src/oidc.controller.ts` | `discovery` |
| GET | `apps/fake-idp/src/oidc.controller.ts` | `jwks` |
| POST | `apps/fake-idp/src/oidc.controller.ts` | `token` |
| POST | `apps/fake-idp/src/oidc.controller.ts` | `rotate` |
| POST | `apps/fake-idp/src/oidc.controller.ts` | `stepUp` |

### MockHealthController

@awp/mock-hub · [apps/mock-hub/src/app.module.ts:14](../../apps/mock-hub/src/app.module.ts#L14)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/app.module.ts` | `live` |

### GitLabController

@awp/mock-hub · [apps/mock-hub/src/gitlab/api/gitlab.controller.ts:89](../../apps/mock-hub/src/gitlab/api/gitlab.controller.ts#L89)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `version` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `project` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `mergeRequest` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `commit` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `branch` |
| POST | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `lint` |
| POST | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `trigger` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `pipelines` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `pipeline` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `variables` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `jobs` |
| GET | `apps/mock-hub/src/gitlab/api/gitlab.controller.ts` | `artifact` |

### GitLabControlController

@awp/mock-hub · [apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts:61](../../apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts#L61)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts` | `state` |
| POST | `apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts` | `fault` |
| POST | `apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts` | `scenario` |
| POST | `apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts` | `webhook` |
| GET | `apps/mock-hub/src/gitlab/control/gitlab-control.controller.ts` | `nextWebhook` |

### JiraController

@awp/mock-hub · [apps/mock-hub/src/jira/jira.controller.ts:132](../../apps/mock-hub/src/jira/jira.controller.ts#L132)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/jira/jira.controller.ts` | `serverInfo` |
| GET | `apps/mock-hub/src/jira/jira.controller.ts` | `issue` |
| POST | `apps/mock-hub/src/jira/jira.controller.ts` | `create` |
| GET | `apps/mock-hub/src/jira/jira.controller.ts` | `search` |
| PUT | `apps/mock-hub/src/jira/jira.controller.ts` | `edit` |
| POST | `apps/mock-hub/src/jira/jira.controller.ts` | `transition` |
| PUT | `apps/mock-hub/src/jira/jira.controller.ts` | `property` |
| POST | `apps/mock-hub/src/jira/jira.controller.ts` | `link` |
| POST | `apps/mock-hub/src/jira/jira.controller.ts` | `comment` |
| POST | `apps/mock-hub/src/jira/jira.controller.ts` | `scenario` |
| GET | `apps/mock-hub/src/jira/jira.controller.ts` | `rate` |

### MattermostController

@awp/mock-hub · [apps/mock-hub/src/mattermost/api/mattermost.controller.ts:50](../../apps/mock-hub/src/mattermost/api/mattermost.controller.ts#L50)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `ping` |
| GET | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `clientConfig` |
| GET | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `teams` |
| GET | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `channels` |
| GET | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `membership` |
| POST | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `createPost` |
| GET | `apps/mock-hub/src/mattermost/api/mattermost.controller.ts` | `lookup` |

### MattermostControlController

@awp/mock-hub · [apps/mock-hub/src/mattermost/control/mattermost-control.controller.ts:6](../../apps/mock-hub/src/mattermost/control/mattermost-control.controller.ts#L6)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/mattermost/control/mattermost-control.controller.ts` | `state` |
| POST | `apps/mock-hub/src/mattermost/control/mattermost-control.controller.ts` | `setFault` |
| POST | `apps/mock-hub/src/mattermost/control/mattermost-control.controller.ts` | `recordCallback` |

### MockHubController

@awp/mock-hub · [apps/mock-hub/src/mock-hub.controller.ts:143](../../apps/mock-hub/src/mock-hub.controller.ts#L143)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/mock-hub/src/mock-hub.controller.ts` | `publish` |
| POST | `apps/mock-hub/src/mock-hub.controller.ts` | `reset` |
| POST | `apps/mock-hub/src/mock-hub.controller.ts` | `seed` |
| POST | `apps/mock-hub/src/mock-hub.controller.ts` | `scenario` |
| GET | `apps/mock-hub/src/mock-hub.controller.ts` | `health` |

### OperationalController

@awp/mock-hub · [apps/mock-hub/src/operational/operational.controller.ts:324](../../apps/mock-hub/src/operational/operational.controller.ts#L324)

| Метод | Путь | Handler |
|---|---|---|
| POST | `apps/mock-hub/src/operational/operational.controller.ts` | `create` |
| GET | `apps/mock-hub/src/operational/operational.controller.ts` | `request` |
| POST | `apps/mock-hub/src/operational/operational.controller.ts` | `transition` |
| GET | `apps/mock-hub/src/operational/operational.controller.ts` | `effect` |
| POST | `apps/mock-hub/src/operational/operational.controller.ts` | `createDefect` |
| GET | `apps/mock-hub/src/operational/operational.controller.ts` | `defect` |
| GET | `apps/mock-hub/src/operational/operational.controller.ts` | `defectEffect` |

### PilotCapabilitiesController

@awp/mock-hub · [apps/mock-hub/src/pilot-capabilities.controller.ts:18](../../apps/mock-hub/src/pilot-capabilities.controller.ts#L18)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/mock-hub/src/pilot-capabilities.controller.ts` | `state` |
| POST | `apps/mock-hub/src/pilot-capabilities.controller.ts` | `fault` |
| POST | `apps/mock-hub/src/pilot-capabilities.controller.ts` | `probe` |

### HealthController

@awp/worker · [apps/worker/src/health.controller.ts:10](../../apps/worker/src/health.controller.ts#L10)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/worker/src/health.controller.ts` | `live` |
| GET | `apps/worker/src/health.controller.ts` | `ready` |

### LocalWorkerHealthController

@awp/worker · [apps/worker/src/local-health.controller.ts:8](../../apps/worker/src/local-health.controller.ts#L8)

| Метод | Путь | Handler |
|---|---|---|
| GET | `apps/worker/src/local-health.controller.ts` | `live` |
| GET | `apps/worker/src/local-health.controller.ts` | `ready` |

### CorporateSessionController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/auth/corporate-session.controller.ts:27](../../packages/platform-runtime-nest/src/auth/corporate-session.controller.ts#L27)

| Метод | Путь | Handler |
|---|---|---|
| POST | `packages/platform-runtime-nest/src/auth/corporate-session.controller.ts` | `login` |
| GET | `packages/platform-runtime-nest/src/auth/corporate-session.controller.ts` | `callback` |
| GET | `packages/platform-runtime-nest/src/auth/corporate-session.controller.ts` | `session` |
| POST | `packages/platform-runtime-nest/src/auth/corporate-session.controller.ts` | `logout` |

### AgentRunsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/agent-runs.controller.ts:24](../../packages/platform-runtime-nest/src/http/agent-runs.controller.ts#L24) · class guard: `IntakeDraftHttpGuard`

| Метод | Путь | Handler |
|---|---|---|
| POST | `packages/platform-runtime-nest/src/http/agent-runs.controller.ts` | `start` |
| GET | `packages/platform-runtime-nest/src/http/agent-runs.controller.ts` | `get` |

### ApprovalsV11Controller

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/approvals.controller.ts:56](../../packages/platform-runtime-nest/src/http/approvals.controller.ts#L56) · class guard: `ApprovalsV11HttpGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/approvals.controller.ts` | `get` |
| POST | `packages/platform-runtime-nest/src/http/approvals.controller.ts` | `decide` |

### ArtifactsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/artifacts.controller.ts:17](../../packages/platform-runtime-nest/src/http/artifacts.controller.ts#L17)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/artifacts.controller.ts` | `getArtifactMetadata` |
| GET | `packages/platform-runtime-nest/src/http/artifacts.controller.ts` | `streamArtifactContent` |

### AuditController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/audit.controller.ts:57](../../packages/platform-runtime-nest/src/http/audit.controller.ts#L57)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/audit.controller.ts` | `project` |
| GET | `packages/platform-runtime-nest/src/http/audit.controller.ts` | `workspace` |

### ConnectorWebhooksController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/connector-webhooks.controller.ts:22](../../packages/platform-runtime-nest/src/http/connector-webhooks.controller.ts#L22)

| Метод | Путь | Handler |
|---|---|---|
| POST | `packages/platform-runtime-nest/src/http/connector-webhooks.controller.ts` | `receive` |

### ControlPlaneController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/control-plane.controller.ts:36](../../packages/platform-runtime-nest/src/http/control-plane.controller.ts#L36)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/control-plane.controller.ts` | `command` |
| GET | `packages/platform-runtime-nest/src/http/control-plane.controller.ts` | `approval` |
| POST | `packages/platform-runtime-nest/src/http/control-plane.controller.ts` | `decide` |
| POST | `packages/platform-runtime-nest/src/http/control-plane.controller.ts` | `requestPublication` |
| POST | `packages/platform-runtime-nest/src/http/control-plane.controller.ts` | `webhook` |

### ExtensionRegistryController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/extension-registry.controller.ts:10](../../packages/platform-runtime-nest/src/http/extension-registry.controller.ts#L10)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/extension-registry.controller.ts` | `listPackRegistrations` |
| GET | `packages/platform-runtime-nest/src/http/extension-registry.controller.ts` | `listConnectorRegistrations` |
| GET | `packages/platform-runtime-nest/src/http/extension-registry.controller.ts` | `listCapabilityContracts` |

### IntakeCandidatesController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/intake-candidates.controller.ts:39](../../packages/platform-runtime-nest/src/http/intake-candidates.controller.ts#L39) · class guard: `IntakeDraftHttpGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/intake-candidates.controller.ts` | `list` |
| GET | `packages/platform-runtime-nest/src/http/intake-candidates.controller.ts` | `get` |
| POST | `packages/platform-runtime-nest/src/http/intake-candidates.controller.ts` | `decide` |

### IntakeDraftRevisionsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts:49](../../packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts#L49) · class guard: `IntakeDraftHttpGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts` | `list` |
| POST | `packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts` | `revise` |
| POST | `packages/platform-runtime-nest/src/http/intake-draft-revisions.controller.ts` | `validate` |

### IntakeDraftsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/intake-drafts.controller.ts:21](../../packages/platform-runtime-nest/src/http/intake-drafts.controller.ts#L21)

| Метод | Путь | Handler |
|---|---|---|
| POST | `packages/platform-runtime-nest/src/http/intake-drafts.controller.ts` | `createIntakeDraft` |
| GET | `packages/platform-runtime-nest/src/http/intake-drafts.controller.ts` | `getIntakeDraft` |
| POST | `packages/platform-runtime-nest/src/http/intake-drafts.controller.ts` | `submitIntakeDraft` |

### IntegrationRegistryController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/integration-registry.controller.ts:122](../../packages/platform-runtime-nest/src/http/integration-registry.controller.ts#L122)

| Метод | Путь | Handler |
|---|---|---|
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `createConnection` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `getConnection` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `validateConnection` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `publishConnection` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `health` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `createMapping` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `getMapping` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `validateMapping` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `publishMapping` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `createProfile` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `getProfile` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `validateProfile` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `publishProfile` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `createBinding` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `getBinding` |
| POST | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `validateBinding` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `availability` |
| GET | `packages/platform-runtime-nest/src/http/integration-registry.controller.ts` | `report` |

### NotificationIntentsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/notification-intents.controller.ts:17](../../packages/platform-runtime-nest/src/http/notification-intents.controller.ts#L17) · class guard: `IntakeDraftHttpGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/notification-intents.controller.ts` | `get` |

### OperationalAuthorityController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/operational-authority.controller.ts:80](../../packages/platform-runtime-nest/src/http/operational-authority.controller.ts#L80) · class guard: `OperationalAuthorityHttpGuard`

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` | `projection` |
| GET | `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` | `conflicts` |
| GET | `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` | `imports` |
| POST | `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` | `reconciliation` |
| POST | `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` | `approval` |
| POST | `packages/platform-runtime-nest/src/http/operational-authority.controller.ts` | `action` |

### ProjectOnboardingController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/project-onboarding.controller.ts:129](../../packages/platform-runtime-nest/src/http/project-onboarding.controller.ts#L129)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `catalog` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `register` |
| GET | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `onboarding` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `evaluate` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `activatePilot` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `grantEntitlement` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `revokeEntitlement` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `validateBinding` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `acceptBinding` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `applyBindingLifecycleAction` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `publishQaEnvironment` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `publishQaContext` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `publishQaResource` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `acquireAccountLease` |
| POST | `packages/platform-runtime-nest/src/http/project-onboarding.controller.ts` | `releaseAccountLease` |

### ProjectsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/projects.controller.ts:11](../../packages/platform-runtime-nest/src/http/projects.controller.ts#L11)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/projects.controller.ts` | `listVisibleProjects` |

### WorkItemsController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/work-items.controller.ts:11](../../packages/platform-runtime-nest/src/http/work-items.controller.ts#L11)

| Метод | Путь | Handler |
|---|---|---|
| GET | `packages/platform-runtime-nest/src/http/work-items.controller.ts` | `getWorkItem` |

### WorkTypesController

@awp/platform-runtime-nest · [packages/platform-runtime-nest/src/http/work-types.controller.ts:24](../../packages/platform-runtime-nest/src/http/work-types.controller.ts#L24)

| Метод | Путь | Handler |
|---|---|---|
| PUT | `packages/platform-runtime-nest/src/http/work-types.controller.ts` | `changeEnablement` |

## Незавершённые задачи в исходных tasks.md

- 001-extension-kernel-local-skeleton: 163/163; открыто 0.
- 002-qa-manual-walking-skeleton: 180/180; открыто 0.
- 003-jira-operational-authority: 163/163; открыто 0.
- 004-mattermost-hermes-intake: 215/215; открыто 0.
- 005-gitlab-automated-validation: 159/159; открыто 0.
- 006-queue-triage-capacity-sla: 170/170; открыто 0.
- 007-project-onboarding-evidence-security: 184/184; открыто 0.
- 008-pilot-hardening-and-conformance: 108/115; открыто 7.
  - T025 [US1] Implement shared complete non-local factories in `packages/runtime-composition/src/pilot/composition.ts`; wire API/worker entry points and entity/migration selection in `apps/api/src/main.ts` and `apps/worker/src/main.ts`. — [specs/008-pilot-hardening-and-conformance/tasks.md:118](../../specs/008-pilot-hardening-and-conformance/tasks.md#L118)
  - T040 [US1] After C1 metadata is supplied, pin selected real protocol/auth strategy and sanitized fixtures in `config/pilot/provider-capabilities.json` and a scoped input report; record unsupported capabilities instead of substituting versions. — [specs/008-pilot-hardening-and-conformance/tasks.md:196](../../specs/008-pilot-hardening-and-conformance/tasks.md#L196)
  - T057 [US2] After C1 and approved sandbox scope, implement/run N2 conformance in `tools/verification/feature-008-integration.mts`; save exact real-provider evidence and BLOCKED_INPUT for missing corporate prerequisites. — [specs/008-pilot-hardening-and-conformance/tasks.md:260](../../specs/008-pilot-hardening-and-conformance/tasks.md#L260)
  - T084 [US4] Implement/run approved corporate drill wrapper in `tools/verification/feature-008-recovery.mts` after IN-08; preserve BLOCKED_INPUT for absent target/fence/RPO/RTO/owner. — [specs/008-pilot-hardening-and-conformance/tasks.md:378](../../specs/008-pilot-hardening-and-conformance/tasks.md#L378)
  - T104 [US5] After N2/security/recovery and cohort input, implement/run actual shadow validation in `tools/verification/feature-008-shadow.mts`; record human-reviewed differences and zero external business writes. — [specs/008-pilot-hardening-and-conformance/tasks.md:432](../../specs/008-pilot-hardening-and-conformance/tasks.md#L432)
  - T105 [US5] After exact human activation, collect the actual approved pilot window/sample and guardrail observations through `packages/runtime-composition/src/pilot/observation-worker.ts`; persist source evidence for `reports/008-pilot-hardening-and-conformance/limited-pilot.json`. — [specs/008-pilot-hardening-and-conformance/tasks.md:436](../../specs/008-pilot-hardening-and-conformance/tasks.md#L436)
  - T106 [US5] Implement/run observed-pilot review validation in `tools/verification/feature-008-review.mts`; require real sample/provenance and human review, never simulate elapsed pilot time. — [specs/008-pilot-hardening-and-conformance/tasks.md:440](../../specs/008-pilot-hardening-and-conformance/tasks.md#L440)
- 009-russian-interface: 27/27; открыто 0.
- 010-remove-redis-s3: 30/30; открыто 0.
- 011-code-quality-standards: 22/22; открыто 0.
- 012-readme-script-cleanup: 14/14; открыто 0.
- 013-guided-workspace-ux: 18/18; открыто 0.
- 014-black-order-ui: 22/22; открыто 0.
- 015-tech-writing-workspace: 19/19; открыто 0.
- 016-shared-domain-team: 20/20; открыто 0.
- 017-workspace-wide-flow: 18/18; открыто 0.
- 018-local-account-cleanup: 13/13; открыто 0.
- 019-platform-access-admin: 19/19; открыто 0.
- 020-project-creation-queue: 11/11; открыто 0.
- 021-admin-workspace-projects: 9/9; открыто 0.
- 022-project-editing: 10/10; открыто 0.

## Воспроизведение

`node docs/architecture/generate-inventory.mjs` из корня репозитория обновляет этот каталог и inventory.json; основная архитектурная схема редактируется после анализа изменений.

SHA-256 набора проанализированных исходников: `2fa1837540e0e32d5a138b4dc097cc6c7311bfabfc83dfc222a1a0e1e5d31b45`.
