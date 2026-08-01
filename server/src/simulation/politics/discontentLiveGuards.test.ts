import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../SimulationEngine";
import { setRegionOccupation } from "../war/occupation";
import {
  regionDiscontent,
  regionWelfare,
  regionWelfareReference,
  regionAuthority,
  resolveIdeologyCoordinates,
  groupDiscontent,
  findImpactMemory,
} from "@shared/utils/discontent";
import {
  WELFARE_PARITY,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
  SPLIT_MIN_GROUP_SHARE,
  SPLIT_MIN_DISCONTENT_LOOSE,
  SPLIT_MIN_DISCONTENT_STRICT,
} from "@shared/defines/discontent";
import { splitDiscontentThreshold } from "../../primitives/polityLifecycle";
import { createDiscontentTestGame, TEST_REGION_NATIONAL } from "../../test-utils/discontentFixtures";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";

/**
 * Guard-тесты недовольства НА ЖИВЫХ ДАННЫХ 1946 — класс, которого не было.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ, а не дополнение `DiscontentTick.test.ts`. Тот меряет
 * формулу на мини-мире из трёх регионов, и именно поэтому пропустил три
 * дефекта, названных аудитом 2026-07-30: у подобранной фикстуры экономический
 * член обнулён НАМЕРЕННО, порогов восстания и отделения она не касается вовсе,
 * а оккупации в ней нет. «Вход мёртв у 38 % мира» и «порог недостижим» видны
 * только на 1399 настоящих регионах.
 *
 * ПОРОГИ ЗДЕСЬ ДВУСТОРОННИЕ. Нижняя граница ловит возврат мёртвой механики,
 * верхняя — противоположный провал: восстание и отделение обязаны остаться
 * РЕДКИМИ, иначе «порог берётся» выродится в «порог не значит ничего». Обе
 * границы сформулированы долями достижимого, а не снимками, и каждая проверена
 * на способность падать на восстановленном старом поведении — числа старого
 * поведения стоят в комментарии к каждому тесту (замер
 * `server/scripts/probeDiscontentHealth.ts`, 2026-08-01).
 */

/** Партия на живых данных сценария 1946; сид фиксирован — прогон детерминирован. */
function liveGame(months: number): GameState {
  const game = createGame("1946", "USA", "en", 1);
  for (let i = 0; i < months; i++) simulateMonth(game);
  return game;
}

function markedRegions(game: GameState): Region[] {
  return game.regions.filter(r => r.demographics && r.demographics.length > 0);
}

function discontentValues(game: GameState): number[] {
  return markedRegions(game)
    .map(r => regionDiscontent(game, r))
    .filter((v): v is number => v !== undefined);
}

/** Недовольство сильнейшей группы-БОЛЬШИНСТВА региона — величина, которую читает отделение. */
function majorityDiscontent(game: GameState, region: Region): number | undefined {
  const authority = regionAuthority(game, region);
  if (!authority) return undefined;
  const coordinates = resolveIdeologyCoordinates(authority.politics);
  const welfare = regionWelfare(region, regionWelfareReference(game, region));

  let best: number | undefined;
  for (const entry of region.demographics ?? []) {
    if (entry.share < SPLIT_MIN_GROUP_SHARE) continue;
    const definition = game.ethnicGroups.find(g => g.id === entry.groupId);
    if (!definition) continue;
    const value = groupDiscontent(
      coordinates,
      definition.desiredIdeology,
      welfare,
      findImpactMemory(game.groupImpactMemory, region.id, entry.groupId)
    );
    if (best === undefined || value > best) best = value;
  }
  return best;
}

