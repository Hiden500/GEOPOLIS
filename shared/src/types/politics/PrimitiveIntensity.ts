/**
 * Качественный хинт силы воздействия (docs/PRIMITIVES.md §1: «params —
 * КАЧЕСТВЕННЫЕ мета-параметры, LLM не задаёт величины»).
 *
 * Словарь живёт в `shared/`, а не рядом с движком примитивов, по одной
 * причине: `shared/src/defines/discontent.ts` держит позиции хинта в коридоре
 * магнитуды и обязан быть типизирован по этому же перечислению. Иначе
 * `Record<string, number>` молча проглотит новое значение интенсивности и
 * провалит его в дефолт вместо ошибки компиляции.
 *
 * Движок примитивов реэкспортирует оба имени (server/src/primitives/types.ts),
 * поэтому его потребители продолжают импортировать из одного места.
 */
export const PRIMITIVE_INTENSITIES = ["mild", "moderate", "severe"] as const;

export type PrimitiveIntensity = (typeof PRIMITIVE_INTENSITIES)[number];
