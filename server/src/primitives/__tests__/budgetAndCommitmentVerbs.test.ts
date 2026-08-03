import { describe, it, expect, vi } from "vitest";
import { type GameState } from "@shared/types/GameState";
import {
  MAX_RESEARCH_SHARE,
  WAR_RESEARCH_SHARE_PENALTY,
  MIN_RESEARCH_SHARE_CAP,
} from "@shared/defines/research";
import { MAX_PRODUCTION_SHARE } from "@shared/defines/military";
import { MAX_EXTRACTION_LEVEL, EXTRACTION_BUILD_COST } from "@shared/defines/resources";
import { WarService } from "../../services/WarService";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { applyPrimitiveTurn } from "../turnBatch";
import { rejectionPromptText } from "../rejections";
import { parsePrimitives } from "../primitiveSchemas";
import * as resourceCommands from "../../commands/resources";
import {
  type AppliedBuildExtraction,
  type AppliedGuarantee,
  type AppliedProductionShift,
  type AppliedResearchShift,
  type Primitive,
} from "../types";
import {
  createDiscontentTestGame,
  TEST_REGION_NATIONAL,
  TEST_REGION_CONTROL,
} from "../../test-utils/discontentFixtures";

/**
 * Воздействия, переехавшие из старого канала `actions` в алфавит примитивов
 * (2026-08-02): `guarantee`, `research_shift`, `production_shift`,
 * `build_extraction`.
 *
 * Файл проверяет ЧЕТЫРЕ вещи и не смешивает их.
 *
 *   1. **Перенесённые предохранители.** Каждое правило старого канала обязано
 *      работать и здесь — и приходить структурным кодом, а не английской
 *      строкой валидатора. Это первая из трёх причин переноса
 *      (`docs/TODO.md`).
 *   2. **Проверку результата команды.** Вторая причина: `applyLlmActions`
 *      выбрасывал `CommandResult`, и действие «уже на потолке» доезжало до
 *      летописи применённым. Здесь отказ команды обязан откатывать примитив.
 *   3. **Величину от СОСТОЯНИЯ, а не от модели.** Старый контракт принимал
 *      `data.share: number`; коридор обязан считать долю сам и не выпускать её
 *      за потолок — включая потолок, снижаемый войной.
 *   4. **Правдивость результата.** Опубликованные `before`/`after` обязаны
 *      совпадать с состоянием мира: сверка (`reconciliation.ts`) откатывает
 *      примитив, соврaвший о числе, и здесь это проверяется на фактических
 *      величинах, а не на факте применения.
 *
 * Фикстура: играют за `SUN`, поэтому источником везде стоит `USA` — акты
 * государственной политики за игрока режиссёр не принимает
 * (`primitiveAgency.ts`), и примитив от имени `SUN` в ответе модели снимался бы
 * границей агентности раньше движка.
 */

const DOMAIN = "armor";

function game(): GameState {
  const state = createDiscontentTestGame();
  const usa = state.countries.find(c => c.id === "USA")!;
  usa.technology.domains = { [DOMAIN]: 0, naval: 0 };
  usa.economy.treasury = EXTRACTION_BUILD_COST * 10;
  return state;
}

function apply(state: GameState, primitive: Primitive) {
  return applyPrimitiveBatch(state, [primitive]);
}

function usaOf(state: GameState) {
  return state.countries.find(c => c.id === "USA")!;
}

const guaranteeUsaToSun: Primitive = {
  verb: "guarantee",
  sourceCountryId: "USA",
  target: { countryId: "SUN" },
};

function researchShift(params: Record<string, unknown> = {}): Primitive {
  return {
    verb: "research_shift",
    sourceCountryId: "USA",
    target: { countryId: "USA" },
    params: { domain: DOMAIN, ...params },
  } as Primitive;
}

/** Регион, который `USA` действительно контролирует, с залежью ниже потолка. */
function preparedExtractionRegion(state: GameState, regionId = TEST_REGION_CONTROL) {
  const region = state.regions.find(r => r.id === regionId)!;
  region.ownerCountryId = "USA";
  delete region.occupiedBy;
  region.deposits = { ...region.deposits, coal: 1 };
  region.extraction = { ...region.extraction, coal: 0 };
  return region;
}

function buildExtraction(regionId: number, params: Record<string, unknown> = {}): Primitive {
  return {
    verb: "build_extraction",
    sourceCountryId: "USA",
    target: { regionId },
    params: { resource: "coal", ...params },
  } as Primitive;
}

