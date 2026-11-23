import type { ProjectDialogueDraft } from "@awp/competency-ui-sdk";

/** Local deterministic dialogue: text supplies fields, never authority or execution instructions. */
export function advanceProjectDialogue(draft: ProjectDialogueDraft, message: string) {
  const next = { ...draft };
  const input = message.trim();
  if (!input || input.length > 2000) throw new Error("PROJECT_DIALOGUE_MESSAGE_INVALID");
  let edited = false;
  for (const [label, field] of [
    ["название", "name"],
    ["цель|описание", "purpose"],
    ["ключ", "key"],
  ] as const) {
    const match = new RegExp(`(?:^|\\n)(?:${label}):\\s*(.+)`, "iu").exec(input);
    if (match) {
      next[field] = match[1]!.trim();
      edited = true;
    }
  }
  if (!edited && !next.name) {
    const quoted = /[«“"]([^»”"]+)[»”"](?:\s*[,—:-]?\s*(?:для|чтобы)\s+(.+))?/iu.exec(input);
    const sentence =
      /^(?:создай(?:те)?|создать|заведи(?:те)?|нужен|хочу создать)\s+(?:новый\s+)?проект\s+(.+?)(?:\s+(?:для|чтобы)\s+(.+))?[.!]?$/iu.exec(
        input,
      );
    const found = quoted ?? sentence;
    next.name = found?.[1]?.trim() ?? input;
    if (found?.[2]) next.purpose = found[2].trim();
  } else if (!edited && !next.purpose) next.purpose = input;
  if (!/^[A-Z][A-Z0-9_-]{1,31}$/u.test(next.key)) throw new Error("PROJECT_KEY_INVALID");
  if ((next.name?.length ?? 0) > 256 || (next.purpose?.length ?? 0) > 2000)
    throw new Error("PROJECT_DIALOGUE_MESSAGE_INVALID");
  const ready = !!next.name && !!next.purpose;
  return {
    draft: next,
    state: ready ? ("READY" as const) : ("COLLECTING" as const),
    reply: ready
      ? "Проверьте карточку проекта. Можно уточнить данные сообщением «Название: …», «Цель: …» или «Ключ: …». Когда всё верно, нажмите «Создать проект». Вы будете его заказчиком; другие заказчики его не увидят."
      : next.name
        ? "Для чего нужен этот проект? Опишите цель и ожидаемый результат."
        : "Как назвать ваш проект?",
  };
}
