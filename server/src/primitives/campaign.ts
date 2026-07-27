import { type GameState } from "@shared/types/GameState";
import { type CampaignState } from "@shared/types/Campaign";
import { type PolityLifecycleResult } from "./polityLifecycle";

/**
 * Машина состояний кампании (docs/CONCEPT.md §7.1) и вычисление game over (§6).
 *
 * ПРАВИЛО, РАДИ КОТОРОГО МОДУЛЬ СУЩЕСТВУЕТ: «game over вычисляет ДВИЖОК, а не
 * объявляет текст LLM» (§6). Поэтому здесь нет ни одного входа, через который
 * модель или нарратив могли бы объявить партию оконченной: состояние кампании
 * выводится из состава мира и из результата структурной операции, и больше
 * ниоткуда.
 *
 * ВТОРОЕ ПРАВИЛО: конец УЗКИЙ. §6 перечисляет то, что концом НЕ является, и
 * список длиннее самого конца — раскол, переворот, оккупация всех регионов,
 * превращение в сателлита. Реализация обязана быть такой же узкой, иначе
 * драматургическая дуга «падение проходит через несколько обратимых стадий»
 * схлопывается в один шаг.
 *
 * ЧТО ЗДЕСЬ СОЗНАТЕЛЬНО НЕ РЕАЛИЗОВАНО. Правительство в изгнании (§6 относит
 * его к post-v1) и `annex`/`puppet` как глаголы алфавита (возвращаются
 * отдельной сессией). Поэтому «поглощение» опознаётся по фактическому владению
 * столичным регионом, а не по формальному акту аннексии, которого в контракте
 * ещё нет.
 */

/** Регионы, которыми страна ВЛАДЕЕТ (оккупация владения не меняет — §6). */
function ownedRegionCount(game: GameState, countryId: string): number {
  let count = 0;
  for (const region of game.regions) if (region.ownerCountryId === countryId) count += 1;
  return count;
}

/**
 * Переход кампании после структурной операции жизненного цикла.
 *
 * Единственный интересный случай — распалась страна ИГРОКА. Ссылку
 * `playerCountryId` перенос уже перевёл на правопреемника (иначе состояние было
 * бы невалидным в промежутке), поэтому партия не «висит»: игрок уже играет за
 * крупнейший осколок, а выбор лишь позволяет ему предпочесть другой. Это и
 * подтверждение необратимого действия (§7.2): режиссёру не запрещено расколоть
 * страну игрока, но КЕМ он останется, решает только он.
 */
export function applyLifecycleToCampaign(
  game: GameState,
  result: PolityLifecycleResult
): void {
  if (result.dissolvedCountryId === undefined) return;
  if (game.campaign.status !== "active") return;

  const successors = result.shards.map(s => s.countryId);
  // Осколков меньше двух — выбирать не из чего, и остановка партии вопросом с
  // единственным ответом была бы ритуалом, а не решением игрока.
  const playerAffected = successors.includes(game.playerCountryId);
  if (!playerAffected || successors.length < 2) return;

  game.campaign = {
    status: "succession_choice_pending",
    predecessor: result.dissolvedName ?? { en: result.dissolvedCountryId },
    successorCountryIds: successors,
    since: game.currentDate,
  };
}

/** Отказ выбора преемника — структурный код, как у примитивов. */
export type SuccessionRejection =
  | { code: "notPending" }
  | { code: "notASuccessor"; countryId: string };

/**
 * Выбор осколка игроком: `succession_choice_pending → active`.
 *
 * Проверяется ПРИНАДЛЕЖНОСТЬ к списку, а не только существование страны:
 * иначе ручка выбора преемника превратилась бы в свободную смену страны
 * посреди партии.
 */
export function chooseSuccessor(
  game: GameState,
  countryId: string
): { ok: true } | { ok: false; rejection: SuccessionRejection } {
  if (game.campaign.status !== "succession_choice_pending") {
    return { ok: false, rejection: { code: "notPending" } };
  }
  if (!game.campaign.successorCountryIds.includes(countryId)) {
    return { ok: false, rejection: { code: "notASuccessor", countryId } };
  }

  game.playerCountryId = countryId;
  game.campaign = { status: "active" };
  return { ok: true };
}

/**
 * Вычисление конца кампании — ОДНО правило, применяемое движком каждый ход.
 *
 * Конец наступает, когда государство игрока не владеет НИ ОДНИМ регионом.
 * Именно владеет: оккупация всех регионов концом не является (§6 —
 * «оккупация ≠ аннексия»), и это различие держится тем, что здесь читается
 * `ownerCountryId`, а не `effectiveController`.
 *
 * Причина называется по тому, кто держит СТОЛИЦУ: место правительства — самый
 * близкий к «формальной капитуляции» факт, который состояние умеет выразить
 * сегодня. Если столичный регион не нашёлся или ничей — роспуск без
 * правопреемника.
 *
 * ПОЧЕМУ СТРАНА-НЕИГРОК, потерявшая все регионы, НЕ удаляется и не переходит
 * во владение победителя (§7.1 «тотальное поражение: rebel → subject, не
 * overlord»): побеждённый субъект продолжает существовать в подчинённом
 * положении, а не растворяется в победителе. Механики подчинения (`puppet`)
 * в алфавите ещё нет, поэтому сегодня он остаётся государством без территории —
 * и это честнее, чем удалить его и объявить победителя владельцем.
 */
export function evaluateCampaign(game: GameState): CampaignState {
  // Терминальное и ожидающее состояния движок не пересматривает: первое
  // необратимо по определению, второе ждёт человека.
  if (game.campaign.status !== "active") return game.campaign;
  if (ownedRegionCount(game, game.playerCountryId) > 0) return game.campaign;

  const player = game.countries.find(c => c.id === game.playerCountryId);
  const capital = game.regions.find(r => r.id === player?.capitalRegionId);
  const holder = capital
    ? game.countries.find(c => c.id === capital.ownerCountryId)
    : undefined;

  game.campaign = {
    status: "defeated",
    reason: holder
      ? { code: "absorbed", by: { ...holder.name } }
      : { code: "dissolvedWithoutSuccessor" },
    since: game.currentDate,
  };
  return game.campaign;
}
