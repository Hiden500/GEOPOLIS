import { z } from "zod";
import { type GameState } from "@shared/types/GameState";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import { MAX_PROMPT_CRISES } from "@shared/defines/discontent";
import {
  primitiveSchema,
  parsePrimitives,
  MAX_PRIMITIVES_PER_BATCH,
} from "../primitives/primitiveSchemas";
import { type Primitive } from "../primitives/types";
import { activeCrises, regionPromptLabel, renderCrisis } from "./crisisDigest";
import { PRIMITIVE_CONTRACT } from "./primitiveContract";

/**
 * Перевод свободного приказа игрока в примитивы (docs/PRIMITIVES.md §1,
 * гибридный интерфейс: «свободный текст для замысла — LLM переводит в
 * примитивы, показывает распознанное на подтверждение»).
 *
 * Это НЕ режиссура: модель здесь не придумывает событий и не решает за игрока,
 * а только переводит уже сказанное им в словарь движка. Отсюда три отличия от
 * мирового цикла:
 *   - нарратива нет вовсе, ответ — один массив примитивов;
 *   - источником всегда выступает страна игрока, и это чинится сервером, а не
 *     доверяется модели;
 *   - пустой ответ законен и является правильным поведением на тексте без
 *     приказа («хочу мира во всём мире» переводить не во что).
 *
 * Перевод ничего не применяет. Результат уходит игроку на подтверждение, и
 * только подтверждённое идёт в движок — «показ распознанного» из §1 буквально.
 */

/**
 * Форма, которой направляется ГЕНЕРАЦИЯ (structured output провайдера): строгая,
 * с закрытыми enum'ами глаголов и качественных параметров.
 */
export const primitiveTranslationSchema = z.object({
  primitives: z.array(primitiveSchema).max(MAX_PRIMITIVES_PER_BATCH),
});

/**
 * Форма, которой разбирается ВХОДЯЩИЙ ответ: мягкая по элементам. Тот же приём,
 * что у `LLMResponseEnvelopeSchema` — каждый примитив проверяется по отдельности
 * (`parsePrimitives`), чтобы один битый элемент не отменял остальные и чтобы по
 * нему была причина, а не молчание.
 */
const translationEnvelopeSchema = z.object({
  primitives: z.array(z.unknown()).optional(),
});

/**
 * Сколько кризисных регионов игрока попадает в промт перевода. Тот же кап, что
 * у мирового цикла: игроку столько же контекста, сколько режиссёру, и по той же
 * причине — бюджет промта (docs/CONCEPT.md §7).
 */
const TRANSLATION_CRISIS_LIMIT = MAX_PROMPT_CRISES;

/**
 * Регионы игрока, о которых приказ может идти: сначала те, что в кризисе (по
 * остроте), — они и есть предмет разговора. Полный список регионов страны в
 * промт не идёт: у СССР их сотни, а бюджет промта конечен.
 */
function playerRegionsContext(game: GameState): string {
  const crises = activeCrises(game).filter(
    c => effectiveController(c.region) === game.playerCountryId
  );

  if (crises.length === 0) {
    return "None of the player's regions is currently above the crisis threshold.";
  }

  return crises
    .slice(0, TRANSLATION_CRISIS_LIMIT)
    .map(crisis => renderCrisis(game, crisis))
    .join("\n");
}

/**
 * Регион, на который игрок смотрит в интерфейсе. Приказ вроде «подавить это»
 * без выделения перевести не во что, а с выделением — можно, и притом честно:
 * контекст выделения даёт сам игрок, модель его не угадывает.
 */
function selectionContext(game: GameState, regionId: number | undefined): string {
  if (regionId === undefined) return "The player has no region selected right now.";

  const region = game.regions.find(r => r.id === regionId);
  if (!region) return "The player has no region selected right now.";

  const groups = (region.demographics ?? [])
    .map(d => {
      const name =
        getText(game.ethnicGroups.find(g => g.id === d.groupId)?.names, LLM_LOCALE) || d.groupId;
      return `${name} (id ${d.groupId}, ${(d.share * 100).toFixed(0)}%)`;
    })
    .join("; ");

  return (
    `The player is currently looking at region ${region.id} (${regionPromptLabel(region)}), ` +
    `held by ${effectiveController(region)}. ` +
    (groups.length > 0 ? `Its groups: ${groups}.` : "It has no mapped demographics.") +
    ` A demonstrative order ("crush them here", "give them autonomy") refers to this region.`
  );
}

export function buildPrimitiveTranslationPrompt(
  game: GameState,
  intent: string,
  selectedRegionId?: number
): string {
  const player = game.countries.find(c => c.id === game.playerCountryId);
  const playerName = getText(player?.name, LLM_LOCALE) || game.playerCountryId;

  return `# Geopolis — translating a player order into impact primitives

## Task
The player leads ${playerName} (country id ${game.playerCountryId}) and has typed one
order in their own words, possibly in Russian. Translate it into impact
primitives. You are a translator here, not a director: do not add anything the
player did not ask for, do not soften or escalate what they did ask for, and do
not invent a target they did not name or point at.

If the text contains no order the alphabet can express — a wish, a question, a
piece of narrative colour — return an empty array. An empty answer is correct
and expected; a made-up order is not.

## Current date
${game.currentDate}

## The player's regions in crisis
${playerRegionsContext(game)}

## Current selection
${selectionContext(game, selectedRegionId)}

## The order, verbatim
${intent}

## Alphabet
${PRIMITIVE_CONTRACT}

## Rules for this task
- "sourceCountryId" is always "${game.playerCountryId}". The server enforces this;
  a different value will be overwritten.
- Unlike the world cycle, repress / grant_autonomy / enact_reform ARE allowed
  here: this is the player's own decision, given by the player.
- Use region ids and group ids exactly as they appear above. Never invent one.
- Return JSON: {"primitives": [ ... ]}. Nothing else.`;
}

export interface PrimitiveTranslation {
  primitives: Primitive[];
  /** Причины по элементам, которые не прошли структурную схему. */
  invalid: { index: number; reason: string }[];
}

/**
 * Разбирает сырой ответ модели. Источник принудительно переписывается на страну
 * игрока: приказ игрока по определению отдаёт игрок, и доверять здесь модели
 * незачем — ошибка в этом поле означала бы действие от чужого имени.
 */
export function parsePrimitiveTranslation(
  raw: string,
  playerCountryId: string
): PrimitiveTranslation | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Invalid JSON format" };
  }

  const envelope = translationEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    return { error: "Response does not contain a primitives array" };
  }

  const { primitives, invalid } = parsePrimitives(envelope.data.primitives ?? []);
  return {
    primitives: primitives.map(p => ({ ...p, sourceCountryId: playerCountryId })),
    invalid,
  };
}
