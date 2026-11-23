import { type QaIntakeFieldKey, qaIntakeFieldOrder } from "./intake-completeness.ts";

const promptByField: Readonly<Record<QaIntakeFieldKey, string>> = Object.freeze({
  title: "Кратко назовите проверку",
  requestKind: "Выберите тип QA-запроса",
  goal: "Какова цель проверки?",
  scope: "Что входит в область проверки?",
  acceptanceOutcome: "Какой результат считается успешным?",
  sourceRefs: "Укажите ссылки на источники",
  blockers: "Перечислите известные блокеры",
  dependencies: "Перечислите зависимости",
  requestedTarget: "Уточните целевое окружение",
  requestRisk: "Укажите риск запроса",
  businessImpact: "Опишите влияние на бизнес",
  desiredDate: "Укажите желаемую дату",
  checklistRefs: "Укажите чек-листы",
  roleMetadataRefs: "Укажите связанные роли",
  requestedClassificationKey: "Выберите классификацию данных",
  defectRef: "Укажите дефект для ретеста",
  previousSessionRef: "Укажите предыдущую сессию",
  sourceBuildRef: "Укажите исходную сборку",
});

export function selectQaIntakeQuestions(
  input: Readonly<{ missingFields: readonly string[]; invalidFields: readonly string[] }>,
  limit = 6,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 18)
    throw new Error("INTAKE_QUESTION_LIMIT_INVALID");
  const missing = new Set(input.missingFields);
  const invalid = new Set(input.invalidFields);
  return Object.freeze(
    qaIntakeFieldOrder
      .filter((key) => missing.has(key) || invalid.has(key))
      .slice(0, limit)
      .map((fieldKey, order) =>
        Object.freeze({
          fieldKey,
          reasonCode: invalid.has(fieldKey) ? ("INVALID" as const) : ("MISSING" as const),
          prompt: promptByField[fieldKey],
          inputKind:
            fieldKey === "requestedClassificationKey"
              ? ("CLASSIFICATION" as const)
              : [
                    "sourceRefs",
                    "blockers",
                    "dependencies",
                    "checklistRefs",
                    "roleMetadataRefs",
                  ].includes(fieldKey)
                ? ("STRING_LIST" as const)
                : ["goal", "scope", "acceptanceOutcome", "businessImpact"].includes(fieldKey)
                  ? ("LONG_TEXT" as const)
                  : ("SHORT_TEXT" as const),
          order,
        }),
      ),
  );
}

export function boundQaIntakePatch(
  content: Readonly<Record<string, unknown>>,
  patch: readonly Readonly<{ fieldKey: string; value: unknown }>[],
  allowedFields: readonly string[],
  limit = 6,
) {
  if (patch.length > limit) throw new Error("INTAKE_PATCH_LIMIT_EXCEEDED");
  const allowed = new Set(allowedFields);
  const seen = new Set<string>();
  return Object.freeze(
    patch.map((operation) => {
      if (
        !qaIntakeFieldOrder.includes(operation.fieldKey as QaIntakeFieldKey) ||
        !allowed.has(operation.fieldKey)
      )
        throw new Error("INTAKE_PATCH_FIELD_DENIED");
      if (seen.has(operation.fieldKey)) throw new Error("INTAKE_PATCH_DUPLICATE_FIELD");
      if (Object.hasOwn(content, operation.fieldKey))
        throw new Error("INTAKE_PATCH_EXISTING_FIELD_DENIED");
      seen.add(operation.fieldKey);
      return Object.freeze({
        fieldKey: operation.fieldKey,
        value: structuredClone(operation.value),
      });
    }),
  );
}
