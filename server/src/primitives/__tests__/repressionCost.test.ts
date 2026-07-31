import { describe, it, expect } from "vitest";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { type Primitive } from "../types";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../../simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";
import { regionDiscontent } from "@shared/utils/discontent";
import { effectiveController } from "@shared/utils/regionControl";
import {
  MAX_SOFT_PRIMITIVES_PER_TURN,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
} from "@shared/defines/discontent";
import {
  createDiscontentTestGame,
  TEST_GROUP_LOYAL,
  TEST_REGION_NATIONAL,
} from "../../test-utils/discontentFixtures";

/**
 * ЦЕНА РЕПРЕССИИ (docs/TODO.md, P1 «Репрессия бесплатна и доминирует»;
 * `.agent/audits/formula-audit-2026-07-30.md`).
 *
 * Что было измерено ДО правки на живом сценарии 1946 (120 месяцев, СССР,
 * 174 размеченных региона) и почему этот файл появился:
 *
 *   - 1200 применений `repress` против бездействия давали Δlegitimacy =
 *     Δstability = ΔgovernmentSupport = Δtreasury = 0 БИТ-В-БИТ. Акт силы не
 *     стоил государству ничего вообще;
 *   - а вот заявление аудита «постоянная репрессия держит регион на нуле
 *     недовольства бесконечно» замером НЕ подтвердилось: равновесие самого
 *     напряжённого региона СССР под непрерывной репрессией — 0,564 против
 *     0,671 у бездействия, то есть регион остаётся ВЫШЕ кризисного порога.
 *     Аудит считал по пиковому `suppression` 0,95, но тик гасит его на четверть
 *     в месяц, и равновесие после затухания — 0,750, не 0,95.
 *
 * Отсюда форма правки: канал недовольства за репрессию УЖЕ платит (отчуждение),
 * не платила СТРАНА. Цена назначена в легитимности — см.
 * `REPRESS_LEGITIMACY_COST_MIN/MAX`.
 */