describe("экономический вход недовольства ЖИВОЙ, а не мёртвый у трети мира", () => {
  /**
   * Фактический ВКЛАД экономики в недовольство региона: разница между регионом
   * как он есть и его клоном, посаженным ровно на подушевой ВВП своей страны.
   *
   * Меряется именно так, а не значением `regionWelfare`, намеренно: числовое
   * представление меры правкой изменилось (паритет переехал с 1 на 0.5), и
   * тест, читающий его напрямую, проверял бы представление, а не механику — он
   * не упал бы на восстановленном старом поведении. Разница недовольств
   * сравнима между обеими формулами: знак «плюс» = экономика ДОБАВЛЯЕТ
   * недовольство, «минус» = снимает, ноль = не делает ничего.
   */
  function economicContribution(game: GameState, region: Region): number | undefined {
    const reference = regionWelfareReference(game, region);
    if (!reference || reference.population <= 0 || region.population <= 0) return undefined;
    const perCapita = reference.economy.gdp / reference.population;
    if (perCapita <= 0) return undefined;

    const actual = regionDiscontent(game, region);
    // Клон, а не мутация состояния: `regionDiscontent` — чистая функция, ей
    // достаточно объекта региона (тот же приём, что в campaignSmoke.test.ts).
    const atParity = regionDiscontent(game, { ...region, gdp: region.population * perCapita });
    if (actual === undefined || atParity === undefined) return undefined;
    return actual - atParity;
  }

  /**
   * СТАРОЕ ПОВЕДЕНИЕ: `welfare = clamp01(отношение)` срезала весь верх шкалы, и
   * член `(1 − welfare)` был тождественным нулём у 536 регионов из 1399
   * (38,3 %) — 495 богаче своей страны плюс 41 регион, который сам является
   * своей страной. Сейчас ноль остаётся ровно у вторых: у страны из одного
   * региона паритет с самой собой верен по построению, а не дефект.
   */
  it("вклад экономики обнуляется у единиц процентов регионов, а не у трети", () => {
    const game = liveGame(0);
    const regions = markedRegions(game);
    const contributions = regions
      .map(r => economicContribution(game, r))
      .filter((v): v is number => v !== undefined);

    expect(contributions.length).toBeGreaterThan(1000);
    const dead = contributions.filter(v => Math.abs(v) < 1e-12).length;
    expect(
      dead / contributions.length,
      `Экономика не влияет на недовольство у ${dead} из ${contributions.length} регионов. ` +
        `Порог 5 %: выше — вход снова мёртв у заметной доли мира.`
    ).toBeLessThan(0.05);
  });

  /**
   * СТАРОЕ ПОВЕДЕНИЕ: экономика умела только ДОБАВЛЯТЬ недовольство — регион
   * богаче своей страны получал ровно то же, что регион ровно на среднем.
   * Направление вниз не существовало ни у одного из 1399 регионов.
   */
  it("благополучие региона СНИЖАЕТ недовольство, а не только бедность повышает", () => {
    const game = liveGame(0);
    const contributions = markedRegions(game)
      .map(r => economicContribution(game, r))
      .filter((v): v is number => v !== undefined);

    const relieved = contributions.filter(v => v < -1e-12).length;
    const penalised = contributions.filter(v => v > 1e-12).length;

    expect(
      relieved,
      "Ни один регион не получает скидки за опережение своей страны — мера снова односторонняя"
    ).toBeGreaterThan(0);
    expect(penalised).toBeGreaterThan(0);

    // Обе стороны существенны: доля любой из них ниже десятой части означала бы
    // двусторонность на бумаге.
    expect(relieved / contributions.length).toBeGreaterThan(0.1);
    expect(penalised / contributions.length).toBeGreaterThan(0.1);
  });

  /**
   * Насыщение не должно воспроизвести тот же дефект с другого края: мера,
   * упирающаяся в потолок у трети мира, ничем не лучше срезанного верха.
   */
  it("шкала не упирается в края у заметной доли регионов", () => {
    const game = liveGame(0);
    const regions = markedRegions(game);
    const welfare = regions.map(r => regionWelfare(r, regionWelfareReference(game, r)));

    const saturated = welfare.filter(w => w <= 0 || w >= 1).length;
    expect(
      saturated / regions.length,
      `В края упёрлись ${saturated} из ${regions.length} регионов`
    ).toBeLessThan(0.1);
  });
});

