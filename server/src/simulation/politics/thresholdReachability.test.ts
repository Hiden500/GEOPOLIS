import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import {
  groupDiscontent,
  regionDiscontent,
  regionWelfare,
  regionWelfareReference,
  resolveIdeologyCoordinates,
  findImpactMemory,
} from "@shared/utils/discontent";
import {
  REGION_CRISIS_DISCONTENT_THRESHOLD,
  SPLIT_MIN_DISCONTENT_STRICT,
  SPLIT_MIN_DISCONTENT_LOOSE,
  SPLIT_MIN_GROUP_SHARE,
} from "@shared/defines/discontent";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";

/**
 * ПОРОГИ НЕДОВОЛЬСТВА ДОСТИЖИМЫ ЖИВЫМИ ДАННЫМИ.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Недостижимый порог выглядит как исправный код: ветка просто
 * не берётся, тесты зелёные, поведения нет. Проект уже терял так дипломатию
 * (`RIVAL_RELATION_THRESHOLD = −70` при достижимом минимуме −11) и войну
 * (`WAR_RELATION_THRESHOLD = −80`), и оба раза дефект прожил месяцы.
 *
 * Здесь тот же риск заряжен геометрией данных. Идеологическая дистанция
 * нормируется на диагональ квадрата [-1,1]² (2√2 ≈ 2,828) — математически
 * верно, — но каталог групп сценария 1946 лежит почти на одной оси:
 * `desiredIdeology.political > 0` у 93,7% групп, среднее по экономической оси
 * −0,009. Замер 2026-08-01 по 5328 живым парам: сырая дистанция достигает 1,931
 * при длине оси 2,000 и диагонали 2,828, то есть мир занимает 68,3% шкалы.
 *
 * Из-за этого запас до недостижимости мал: строжайший порог отделения 0,820 при
 * фактическом максимуме 0,890 — 8%. Следующее наполнение данных съест его
 * незаметно, и механика расколов тихо умрёт. Тест ловит именно это.
 *
 * ЧТО ТЕСТ НЕ ДЕЛАЕТ. Он не фиксирует, СКОЛЬКО регионов пересекает порог: это
 * калибровка, и она меняется с данными. Проверяется только, что переход
 * возможен и что он не стал массовым, — обе границы широкие.
 */

/** Максимальное недовольство группы-большинства — та же величина, что читает раскол. */
function majorityDiscontent(game: GameState, region: Region): number {
  const owner = game.countries.find(c => c.id === region.ownerCountryId);
  if (!owner) return Number.NaN;

  const coords = resolveIdeologyCoordinates(owner.politics);
  const welfare = regionWelfare(region, regionWelfareReference(game, region));
  const groups = new Map(game.ethnicGroups.map(g => [g.id, g]));

  let best = Number.NaN;
  for (const entry of region.demographics ?? []) {
    if (entry.share < SPLIT_MIN_GROUP_SHARE) continue;
    const definition = groups.get(entry.groupId);
    if (!definition) continue;
    const value = groupDiscontent(
      coords,
      definition.desiredIdeology,
      welfare,
      findImpactMemory(game.groupImpactMemory, region.id, entry.groupId)
    );
    best = Number.isNaN(best) ? value : Math.max(best, value);
  }
  return best;
}

describe("пороги недовольства лежат внутри достижимого диапазона", () => {
  it("кризисный порог региона берётся, но не всем миром", () => {
    const game = createGame("1946", "USA");
    const values = game.regions.map(r => regionDiscontent(game, r)).filter((v): v is number => Number.isFinite(v));

    const over = values.filter(v => v >= REGION_CRISIS_DISCONTENT_THRESHOLD).length;
    expect(over, "кризисный порог недостижим — механика кризисов мертва").toBeGreaterThan(0);
    expect(over / values.length, "в кризисе весь мир — порог потерял смысл").toBeLessThan(0.5);
  });

  it("строжайший порог отделения достижим хотя бы одним регионом", () => {
    const game = createGame("1946", "USA");
    const values = game.regions
      .map(r => majorityDiscontent(game, r))
      .filter((v): v is number => Number.isFinite(v));

    expect(values.length, "регионов с группой-большинством нет — мерить нечего").toBeGreaterThan(100);
    expect(
      Math.max(...values),
      `максимум недовольства большинства ниже SPLIT_MIN_DISCONTENT_STRICT — ` +
      `раскол невозможен ни при каком развитии партии`
    ).toBeGreaterThanOrEqual(SPLIT_MIN_DISCONTENT_STRICT);
  });

  it("мягкий порог отделения не превращает раскол в норму", () => {
    const game = createGame("1946", "USA");
    const values = game.regions
      .map(r => majorityDiscontent(game, r))
      .filter((v): v is number => Number.isFinite(v));
    const over = values.filter(v => v >= SPLIT_MIN_DISCONTENT_LOOSE).length;

    expect(over).toBeGreaterThan(0);
    expect(over / values.length, "раскол доступен слишком многим — порог не отбирает").toBeLessThan(0.1);
  });

  it("за десять лет партии пороги не выходят за достижимый диапазон", () => {
    const game = createGame("1946", "USA");
    for (let month = 0; month < 120; month++) simulateMonth(game);

    const values = game.regions.map(r => regionDiscontent(game, r)).filter((v): v is number => Number.isFinite(v));
    const over = values.filter(v => v >= REGION_CRISIS_DISCONTENT_THRESHOLD).length;

    // Дрейф может как поднять недовольство, так и погасить его; проверяется, что
    // порог остаётся живым в обе стороны, а не что число не изменилось.
    expect(over).toBeGreaterThan(0);
    expect(over / values.length).toBeLessThan(0.5);
  }, 120_000);
});
