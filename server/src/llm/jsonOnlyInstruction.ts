/**
 * Инструкция «верни только JSON», дописываемая в КОНЕЦ промта хода.
 *
 * ЗАЧЕМ ОНА ВООБЩЕ ЕСТЬ. Промт хода уже показывает структуру ответа ("Return
 * your response in JSON format with the following structure: ..."), но не
 * запрещает обёртку вокруг неё — и модель заворачивала объект в ```` ```json ````.
 * Обёртку снимает `stripCodeFence`, но снимать дешевле, чем не порождать.
 *
 * ПОЧЕМУ ИНСТРУКЦИЯ, А НЕ `response_format`. Замер
 * (`.agent/runs/gemini-prompt-modes-2026-08-01/`) показал: шлюз принимает
 * `json_schema` со `strict: true`, но НЕ применяет — забор в ответе за строгой
 * схемой возможен, значит грамматики за ней нет. Схема при этом стоит места в
 * запросе. Инструкция в промте дала ту же долю схема-валидных ответов дешевле.
 *
 * ЧТО ЭТО НЕ ЗАМЕНЯЕТ: ни одной проверки после ответа. `stripCodeFence`,
 * конверт, схемы действий и `validateActionApplicability` остаются на месте —
 * инструкция уменьшает вероятность мусора, а не разрешает его принимать.
 */
export const JSON_ONLY_INSTRUCTION = `## Output format (hard requirement)
Return ONLY the JSON object described above, and nothing else. The first
character of your response must be "{" and the last must be "}". Do not wrap it
in a markdown code fence, do not prefix it with a language tag, do not write an
explanation, preamble, or closing remark around it. Any character outside the
JSON object makes the whole response unusable.`;

/** Промт хода плюс инструкция о формате — единственный способ их склеить. */
export function withJsonOnlyInstruction(prompt: string): string {
  return `${prompt.replace(/\s+$/, "")}\n\n${JSON_ONLY_INSTRUCTION}\n`;
}