describe("оккупация не двигает ЭКОНОМИЧЕСКИЙ член недовольства", () => {
  /**
   * СТАРОЕ ПОВЕДЕНИЕ: благосостояние считалось против подушевого ВВП
   * ФАКТИЧЕСКОГО контролёра, тогда как агрегат контролёра оккупированный регион
   * не включает вовсе (`country.economy.gdp` собирается по `ownerCountryId`).
   * Бедный регион под богатой державой получал прибавку к недовольству
   * ниоткуда — и терял её скачком при освобождении.
   *
   * Здесь власть меняется (идеология оккупанта иная), поэтому недовольство
   * ОБЯЗАНО сдвинуться. Проверяется, что сдвиг пришёл из геометрии, а не из
   * подменённого знаменателя: экономический вход остаётся тем же числом.
   */
  it("ориентир благосостояния — легальный владелец, а не оккупант", () => {
    const game = createDiscontentTestGame();
    const region = game.regions.find(r => r.id === TEST_REGION_NATIONAL)!;

    const occupier = game.countries.find(c => c.id === "USA")!;
    // Оккупант ВТРОЕ богаче на душу: без опоры на владельца это одно
    // подушевого-ВВП различие целиком уехало бы в недовольство.
    occupier.population = region.population;
    occupier.economy = { ...occupier.economy, gdp: region.gdp * 3 };

    const welfareBefore = regionWelfare(region, regionWelfareReference(game, region));
    setRegionOccupation(game, region, "USA");
    const welfareAfter = regionWelfare(region, regionWelfareReference(game, region));

    expect(welfareAfter).toBeCloseTo(welfareBefore, 12);

    // И обратно: снятие оккупации тоже ничего не двигает в экономическом входе.
    setRegionOccupation(game, region, region.ownerCountryId);
    expect(regionWelfare(region, regionWelfareReference(game, region))).toBeCloseTo(
      welfareBefore,
      12
    );
  });
});

describe("пороги примитивов достижимы на живых данных", () => {
  /**
   * Порядок порогов — свойство дизайна («регион в кризисе ещё не восставший, а
   * восставший ещё не уходящий»), и держать его обязан тест, а не комментарий
   * в `defines/discontent.ts`.
   */
  it("пороги упорядочены и раздельны", () => {
    expect(SPAWN_INCIDENT_MIN_DISCONTENT).toBeLessThan(REGION_CRISIS_DISCONTENT_THRESHOLD);
    expect(REGION_CRISIS_DISCONTENT_THRESHOLD).toBeLessThan(SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT);
    expect(SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT).toBeLessThan(SPLIT_MIN_DISCONTENT_LOOSE);
    expect(SPLIT_MIN_DISCONTENT_LOOSE).toBeLessThan(SPLIT_MIN_DISCONTENT_STRICT);
  });

  /**
   * СТАРОЕ ПОВЕДЕНИЕ: порог восстания брали 2 региона из 1399 (0,14 %) — то
   * есть `incidentKind: "uprising"` был мёртвой веткой контракта. Сейчас 17–18
   * (1,2 %).
   *
   * Граница снизу — 0,5 % размеченных регионов: старое поведение её не берёт
   * втрое, а обычная перекалибровка не роняет. Граница сверху — 10 %: восстание
   * обязано остаться редким, иначе порог перестаёт что-либо отбирать.
   */
  it("порог восстания берут не единицы регионов и не каждый десятый", () => {
    for (const months of [0, 12]) {
      const game = liveGame(months);
      const values = discontentValues(game);
      const above = values.filter(v => v >= SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT).length;

      expect(
        above / values.length,
        `Месяц ${months}: порог восстания ${SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT} берут ` +
          `${above} из ${values.length} регионов — ветка "uprising" снова мертва`
      ).toBeGreaterThan(0.005);
      expect(
        above / values.length,
        `Месяц ${months}: порог восстания берут ${above} из ${values.length} регионов — ` +
          `восстание перестало быть редким`
      ).toBeLessThan(0.1);
    }
  });

  /**
   * СТАРОЕ ПОВЕДЕНИЕ: САМЫЙ СТРОГИЙ порог отделения (`intensity: mild`,
   * фактическое значение 0,82) не брал НИ ОДИН регион мира — максимум
   * недовольства группы-большинства был 0,818. Верх коридора был декоративен:
   * из трёх значений хинта работали два.
   *
   * Мерится именно недовольство группы-большинства, а не региона: `split_country`
   * читает `separatistGroupOf`, и региональное среднее здесь — не та величина.
   */
  it("даже строжайший порог отделения достижим хотя бы одним регионом", () => {
    const game = liveGame(0);
    const strictest = splitDiscontentThreshold("mild");

    const majority = markedRegions(game)
      .map(r => majorityDiscontent(game, r))
      .filter((v): v is number => v !== undefined);

    const above = majority.filter(v => v >= strictest);
    expect(
      above.length,
      `Строжайший порог отделения ${strictest.toFixed(3)} не берёт ни один регион ` +
        `(максимум по миру ${Math.max(...majority).toFixed(4)}) — верх коридора хинта декоративен`
    ).toBeGreaterThan(0);

    // И сверху: отделение обязано остаться исключительным событием.
    const loose = majority.filter(v => v >= splitDiscontentThreshold("severe"));
    expect(
      loose.length / majority.length,
      `Порог отделения при severe берут ${loose.length} из ${majority.length} регионов`
    ).toBeLessThan(0.05);
  });
});