describe("репрессия стоит мандата: одно применение", () => {
  it("списывает легитимность контролёра и заявляет это в результате", () => {
    const game = createDiscontentTestGame();
    const before = game.countries.find(c => c.id === "SUN")!.politics.legitimacy;

    const result = applyPrimitiveBatch(game, [
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
    ]);

    expect(result.rejected).toHaveLength(0);
    const applied = result.applied[0]!;
    expect(applied.verb).toBe("repress");

    const after = game.countries.find(c => c.id === "SUN")!.politics.legitimacy;
    expect(
      after,
      "легитимность не сдвинулась: применение силы снова ничего не стоит государству"
    ).toBeLessThan(before);

    // Отчёт обязан заявить ровно то, что произошло с состоянием: сверка
    // (`reconciliation.ts`) откатила бы примитив за молчание, но здесь важно и
    // то, что заявление ЧИСЛЕННО совпадает с дифом, а не просто существует.
    if (applied.verb !== "repress") throw new Error("недостижимо");
    const legitimacyEffects = applied.countryScalarEffects.filter(e => e.field === "legitimacy");
    expect(legitimacyEffects).toHaveLength(1);
    expect(legitimacyEffects[0]!.countryId).toBe("SUN");
    expect(legitimacyEffects[0]!.before).toBe(before);
    expect(legitimacyEffects[0]!.after).toBe(after);
  });

  it("точечный удар по меньшинству дешевле сплошного по всему региону", () => {
    // Свойство, а не число: необязательный `groupId` в цели обязан что-то
    // значить. Доли групп фикстуры сюда не вписаны — берётся та, что есть.
    const cost = (target: Primitive["target"]): number => {
      const game = createDiscontentTestGame();
      const before = game.countries.find(c => c.id === "SUN")!.politics.legitimacy;
      const result = applyPrimitiveBatch(game, [
        { verb: "repress", sourceCountryId: "SUN", target } as Primitive,
      ]);
      expect(result.rejected).toHaveLength(0);
      return before - game.countries.find(c => c.id === "SUN")!.politics.legitimacy;
    };

    const minority = cost({ regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_LOYAL });
    const wholeRegion = cost({ regionId: TEST_REGION_NATIONAL });

    expect(minority).toBeGreaterThan(0);
    expect(
      minority,
      "удар по меньшинству стоит не меньше сплошной репрессии всего региона — " +
        "тогда указывать группу в цели незачем"
    ).toBeLessThan(wholeRegion);
  });

  it("режиму без мандата репрессия не отказывается, но и стоить перестаёт", () => {
    // Легитимность — положение, а не расходуемый ресурс: режим не вправе
    // отказаться терять репутацию на том основании, что её нет (то же решение,
    // что у `condemn`). Цена клампится полом шкалы, примитив проходит.
    const game = createDiscontentTestGame();
    game.countries.find(c => c.id === "SUN")!.politics.legitimacy = 0;

    const result = applyPrimitiveBatch(game, [
      { verb: "repress", sourceCountryId: "SUN", target: { regionId: TEST_REGION_NATIONAL } },
    ]);

    expect(result.rejected).toHaveLength(0);
    expect(game.countries.find(c => c.id === "SUN")!.politics.legitimacy).toBe(0);
    const applied = result.applied[0]!;
    if (applied.verb !== "repress") throw new Error("недостижимо");
    // Ноль дельты сообщается отсутствием записи, а не выдуманным нулём: диф
    // снимков не заводит ячейку там, где ничего не сдвинулось.
    expect(applied.countryScalarEffects.filter(e => e.field === "legitimacy")).toHaveLength(0);
    // При этом сам акт состоялся — след в памяти воздействий есть.
    expect(applied.targetEffects.length).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// Сравнение траекторий на ЖИВЫХ данных
// --------------------------------------------------------------------------

/**
 * Горизонт. 120 месяцев — не «побольше», а срок, на котором обе постоянные
 * времени успевают отработать: `alienation` насыщается за ~12 месяцев, а
 * легитимность дрейфует к базису со скоростью 0,005/мес (полураспад ~138 мес),
 * то есть накопленная цена мандата видна только на годах. На горизонте в год
 * стратегии по легитимности почти не различались бы.
 */
const HORIZON_MONTHS = 120;

/**
 * Запасы различимости. Не «сколько получилось», а сколько нужно, чтобы разница
 * не была шумом представления double и не исчезла от следующей калибровки
 * коридоров. Замер 2026-07-31 даёт разрывы много больше: 16,6 пункта
 * легитимности, 22 кризисных региона, 0,044 недовольства.
 */
const LEGITIMACY_MARGIN = 1;
const DISCONTENT_MARGIN = 0.02;

interface Trajectory {
  legitimacy: number;
  regionsInCrisis: number;
  meanDiscontent: number;
  treasury: number;
  applied: number;
}

/** Регионы страны, у которых есть демографическая разметка, с их недовольством. */
function rankedRegions(game: GameState, countryId: string) {
  return game.regions
    .filter(
      r => r.demographics && r.demographics.length > 0 && effectiveController(r) === countryId
    )
    .map(r => ({ id: r.id, discontent: regionDiscontent(game, r) ?? 0 }))
    .sort((a, b) => b.discontent - a.discontent);
}

/**
 * Страна прогона выбирается ПО ДАННЫМ, а не по имени: та, у которой больше
 * всего размеченных регионов. Захардкоженный id пережил бы не всякое
 * наполнение демографии (`scripts/map/AGENTS.md`, каскад идентификаторов), а
 * «кому есть кого подавлять» — свойство, которое переживёт.
 */
function pickCountryWithMostMarkedRegions(): string {
  const probe = createGame("1946", "USA");
  const counts = new Map<string, number>();
  for (const region of probe.regions) {
    if (!region.demographics || region.demographics.length === 0) continue;
    const controller = effectiveController(region);
    counts.set(controller, (counts.get(controller) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best) throw new Error("В сценарии 1946 нет ни одного размеченного демографией региона");
  return best[0];
}

type Strategy = (game: GameState, countryId: string) => Primitive[];

/** «Давить всегда»: весь бюджет хода уходит в силу, каждый месяц, без пауз. */
const alwaysRepress: Strategy = (game, countryId) =>
  rankedRegions(game, countryId)
    .slice(0, MAX_SOFT_PRIMITIVES_PER_TURN)
    .map(t => ({
      verb: "repress",
      sourceCountryId: countryId,
      target: { regionId: t.id },
      params: { intensity: "severe" },
    }));

/**
 * Смешанная: сила — только там, где регион уже перешёл кризисный порог, и не
 * больше двух регионов за ход; остальной бюджет уходит на уступки.
 *
 * Это НЕ «репрессий поменьше»: репрессия здесь остаётся в наборе и применяется
 * ровно там, где по механике осмысленна. Сравниваются две живые стратегии, а не
 * стратегия против бездействия.
 */
const mixed: Strategy = (game, countryId) => {
  const list = rankedRegions(game, countryId);
  const crises = list.filter(t => t.discontent >= REGION_CRISIS_DISCONTENT_THRESHOLD).slice(0, 2);
  const calm = list
    .filter(t => !crises.some(c => c.id === t.id))
    .slice(0, MAX_SOFT_PRIMITIVES_PER_TURN - crises.length);
  return [
    ...crises.map(t => ({
      verb: "repress" as const,
      sourceCountryId: countryId,
      target: { regionId: t.id },
      params: { intensity: "moderate" as const },
    })),
    ...calm.map(t => ({
      verb: "grant_autonomy" as const,
      sourceCountryId: countryId,
      target: { regionId: t.id },
      params: { intensity: "moderate" as const },
    })),
  ];
};

function runStrategy(countryId: string, strategy: Strategy): Trajectory {
  const game = createGame("1946", countryId);
  let applied = 0;

  for (let month = 1; month <= HORIZON_MONTHS; month++) {
    const batch = strategy(game, countryId);
    if (batch.length > 0) applied += applyPrimitiveBatch(game, batch).applied.length;
    simulateMonth(game);
  }

  const list = rankedRegions(game, countryId);
  const country = game.countries.find(c => c.id === countryId)!;
  return {
    legitimacy: country.politics.legitimacy,
    regionsInCrisis: list.filter(t => t.discontent >= REGION_CRISIS_DISCONTENT_THRESHOLD).length,
    meanDiscontent: list.reduce((sum, t) => sum + t.discontent, 0) / Math.max(1, list.length),
    treasury: country.economy.treasury,
    applied,
  };
}

describe("«давить всегда» проигрывает смешанной стратегии на длинной дистанции", () => {
  it(
    `сравнивает две траектории на реальном сценарии 1946 за ${HORIZON_MONTHS} месяцев`,
    () => {
      const countryId = pickCountryWithMostMarkedRegions();
      const always = runStrategy(countryId, alwaysRepress);
      const balanced = runStrategy(countryId, mixed);

      // Тест существует и ради того, чтобы траектории было ВИДНО, а не только
      // ради pass/fail: следующая калибровка коридоров читает эти числа.
      console.log(
        `\n=== ${countryId}, ${HORIZON_MONTHS} месяцев ===\n` +
        `  давить всегда: legitimacy ${always.legitimacy.toFixed(2)}, ` +
        `кризисных регионов ${always.regionsInCrisis}, ` +
        `недовольство ${always.meanDiscontent.toFixed(4)}, ` +
        `казна ${(always.treasury / 1e9).toFixed(1)}B (${always.applied} примитивов)\n` +
        `  смешанная:     legitimacy ${balanced.legitimacy.toFixed(2)}, ` +
        `кризисных регионов ${balanced.regionsInCrisis}, ` +
        `недовольство ${balanced.meanDiscontent.toFixed(4)}, ` +
        `казна ${(balanced.treasury / 1e9).toFixed(1)}B (${balanced.applied} примитивов)`
      );

      // Обе стратегии обязаны быть ЖИВЫМИ: сравнение траекторий, из которых одна
      // не состоялась, ничего не доказывает.
      expect(always.applied).toBeGreaterThan(0);
      expect(balanced.applied).toBeGreaterThan(0);

      // --- Метрика 1: устойчивость власти ---
      expect(
        always.legitimacy,
        `Легитимность после ${HORIZON_MONTHS} месяцев непрерывной репрессии ` +
          `(${always.legitimacy.toFixed(2)}) не ниже, чем у смешанной стратегии ` +
          `(${balanced.legitimacy.toFixed(2)}). Значит, применение силы снова ничего не ` +
          `стоит режиму — ровно то состояние, ради выхода из которого заведён канал ` +
          `REPRESS_LEGITIMACY_COST_* (shared/src/defines/discontent.ts).`
      ).toBeLessThan(balanced.legitimacy - LEGITIMACY_MARGIN);

      // --- Метрика 2: отсутствие восстаний ---
      // ЧТО ИМЕННО ЗДЕСЬ НЕГАТИВНЫЙ КОНТРОЛЬ, названо прямо. На восстановленном
      // старом поведении (списание легитимности отключено) падает утверждение
      // выше и только оно: замер 2026-07-31 даёт там legitimacy 58,30 у ОБЕИХ
      // стратегий, но кризисов уже 24 против 2 и недовольство 0,3838 против
      // 0,3294. То есть две метрики ниже пинят СУЩЕСТВОВАВШЕЕ до этой правки
      // свойство — отложенную цену через отчуждение, — и от цены мандата не
      // зависят. Они здесь не для украшения: без них тест утверждал бы, что
      // «давить всегда» проигрывает, проверив ровно одну ось из трёх.
      expect(
        always.regionsInCrisis,
        `Непрерывная репрессия оставила ${always.regionsInCrisis} кризисных регионов против ` +
          `${balanced.regionsInCrisis} у смешанной стратегии — сила перестала быть ` +
          `отложенной ценой («загнал вглубь», ALIENATION_DISTANCE_WEIGHT).`
      ).toBeGreaterThan(balanced.regionsInCrisis);

      // --- Метрика 3: недовольство в среднем по стране ---
      expect(
        always.meanDiscontent,
        `Среднее недовольство при непрерывной репрессии ${always.meanDiscontent.toFixed(4)} не ` +
          `выше, чем у смешанной ${balanced.meanDiscontent.toFixed(4)}: две стратегии ` +
          `неразличимы по главному наблюдаемому.`
      ).toBeGreaterThan(balanced.meanDiscontent + DISCONTENT_MARGIN);

      // --- Метрика «доход»: НАБЛЮДЕНИЕ, а не требование ---
      // Казна у обеих траекторий совпадает бит-в-бит, и это факт о модели, а не
      // о репрессии: экономика сегодня не читает внутреннюю политику вовсе
      // (`EconomyTick` не смотрит ни на легитимность, ни на недовольство).
      // Утверждать по доходу здесь нечего, и молчать об этом тоже нельзя —
      // иначе «проигрывает по любой разумной метрике» звучало бы сильнее, чем
      // проверено. Печатается, чтобы разрыв этой связи был виден, когда его
      // начнут закрывать.
      if (always.treasury === balanced.treasury) {
        console.log(
          "  [наблюдение] казна обеих траекторий совпадает точно: экономика не реагирует " +
          "на внутреннюю политику — по доходу стратегии не различаются в принципе."
        );
      }
    },
    300_000
  );
});
