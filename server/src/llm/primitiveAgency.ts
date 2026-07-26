import { type Primitive, type PrimitiveVerb, type RejectedPrimitive } from "../primitives/types";

/**
 * Граница агентности: что режиссёру НЕ позволено делать за игрока
 * (docs/CONCEPT.md §7.2 — «LLM за страну игрока — всё предложением, никогда не
 * применяет молча»).
 *
 * Правило не «модель не трогает страну игрока» — такое правило сломало бы сам
 * срез: кризис происходит ВНУТРИ страны игрока, и подстрекательство с
 * инцидентом — это мир, действующий на игрока, а не решение игрока. Различие
 * проходит не по стране, а по природе глагола:
 *
 *   - `incite_unrest`, `spawn_incident` — давление извне и снизу. Режиссёр
 *     вправе применять их к регионам игрока: это и есть повод, ради которого
 *     его зовут;
 *   - `repress`, `grant_autonomy`, `enact_reform` — акты ГОСУДАРСТВЕННОЙ
 *     политики: подавить, уступить, сменить курс. Их выбирает тот, кто за
 *     государство отвечает. Применить их за игрока — это принять за него
 *     решение молча, ровно то, что §7.2 запрещает.
 *
 * Проверяется кодом, а не просьбой в промте: инструкция промта — рекомендация,
 * фильтр — граница. Отклонённое уходит игроку и в следующий промт диагностикой,
 * поэтому модель узнаёт правило из отказа, а не только из текста.
 *
 * Для ЧУЖИХ стран те же глаголы режиссёру разрешены: ИИ-держава подавляет свои
 * волнения сама, и подтверждение спрашивать не у кого.
 */
export const PLAYER_DECISION_VERBS: readonly PrimitiveVerb[] = [
  "repress",
  "grant_autonomy",
  "enact_reform",
];

export function isPlayerDecisionVerb(verb: PrimitiveVerb): boolean {
  return PLAYER_DECISION_VERBS.includes(verb);
}

export interface AgencySplit {
  allowed: Primitive[];
  refused: RejectedPrimitive[];
}

/**
 * Делит примитивы модели на допустимые и отклонённые по границе агентности.
 * Форма отказа — та же `RejectedPrimitive`, что у движка: потребителю
 * (диагностика, интерфейс) незачем знать, на каком слое отказали.
 */
export function splitByAgency(
  primitives: readonly Primitive[],
  playerCountryId: string
): AgencySplit {
  const allowed: Primitive[] = [];
  const refused: RejectedPrimitive[] = [];

  for (const primitive of primitives) {
    if (primitive.sourceCountryId === playerCountryId && isPlayerDecisionVerb(primitive.verb)) {
      refused.push({
        verb: primitive.verb,
        sourceCountryId: primitive.sourceCountryId,
        reason:
          `${primitive.verb} is a policy decision of ${playerCountryId}, the player's own ` +
          `country: the director may create the pressure, but never chooses the answer for ` +
          `the player. Offer it in the narrative instead.`,
      });
      continue;
    }
    allowed.push(primitive);
  }

  return { allowed, refused };
}