// --------------------------------------------------------------------------
// guarantee
// --------------------------------------------------------------------------

describe("guarantee: обязательство и его цена", () => {
  it("записывает гарантию и теплит отношения пары — величину переноса не изменили", () => {
    const state = game();

    const result = apply(state, guaranteeUsaToSun);

    expect(result.rejected).toEqual([]);
    expect(usaOf(state).diplomacy.guarantees).toContain("SUN");

    const applied = result.applied[0] as AppliedGuarantee;
    // Обе стороны названы, включая ту, что сдвинулась вдвое слабее: у
    // отношений гранулярность правдивости — пара (кто, о ком).
    expect(applied.relationEffects).toHaveLength(2);
    const forward = applied.relationEffects.find(e => e.fromCountryId === "USA")!;
    expect(forward.delta).toBeGreaterThan(0);
    // Отчёт совпадает с состоянием: иначе сверка откатила бы примитив.
    expect(forward.after).toBe(usaOf(state).diplomacy.relations["SUN"]);
  });

  it("ПРЕДОХРАНИТЕЛЬ: повторная гарантия отклоняется кодом, а не применяется второй раз", () => {
    // Перенос `LLMResponseValidator:125` («Guarantee already exists»). Без
    // него второй примитив прошёл бы и добавил ВТОРОЙ сдвиг отношений —
    // плоский шаг мимо коридора, ровно то, что общий слот пары закрывает.
    const state = game();
    apply(state, guaranteeUsaToSun);
    const relationAfterFirst = usaOf(state).diplomacy.relations["SUN"];

    const second = apply(state, guaranteeUsaToSun);

    expect(second.applied).toEqual([]);
    expect(second.rejected[0]!.rejection.code).toBe("guaranteeAlreadyGiven");
    expect(usaOf(state).diplomacy.relations["SUN"]).toBe(relationAfterFirst);
    // Причина ОБЪЯСНЯЕТ правило, а не называет код.
    expect(rejectionPromptText(second.rejected[0]!.rejection)).toContain("already guarantees");
  });

  it("ПРЕДОХРАНИТЕЛЬ: самогарантия отклоняется (перенос `noSelfTarget` из схемы)", () => {
    const state = game();

    const result = apply(state, {
      verb: "guarantee",
      sourceCountryId: "USA",
      target: { countryId: "USA" },
    });

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("bilateralSelfTarget");
    expect(usaOf(state).diplomacy.guarantees).not.toContain("USA");
  });

  it("делит слот пары с дипломатией: месяц по одной паре вмещает ОДИН мягкий акт", () => {
    // Свойство переноса, а не старого канала: гарантия пишет в ту же ячейку
    // `relations`, что `diplomacy`, и раздельные слоты позволили бы сложить
    // коридор дипломатии с плоским шагом гарантии за один месяц.
    const state = game();

    const result = applyPrimitiveTurn(
      state,
      [
        {
          verb: "diplomacy", sourceCountryId: "USA",
          target: { countryId: "SUN" }, params: { direction: "improve" },
        },
        guaranteeUsaToSun,
      ],
      "pair-slot"
    );

    expect(result.applied).toHaveLength(1);
    expect(result.rejected[0]!.rejection.code).toBe("targetTurnCapReached");
  });
});

// --------------------------------------------------------------------------
// research_shift / production_shift
// --------------------------------------------------------------------------