describe("недовольство не сводится к идеологии власти в пределах одной страны", () => {
  /**
   * ЧТО ЭТОТ ТЕСТ ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Он держит вклад ВТОРОГО входа:
   * регионы под ОДНОЙ И ТОЙ ЖЕ властью обязаны различаться, иначе недовольство
   * — функция одной страновой координаты и ничего больше.
   *
   * Межстрановая одномерность (R = −0,89 между политической координатой власти
   * и средним недовольством её регионов) этим НЕ лечится и лечиться формулой не
   * может: причина в данных каталога — `desiredIdeology.political > 0` у 431
   * группы из 460 (93,7 %), среднее по экономической оси −0,009. Замер и
   * отвергнутые кандидаты во второй вход — в `docs/TODO.md`.
   */
  it("у регионов одной страны с одинаковым составом недовольство различается", () => {
    const game = liveGame(0);

    const byOwnerAndComposition = new Map<string, number[]>();
    for (const region of markedRegions(game)) {
      const discontent = regionDiscontent(game, region);
      if (discontent === undefined) continue;
      // Ключ — власть + точный демо-состав: всё, что осталось различного внутри
      // группы, идёт НЕ от идеологической геометрии.
      const composition = [...region.demographics!]
        .map(e => `${e.groupId}:${e.share.toFixed(4)}`)
        .sort()
        .join("|");
      const key = `${region.ownerCountryId}#${composition}`;
      const list = byOwnerAndComposition.get(key);
      if (list) list.push(discontent);
      else byOwnerAndComposition.set(key, [discontent]);
    }

    const groupsWithSiblings = [...byOwnerAndComposition.values()].filter(v => v.length > 1);
    expect(groupsWithSiblings.length).toBeGreaterThan(10);

    const varying = groupsWithSiblings.filter(v => Math.max(...v) - Math.min(...v) > 1e-9);
    expect(
      varying.length / groupsWithSiblings.length,
      `Одинаковый состав под одной властью даёт одинаковое недовольство у ` +
        `${groupsWithSiblings.length - varying.length} наборов из ${groupsWithSiblings.length} — ` +
        `второй вход снова ничего не решает`
    ).toBeGreaterThan(0.9);
  });
});
