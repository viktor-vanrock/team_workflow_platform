export interface QaDorRuleDefinition {
  readonly code: string;
  readonly field: string;
  readonly pointer: string;
  readonly remediation: string;
  readonly waivable: boolean;
}

const hard = (
  code: string,
  field: string,
  pointer: string,
  remediation: string,
): QaDorRuleDefinition => Object.freeze({ code, field, pointer, remediation, waivable: false });

export const DOR_RULE_CODES: readonly QaDorRuleDefinition[] = Object.freeze([
  hard(
    "ACCEPTED_REQUEST_REQUIRED",
    "acceptedRequest",
    "/acceptedRequest",
    "Подтвердите внешний рабочий запрос.",
  ),
  hard(
    "PROJECT_INACTIVE",
    "project",
    "/project/state",
    "Активируйте проект до начала планирования QA.",
  ),
  hard(
    "REQUESTER_ENTITLEMENT_INACTIVE",
    "originalRequester",
    "/requesterEntitlement",
    "Восстановите права исходного заказчика.",
  ),
  hard(
    "RESPONSE_CHANNEL_UNCONFIRMED",
    "responseChannel",
    "/responseChannelResolution",
    "Подтвердите веб-канал ответа платформы для исходного заказчика.",
  ),
  hard("GOAL_REQUIRED", "goal", "/goal", "Укажите цель проверки."),
  hard("VALIDATION_SCOPE_REQUIRED", "scope", "/scope", "Укажите согласованную область проверки."),
  hard(
    "ACCEPTANCE_OUTCOME_REQUIRED",
    "acceptanceOutcome",
    "/acceptanceOutcome",
    "Укажите принятый ожидаемый результат.",
  ),
  hard(
    "BLOCKERS_DECLARATION_REQUIRED",
    "blockers",
    "/blockersDeclared",
    "Явно укажите блокирующие факторы, даже если список пуст.",
  ),
  hard(
    "DEPENDENCIES_DECLARATION_REQUIRED",
    "dependencies",
    "/dependenciesDeclared",
    "Явно укажите зависимости, даже если список пуст.",
  ),
  hard(
    "SOURCE_REFERENCE_REQUIRED",
    "sourceRefs",
    "/sourceRefs",
    "Закрепите неизменяемую ссылку на источник.",
  ),
  hard(
    "BUILD_REFERENCE_REQUIRED",
    "requestedTarget.buildRef",
    "/requestedTarget/buildRef",
    "Закрепите неизменяемую ссылку на сборку.",
  ),
  hard(
    "NON_PRODUCTION_TARGET_REQUIRED",
    "requestedTarget.environmentId",
    "/requestedTarget/environmentId",
    "Выберите разрешённую редакцию непроизводственной среды.",
  ),
  hard(
    "TEST_DATA_REFERENCE_REQUIRED",
    "requestedTarget.testDataRef",
    "/requestedTarget/testDataRef",
    "Закрепите происхождение тестовых данных или аренды учётной записи.",
  ),
  hard("REQUEST_RISK_REQUIRED", "requestRisk", "/requestRisk", "Укажите риск запроса."),
  hard("DESIRED_DATE_REQUIRED", "desiredDate", "/desiredDate", "Укажите желаемую дату проверки."),
  hard(
    "CHECKLIST_REFERENCE_REQUIRED",
    "checklistRefs",
    "/checklistRefs",
    "Закрепите хотя бы одну неизменяемую ссылку на чек-лист.",
  ),
  hard(
    "CLASSIFICATION_NOT_ALLOWED",
    "dataClassificationKey",
    "/dataClassificationKey",
    "Используйте классификацию, разрешённую контекстом проекта.",
  ),
  hard(
    "RETEST_LINEAGE_REQUIRED",
    "previousSessionRef",
    "/previousSessionRef",
    "Для повторной проверки закрепите дефект, исходную сборку и предыдущий сеанс.",
  ),
  hard(
    "RETEST_LINEAGE_INVALID",
    "previousSessionRef",
    "/previousSessionRef",
    "Используйте действительную неизменяемую цепочку из той же области.",
  ),
  hard(
    "BINDING_PROFILE_MAPPING_INVALID",
    "operationalBindingRef",
    "/mappingHealth",
    "Исправьте точное сопоставление привязки и профиля.",
  ),
  Object.freeze({
    code: "PROJECT_REGISTRY_NEEDS_REVIEW",
    field: "projectRegistry",
    pointer: "/project/registryState",
    remediation:
      "Получите точное независимое исключение от руководителя QA или обновите проверку реестра.",
    waivable: true,
  }),
]);

export const qaDorRuleByCode = new Map(DOR_RULE_CODES.map((rule) => [rule.code, rule]));