describe("research_shift: долю считает движок, а не модель", () => {
  it("двигает долю домена и заявляет ФАКТИЧЕСКОЕ значение", () => {
    const state = game();

    const result = apply(state, researchShift());

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0] as AppliedResearchShift;
    const actual = usaOf(state).technology.researchAllocation![DOMAIN]!;
    expect(actual).toBeGreaterThan(0);
    expect(applied.focusEffects[0]!.after).toBe(actual);
    expect(applied.focusEffects[0]!.delta).toBe(actual);
  });

  it("severe по пустому домену доводит фокус до потолка — возможности старого канала сохранены", () => {
    // Старый канал позволял выставить предельную долю одним действием. Перевод
    // не должен был отнять эту возможность — он должен был отнять у модели
    // право НАЗЫВАТЬ число.
    const state = game();

    apply(state, researchShift({ intensity: "severe" }));

    expect(usaOf(state).technology.researchAllocation![DOMAIN]!).toBeCloseTo(MAX_RESEARCH_SHARE, 6);
  });

  it("mild двигает заметно слабее severe — хинт работает ВНУТРИ коридора", () => {
    const mild = game();
    apply(mild, researchShift({ intensity: "mild" }));
    const severe = game();
    apply(severe, researchShift({ intensity: "severe" }));

    expect(usaOf(mild).technology.researchAllocation![DOMAIN]!).toBeLessThan(
      usaOf(severe).technology.researchAllocation![DOMAIN]!
    );
  });

  it("ПРЕДОХРАНИТЕЛЬ: потолок снижается за каждую активную войну (admin capacity)", () => {
    // Перенос `LLMResponseValidator.getResearchShareCap`. Роль изменилась —
    // раньше отклонял долю от модели, теперь ограничивает коридор, — но
    // наблюдаемое следствие обязано быть тем же: воюющая страна не получает
    // мирного потолка.
    const state = game();
    new WarService(state).declareWar("USA", "SUN");

    apply(state, researchShift({ intensity: "severe" }));

    const share = usaOf(state).technology.researchAllocation![DOMAIN]!;
    const wartimeCap = Math.max(
      MAX_RESEARCH_SHARE - WAR_RESEARCH_SHARE_PENALTY,
      MIN_RESEARCH_SHARE_CAP
    );
    expect(share).toBeCloseTo(wartimeCap, 6);
    expect(share).toBeLessThan(MAX_RESEARCH_SHARE);
  });

  it("коридор СХЛОПЫВАЕТСЯ на потолке: severe перестаёт отличаться от mild", () => {
    // Достижимое схлопывание — обязательное свойство каждого канала
    // (`magnitude.ts`): двигать в запрошенную сторону нечего.
    const state = game();
    usaOf(state).technology.researchAllocation = { [DOMAIN]: MAX_RESEARCH_SHARE };

    const result = apply(state, researchShift({ intensity: "severe" }));

    expect(result.rejected).toEqual([]);
    // Отказа НЕТ: «состояние не оставило места» — не «так не бывает», и
    // результат честно сообщает нулевую дельту (то же решение, что у
    // дипломатического блока).
    expect((result.applied[0] as AppliedResearchShift).focusEffects[0]!.delta).toBe(0);
    expect(usaOf(state).technology.researchAllocation![DOMAIN]!).toBe(MAX_RESEARCH_SHARE);
  });

  it("direction: away снимает фокус с домена", () => {
    const state = game();
    usaOf(state).technology.researchAllocation = { [DOMAIN]: MAX_RESEARCH_SHARE };

    apply(state, researchShift({ direction: "away", intensity: "severe" }));

    expect(usaOf(state).technology.researchAllocation![DOMAIN]!).toBe(0);
  });

  it("ПРЕДОХРАНИТЕЛЬ: домен, которого у страны нет, отклоняется и записи не создаёт", () => {
    // Перенос `LLMResponseValidator:62`. Без него движок завёл бы стране канал
    // бюджета, о котором мир не знает.
    const state = game();

    const result = apply(state, researchShift({ domain: "psionics" }));

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("unknownResearchDomain");
    expect(usaOf(state).technology.researchAllocation?.["psionics"]).toBeUndefined();
  });

  it("ПРЕДОХРАНИТЕЛЬ: чужой бюджет двигать нельзя", () => {
    const state = game();

    const result = apply(state, {
      verb: "research_shift",
      sourceCountryId: "USA",
      target: { countryId: "SUN" },
      params: { domain: DOMAIN },
    } as Primitive);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("focusNotDomestic");
    expect(state.countries.find(c => c.id === "SUN")!.technology.researchAllocation)
      .toBeUndefined();
  });

  it("числового поля в params не существует: `share` валит примитив СХЕМОЙ", () => {
    // Проверяется на слое схемы, а не движка: `applyPrimitiveBatch` принимает
    // уже разобранный примитив, и посторонний ключ до него не доезжает вовсе —
    // в этом и смысл `.strict()`. Именно так контракт машинно выражает правило
    // «модель не задаёт величины»: `share` не игнорируется, а валит запись.
    const { primitives, invalid } = parsePrimitives([
      {
        verb: "research_shift",
        sourceCountryId: "USA",
        target: { countryId: "USA" },
        params: { domain: DOMAIN, share: 0.9 },
      },
    ]);

    expect(primitives).toEqual([]);
    expect(invalid[0]!.verb).toBe("research_shift");
    expect(invalid[0]!.reason).toMatch(/share/);
  });
});

