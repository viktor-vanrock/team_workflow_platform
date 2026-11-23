# Исследование

Дата: 2026-09-09. Исходники репозитория изучены локально; неизвестных внешних технологий не вводится.

## Рабочая область

**Решение**: additive `WorkspaceContribution` в browser SDK и статический registry в web. **Основание**: существующий SDK имеет только WORK_ITEM_DETAIL_TAB, а shell hardcoded QA. Исследование выполнено отдельным исследовательским агентом по speckit-plan. **Альтернатива**: скопировать shell — отклонена из-за дублирования входа/сброса контекста. Сохранить epoch и remount key существующего shell.

## Идентичность и права

**Решение**: Fake IdP subjects writer.docs/lead.docs; project-scoped роли и entitlements. SQL persona exchange фильтруется по configured workspace, permissions — пересечение role/entitlement. HTTP использует LocalSessionGuard и текущую durable Core authorization в транзакции. **Основание**: текущий exchange берёт rows[0] без фильтра workspace; это неверно для второй области. **Альтернатива**: статическая роль в JWT/скрытые кнопки — не обеспечивают отзыв доступа.

## Домен и authority

**Решение**: редакционное задание и его документ принадлежат pack; lifecycle DRAFT/IN_REVIEW/CHANGES_REQUESTED/APPROVED. Не создавать фиктивный принятый Work Item. **Основание**: конституция сохраняет operational state принятого Work Item в Jira. Локальное утверждение документа — human domain decision, не Jira transition и не публикация.

## Хранение и версии

**Решение**: pack-owned SQL tables; revision для текста, resourceVersion для любой команды, history сохраняет текст/хэш и решение. Transaction + row locks, idempotency receipt и Core audit. **Альтернатива**: JSON/localStorage — теряет долговечность и серверную изоляцию.

## Seed и сервис

**Решение**: отдельный marker `015-tech-writing-workspace` v1 после текущих seed, с advisory lock и стабильными ID, INSERT ON CONFLICT DO NOTHING. ALPHA-DOCS — отдельный scoped проект, локальные материалы на основе ALPHA; не ссылка, предоставляющая доступ к QA. Три задания показывают черновик, ревью и замечания; создание нового задания позволяет повторить полный цикл.

## Scope

**Решение**: ADR-0010 и конституция 2.0.1 уточняют только local demo exception, явная пользовательская постановка служит основанием. Production composition не получает controller/seed. Отдельное принятие production расширения не подразумевается.