describe("production_shift: тот же коридор, ПЛОСКИЙ потолок", () => {
  const productionShift = (params: Record<string, unknown> = {}): Primitive =>
    ({
      verb: "production_shift",
      sourceCountryId: "USA",
      target: { countryId: "USA" },
      params: { equipmentType: "tanks", ...params },
    }) as Primitive;

  it("двигает долю категории и заявляет фактическое значение", () => {
    const state = game();

    const result = apply(state, productionShift({ intensity: "severe" }));

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0] as AppliedProductionShift;
    expect(usaOf(state).military.productionAllocation!.tanks!).toBeCloseTo(
      MAX_PRODUCTION_SHARE,
      6
    );
    expect(applied.focusEffects[0]!.after).toBe(usaOf(state).military.productionAllocation!.tanks!);
  });

  it("война потолок производства НЕ снижает — в отличие от исследований", () => {
    // Заявленное различие двух глаголов: война концентрирует производство, а
    // не распыляет его (`shared/defines/military.ts`).
    const state = game();
    new WarService(state).declareWar("USA", "SUN");

    apply(state, productionShift({ intensity: "severe" }));

    expect(usaOf(state).military.productionAllocation!.tanks!).toBeCloseTo(
      MAX_PRODUCTION_SHARE,
      6
    );
  });

  it("ПРЕДОХРАНИТЕЛЬ: выдуманная категория техники отклоняется и записи не создаёт", () => {
    const state = game();

    const result = apply(state, {
      verb: "production_shift",
      sourceCountryId: "USA",
      target: { countryId: "USA" },
      params: { equipmentType: "tanks" },
    } as Primitive);
    expect(result.rejected).toEqual([]);

    // Категория, которой у страны нет в `equipment`, — перенос
    // `LLMResponseValidator:76`. Схема принимает только реальные
    // `EquipmentType`, поэтому недостающую категорию воспроизводим состоянием.
    const armed = game();
    delete (usaOf(armed).military.equipment as Record<string, number>)["tanks"];

    const rejected = apply(armed, {
      verb: "production_shift",
      sourceCountryId: "USA",
      target: { countryId: "USA" },
      params: { equipmentType: "tanks" },
    } as Primitive);

    expect(rejected.applied).toEqual([]);
    expect(rejected.rejected[0]!.rejection.code).toBe("unknownEquipmentType");
    expect(usaOf(armed).military.productionAllocation).toBeUndefined();
  });

  it("сдвиг исследований и сдвиг производства в один месяц — законная пара", () => {
    // Ключ капа — (страна, предмет), а не страна: ячейки у них разные, и
    // запирать одно другим значило бы запрещать законную комбинацию.
    const state = game();

    const result = applyPrimitiveTurn(
      state,
      [researchShift(), productionShift()],
      "two-budgets"
    );

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------
// build_extraction
// --------------------------------------------------------------------------

describe("build_extraction: мощности и их цена", () => {
  it("строит один уровень и списывает казну — обе величины заявлены", () => {
    const state = game();
    const region = preparedExtractionRegion(state);
    const treasuryBefore = usaOf(state).economy.treasury;

    const result = apply(state, buildExtraction(region.id));

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0] as AppliedBuildExtraction;
    expect(region.extraction.coal).toBe(1);
    expect(applied.extractionEffects[0]!.after).toBe(1);
    expect(usaOf(state).economy.treasury).toBe(treasuryBefore - EXTRACTION_BUILD_COST);
    expect(applied.countryScalarEffects.some(e => e.field === "treasury")).toBe(true);
  });

  it("ПРЕДОХРАНИТЕЛЬ: потолок мощностей отклоняется, а НЕ рапортует успех", () => {
    // Две причины сразу. Первая — перенос `LLMResponseValidator:101`. Вторая и
    // главная: старый канал выбрасывал `CommandResult`, поэтому даже после
    // правки команды (2026-08-01) ложный успех мог доехать до летописи. Здесь
    // отказ команды откатывает примитив целиком.
    const state = game();
    const region = preparedExtractionRegion(state);
    region.extraction = { ...region.extraction, coal: MAX_EXTRACTION_LEVEL };
    const treasuryBefore = usaOf(state).economy.treasury;

    const result = apply(state, buildExtraction(region.id));

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("extractionAtMaximum");
    expect(region.extraction.coal).toBe(MAX_EXTRACTION_LEVEL);
    // Казна не тронута: отказ ловится ДО списания.
    expect(usaOf(state).economy.treasury).toBe(treasuryBefore);
  });

  it("ПРЕДОХРАНИТЕЛЬ: без контроля над регионом стройки нет", () => {
    const state = game();
    const region = preparedExtractionRegion(state);
    region.ownerCountryId = "SUN";

    const result = apply(state, buildExtraction(region.id));

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("regionNotControlled");
    expect(region.extraction.coal).toBe(0);
  });

  it("ПРЕДОХРАНИТЕЛЬ: без залежи мощности не строятся", () => {
    const state = game();
    const region = preparedExtractionRegion(state);
    region.deposits = {};

    const result = apply(state, buildExtraction(region.id));

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("noDepositInRegion");
    expect(region.extraction.coal).toBe(0);
  });

  it("ПРЕДОХРАНИТЕЛЬ: не хватает казны — отказ, а не отрицательный баланс", () => {
    const state = game();
    const region = preparedExtractionRegion(state);
    usaOf(state).economy.treasury = EXTRACTION_BUILD_COST / 2;

    const result = apply(state, buildExtraction(region.id));

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("extractionUnaffordable");
    expect(usaOf(state).economy.treasury).toBeGreaterThan(0);
    expect(region.extraction.coal).toBe(0);
  });

  it("снос: бесплатен, контроля не требует и заявляет пустую цену фактом", () => {
    const state = game();
    const region = preparedExtractionRegion(state, TEST_REGION_NATIONAL);
    region.extraction = { ...region.extraction, coal: 3 };
    // Земля потеряна — сворачивать собственную добычу это не мешает.
    region.ownerCountryId = "SUN";
    const treasuryBefore = usaOf(state).economy.treasury;

    const result = apply(state, buildExtraction(region.id, { direction: "dismantle" }));

    expect(result.rejected).toEqual([]);
    expect(region.extraction.coal).toBe(2);
    expect(usaOf(state).economy.treasury).toBe(treasuryBefore);
    expect((result.applied[0] as AppliedBuildExtraction).countryScalarEffects).toEqual([]);
  });

  it("ПРЕДОХРАНИТЕЛЬ: сворачивать нечего — отказ", () => {
    const state = game();
    const region = preparedExtractionRegion(state);

    const result = apply(state, buildExtraction(region.id, { direction: "dismantle" }));

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("noExtractionToDismantle");
  });

  it("ПРЕДОХРАНИТЕЛЬ: отказ КОМАНДЫ откатывает примитив, а не проходит молча", () => {
    // Второй закрытый пункт `docs/TODO.md` в чистом виде. Предпосылки движка
    // сегодня дублируют проверки команды, поэтому в обычной партии команда не
    // отказывает никогда — и «результат проверяется» проверить нечем. Отказ
    // подставляется намеренно: он воспроизводит ровно то, что старый канал
    // делал молча (`applyLlmActions` выбрасывал `CommandResult`), и защищает
    // от будущего расхождения предпосылки с командой.
    const state = game();
    const region = preparedExtractionRegion(state);
    const treasuryBefore = usaOf(state).economy.treasury;

    const spy = vi
      .spyOn(resourceCommands, "buildExtraction")
      .mockImplementation((_game, _countryId, _regionId, _resource, _delta) => ({
        success: false,
        error: "simulated command failure",
      }));

    try {
      const result = apply(state, buildExtraction(region.id));

      expect(result.applied).toEqual([]);
      expect(result.rejected[0]!.rejection.code).toBe("commandFailed");
      expect(region.extraction.coal).toBe(0);
      expect(usaOf(state).economy.treasury).toBe(treasuryBefore);
    } finally {
      spy.mockRestore();
    }
  });

  it("нефть и уголь в одном регионе — законная пара за месяц", () => {
    const state = game();
    const region = preparedExtractionRegion(state);
    region.deposits = { ...region.deposits, oil: 1 };
    region.extraction = { ...region.extraction, oil: 0 };

    const result = applyPrimitiveTurn(
      state,
      [buildExtraction(region.id), buildExtraction(region.id, { resource: "oil" })],
      "two-resources"
    );

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(2);
  });
});
