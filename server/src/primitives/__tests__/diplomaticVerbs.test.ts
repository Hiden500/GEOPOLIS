import { describe, it, expect, vi } from "vitest";
import { type GameState } from "@shared/types/GameState";
import {
  RELATION_SCALE_MIN,
  RELATION_SCALE_MAX,
  DIPLOMACY_RELATION_MIN,
  DIPLOMACY_RELATION_MAX,
  WAR_DECLARATION_RELATION_PENALTY,
  PEACE_RELATION_RELIEF,
  MAX_WAR_GOAL_LENGTH,
} from "@shared/defines/diplomacy";
import { TRADE_CUTTING_SANCTION } from "@shared/types/DiplomacyState";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { applyPrimitiveTurn } from "../turnBatch";
import { parsePrimitives } from "../primitiveSchemas";
import {
  type AppliedDiplomacy,
  type AppliedPeace,
  type AppliedSanction,
  type AppliedWar,
  type Primitive,
  type RejectedPrimitive,
} from "../types";
import { rejectionPromptText } from "../rejections";
import * as diplomacyCommands from "../../commands/diplomacy";
import { WarService } from "../../services/WarService";
import { createDiscontentTestGame } from "../../test-utils/discontentFixtures";

/**
 * Дипломатический блок алфавита (Милстоун 1): `diplomacy`, `sanction`, `war`,
 * `peace`.
 *
 * Файл проверяет ДВЕ разные вещи и не смешивает их:
 *
 *   1. **Функциональность, унаследованную от удалённых типов старого канала.**
 *      Симметрия сдвига отношений, обвал при объявлении войны, создание и
 *      закрытие настоящей `War`, сохранение `warGoal`, вид санкции по умолчанию
 *      и явный. Это долг перед удалением: контракт снят только там, где новый
 *      покрывает функциональность ПОЛНОСТЬЮ, а не «в основном».
 *
 *   2. **То, чего старый канал не умел вовсе** — величину задаёт СОСТОЯНИЕ, а
 *      не модель, и её нельзя обойти ни хинтом, ни частотой, ни сменой глагола.
 *      Ради этого блок и переводился: `diplomacy` принимал `relationChange`
 *      числом, то есть модель прямо задавала магнитуду.
 *
 * Пороги и коридоры берутся из констант, идентификаторы — из фикстуры: тест
 * проверяет свойство, а не снимок.
 */

const SOURCE = "SUN";
const TARGET = "USA";

function game(): GameState {
  return createDiscontentTestGame();
}

function relation(state: GameState, from: string, to: string): number {
  return state.countries.find(c => c.id === from)!.diplomacy.relations[to] ?? 0;
}

function setRelation(state: GameState, from: string, to: string, value: number): void {
  state.countries.find(c => c.id === from)!.diplomacy.relations[to] = value;
}

function promptTextOf(rejected: RejectedPrimitive): string {
  return rejectionPromptText(rejected.rejection);
}

function diplomacy(
  direction: "improve" | "worsen",
  intensity?: "mild" | "moderate" | "severe"
): Primitive {
  return {
    verb: "diplomacy",
    sourceCountryId: SOURCE,
    target: { countryId: TARGET },
    params: { direction, ...(intensity ? { intensity } : {}) },
  };
}

// --------------------------------------------------------------------------
// diplomacy — коридор от состояния, позиция от хинта
// --------------------------------------------------------------------------

describe("diplomacy: величину задаёт состояние пары, а не модель", () => {
  it("сдвиг всегда лежит внутри объявленного коридора, каким бы ни был хинт", () => {
    // Главное свойство перевода. Старый канал принимал `relationChange` числом
    // и клампил его капом ±40; здесь числа от модели нет вовсе, и «жёстко»
    // не выталкивает эффект за коридор ничем.
    for (const intensity of ["mild", "moderate", "severe"] as const) {
      const state = game();
      const result = applyPrimitiveBatch(state, [diplomacy("improve", intensity)]);

      expect(result.rejected).toEqual([]);
      const delta = relation(state, SOURCE, TARGET);
      expect(delta).toBeGreaterThanOrEqual(DIPLOMACY_RELATION_MIN);
      expect(delta).toBeLessThanOrEqual(DIPLOMACY_RELATION_MAX);
    }
  });

  it("«жёстко» сильнее «мягко» — но только там, где состояние оставило место", () => {
    const mild = game();
    applyPrimitiveBatch(mild, [diplomacy("improve", "mild")]);
    const severe = game();
    applyPrimitiveBatch(severe, [diplomacy("improve", "severe")]);

    expect(relation(severe, SOURCE, TARGET)).toBeGreaterThan(relation(mild, SOURCE, TARGET));
  });

  it("КОРИДОР СХЛОПЫВАЕТСЯ: на краю шкалы `severe` не отличается от `mild`", () => {
    // Контракт `magnitude.ts` требует, чтобы схлопывание было ДОСТИЖИМО у
    // каждого канала, иначе модель в любом мире владеет фиксированной долей
    // коридора. У дипломатии условие названо точно: отношения на границе шкалы
    // в сторону запрошенного жеста — улучшать нечего.
    const results = (["mild", "severe"] as const).map(intensity => {
      const state = game();
      setRelation(state, SOURCE, TARGET, RELATION_SCALE_MAX);
      applyPrimitiveBatch(state, [diplomacy("improve", intensity)]);
      return relation(state, SOURCE, TARGET);
    });

    expect(results[0]).toBe(results[1]);
    // И это именно потолок, а не «эффекта не было по другой причине»: шкала
    // уже на максимуме, добавлять некуда.
    expect(results[0]).toBe(RELATION_SCALE_MAX);
  });

  it("ОТНОШЕНИЕ severe/mild — не константа: доля коридора зависит от состояния", () => {
    // Проверка выше сама по себе СЛАБАЯ, и это выяснил негативный контроль:
    // ровно на краю шкалы `severe` и `mild` совпадают и при коридоре-константе,
    // потому что итог там режет кламп шкалы, а не коридор. Отличить «коридор
    // схлопнулся» от «шкала упёрлась» можно только вдали от края — по тому,
    // МЕНЯЕТСЯ ЛИ доля, которой владеет хинт, вместе с состоянием.
    //
    // Именно это и есть содержательное утверждение `magnitude.ts`: «отношение
    // severe/mild перестаёт быть константой». При коридоре-константе оно
    // постоянно в любом мире, и тест обязан это увидеть.
    const ratioAt = (current: number): number => {
      const of = (intensity: "mild" | "severe"): number => {
        const state = game();
        setRelation(state, SOURCE, TARGET, current);
        applyPrimitiveBatch(state, [diplomacy("improve", intensity)]);
        return relation(state, SOURCE, TARGET) - current;
      };
      return of("severe") / of("mild");
    };

    const roomy = ratioAt(0);
    // Место ещё есть (кламп не участвует), но его заметно меньше.
    const tight = ratioAt(RELATION_SCALE_MAX * 0.6);

    // Зазор требуется СОДЕРЖАТЕЛЬНЫЙ, а не любой, и это тоже находка
    // негативного контроля: при коридоре-константе оба отношения равны
    // «на бумаге», но в double расходятся на ~2e-15 — и голое
    // `toBeGreaterThan` такую разницу принимает за настоящую. Порог 1.1
    // с запасом ниже фактических 1.62 / 1.27 и с запасом выше шума.
    expect(roomy / tight).toBeGreaterThan(1.1);
  });

  it("состояние двигает ширину коридора: связанная пара сдвигается сильнее далёкой", () => {
    // Свойство, ради которого фактор вообще существует. Сравниваются два мира,
    // отличающиеся РОВНО ОДНИМ входом — формальной связью, — при одинаковом
    // хинте.
    const distant = game();
    applyPrimitiveBatch(distant, [diplomacy("improve", "severe")]);

    const tied = game();
    tied.countries.find(c => c.id === SOURCE)!.diplomacy.sphereOfInfluence.push(TARGET);
    applyPrimitiveBatch(tied, [diplomacy("improve", "severe")]);

    expect(relation(tied, SOURCE, TARGET)).toBeGreaterThan(relation(distant, SOURCE, TARGET));
  });

  it("идущая война гасит дружественный жест и НЕ гасит враждебный", () => {
    const peaceful = game();
    applyPrimitiveBatch(peaceful, [diplomacy("improve", "severe")]);

    const atWar = game();
    new WarService(atWar).declareWar(SOURCE, TARGET);
    applyPrimitiveBatch(atWar, [diplomacy("improve", "severe")]);

    expect(relation(atWar, SOURCE, TARGET)).toBeLessThan(relation(peaceful, SOURCE, TARGET));

    // Враждебный жест войной не гасится: ухудшать отношения с тем, с кем
    // воюешь, война не мешает.
    const worsenPeaceful = game();
    applyPrimitiveBatch(worsenPeaceful, [diplomacy("worsen", "severe")]);
    const worsenAtWar = game();
    new WarService(worsenAtWar).declareWar(SOURCE, TARGET);
    applyPrimitiveBatch(worsenAtWar, [diplomacy("worsen", "severe")]);

    expect(relation(worsenAtWar, SOURCE, TARGET)).toBe(relation(worsenPeaceful, SOURCE, TARGET));
  });

  it("сдвиг несимметричен: адресат получает половину — поведение старого канала сохранено", () => {
    const state = game();
    applyPrimitiveBatch(state, [diplomacy("improve", "severe")]);

    expect(relation(state, TARGET, SOURCE)).toBeCloseTo(relation(state, SOURCE, TARGET) / 2, 10);
  });

  it("результат называет ОБЕ стороны, включая нулевую", () => {
    const state = game();
    setRelation(state, SOURCE, TARGET, RELATION_SCALE_MAX);
    setRelation(state, TARGET, SOURCE, RELATION_SCALE_MAX);

    const result = applyPrimitiveBatch(state, [diplomacy("improve", "severe")]);
    const applied = result.applied[0] as AppliedDiplomacy;

    expect(applied.relationEffects).toHaveLength(2);
    expect(applied.relationEffects.every(e => e.delta === 0)).toBe(true);
    // Умолчать о стороне резюме не вправе: иначе нарратив получил бы
    // симметрию, которой не было.
    expect(applied.summary).toContain("unchanged");
  });

  it("направление обязательно: движок не угадывает намерение", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "diplomacy", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);

    expect(result.applied).toEqual([]);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/params\.direction/);
  });

  it("числовое поле в params — ошибка СХЕМЫ, а не молча отброшенное поле", () => {
    const { primitives, invalid } = parsePrimitives([
      {
        verb: "diplomacy",
        sourceCountryId: SOURCE,
        target: { countryId: TARGET },
        params: { direction: "improve", relationChange: 40 },
      },
    ]);

    expect(primitives).toHaveLength(0);
    expect(invalid[0]!.verb).toBe("diplomacy");
    expect(invalid[0]!.reason).toMatch(/relationChange/);
  });

  it.each(["diplomacy", "sanction", "war", "peace"] as const)(
    "%s: цель, равная источнику, отклоняется",
    verb => {
      const state = game();
      const result = applyPrimitiveBatch(state, [
        { verb, sourceCountryId: SOURCE, target: { countryId: SOURCE }, ...(verb === "diplomacy"
          ? { params: { direction: "improve" as const } }
          : {}) } as Primitive,
      ]);

      expect(result.applied).toEqual([]);
      expect(promptTextOf(result.rejected[0]!)).toMatch(/other than the source/);
    }
  );
});

// --------------------------------------------------------------------------
// sanction
// --------------------------------------------------------------------------

describe("sanction", () => {
  it("записывает режим и бьёт по отношениям величиной из коридора", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "sanction", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);

    expect(result.rejected).toEqual([]);
    // Вид по умолчанию — тот же, что был у старого канала: неуточнённая
    // санкция не должна оказываться сильнейшей мерой.
    expect(state.countries.find(c => c.id === SOURCE)!.diplomacy.sanctions[TARGET])
      .toEqual(["economic_sanctions"]);
    expect(relation(state, SOURCE, TARGET)).toBeLessThan(0);
  });

  it("явный вид санкции сохраняется, и результат ЧЕСТНО говорит про торговлю", () => {
    const embargo = game();
    const embargoResult = applyPrimitiveBatch(embargo, [{
      verb: "sanction", sourceCountryId: SOURCE, target: { countryId: TARGET },
      params: { sanctionType: TRADE_CUTTING_SANCTION },
    }]);
    expect((embargoResult.applied[0] as AppliedSanction).cutsTrade).toBe(true);

    // Три остальных вида сегодня репутационные: их не читает ни одна
    // подсистема, и результат обязан это называть, а не позволять нарративу
    // рассказать о задушенной экономике.
    const symbolic = game();
    const symbolicResult = applyPrimitiveBatch(symbolic, [{
      verb: "sanction", sourceCountryId: SOURCE, target: { countryId: TARGET },
      params: { sanctionType: "military_sanctions" },
    }]);
    const applied = symbolicResult.applied[0] as AppliedSanction;
    expect(applied.sanctionType).toBe("military_sanctions");
    expect(applied.cutsTrade).toBe(false);
    expect(applied.summary).toContain("no trade effect");
  });

  it("повторное наложение того же режима отклоняется: оно ничего не меняет", () => {
    const state = game();
    state.countries.find(c => c.id === SOURCE)!.diplomacy.sanctions[TARGET] = ["economic_sanctions"];

    const result = applyPrimitiveBatch(state, [{
      verb: "sanction", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);

    expect(result.applied).toEqual([]);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/already has/);
  });
});

// --------------------------------------------------------------------------
// war / peace
// --------------------------------------------------------------------------

describe("war", () => {
  it("создаёт настоящую войну, обрушивает отношения и сохраняет цель войны", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "war", sourceCountryId: SOURCE, target: { countryId: TARGET },
      params: { warGoal: "Liberate Manchuria" },
    }]);

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0] as AppliedWar;
    const war = state.wars.find(w => w.id === applied.warId)!;

    expect(war.active).toBe(true);
    expect(war.attackers).toContain(SOURCE);
    expect(war.defenders).toContain(TARGET);
    expect(war.warGoal).toBe("Liberate Manchuria");
    // Значения перенесены из старого канала БЕЗ изменения: перевод в алфавит
    // не должен оказаться ещё и тихой рекалибровкой.
    expect(relation(state, SOURCE, TARGET)).toBe(RELATION_SCALE_MIN);
    expect(relation(state, TARGET, SOURCE)).toBe(WAR_DECLARATION_RELATION_PENALTY / 2);
  });

  it("втягивает коалицию по договорам и называет её в результате", () => {
    const state = game();
    // Гарант цели обязан вступиться (`WarService.findCoalitionFor`).
    // structuredClone, а не спред: поверхностная копия делит объект
    // `diplomacy` с оригиналом, и запись «гаранту» уходила бы заодно в цель —
    // это ловит сверка результата, но тест при этом мерил бы не то.
    const guarantor = structuredClone(state.countries.find(c => c.id === TARGET)!);
    guarantor.id = "GBR";
    guarantor.diplomacy.guarantees = [TARGET];
    state.countries.push(guarantor);

    const result = applyPrimitiveBatch(state, [{
      verb: "war", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);
    const applied = result.applied[0] as AppliedWar;

    expect(applied.defenders).toContain("GBR");
    expect(applied.summary).toContain("dragged in");
  });

  it("война с тем, с кем уже воюешь, и с союзником отклоняется", () => {
    const already = game();
    new WarService(already).declareWar(SOURCE, TARGET);
    const alreadyResult = applyPrimitiveBatch(already, [{
      verb: "war", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);
    expect(alreadyResult.applied).toEqual([]);
    expect(promptTextOf(alreadyResult.rejected[0]!)).toMatch(/already at war/);

    const ally = game();
    ally.countries.find(c => c.id === SOURCE)!.diplomacy.allies.push(TARGET);
    const allyResult = applyPrimitiveBatch(ally, [{
      verb: "war", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);
    expect(allyResult.applied).toEqual([]);
    expect(promptTextOf(allyResult.rejected[0]!)).toMatch(/its ally/);
  });

  it("цель войны ограничена по длине: она уезжает в КАЖДЫЙ следующий промт", () => {
    const { primitives, invalid } = parsePrimitives([{
      verb: "war", sourceCountryId: SOURCE, target: { countryId: TARGET },
      params: { warGoal: "x".repeat(MAX_WAR_GOAL_LENGTH + 1) },
    }]);

    expect(primitives).toHaveLength(0);
    expect(invalid[0]!.verb).toBe("war");
  });

  it("у структурного глагола нет интенсивности: `params.intensity` — ошибка схемы", () => {
    // Не придирка к форме, а заявление: у события величины не бывает, и
    // «умеренная война» — не то, что движок умеет посчитать.
    const { primitives, invalid } = parsePrimitives([{
      verb: "war", sourceCountryId: SOURCE, target: { countryId: TARGET },
      params: { intensity: "severe" },
    }]);

    expect(primitives).toHaveLength(0);
    expect(invalid[0]!.reason).toMatch(/intensity/);
  });
});

describe("peace", () => {
  it("закрывает войну, теплеет отношения — поведение старого канала сохранено", () => {
    const state = game();
    new WarService(state).declareWar(SOURCE, TARGET);
    const relationAtWar = relation(state, SOURCE, TARGET);

    const result = applyPrimitiveBatch(state, [{
      verb: "peace", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0] as AppliedPeace;
    expect(state.wars.find(w => w.id === applied.warId)!.active).toBe(false);
    expect(relation(state, SOURCE, TARGET)).toBe(relationAtWar + PEACE_RELATION_RELIEF);
  });

  it("без идущей войны отклоняется", () => {
    const state = game();
    const result = applyPrimitiveBatch(state, [{
      verb: "peace", sourceCountryId: SOURCE, target: { countryId: TARGET },
    }]);

    expect(result.applied).toEqual([]);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/no active war/i);
  });

  it("столица, ушедшая по договору, переезжает — иначе мир откатил бы весь ответ", () => {
    // Предсуществующая ловушка, которую старый канал прятал: `transferRegion`
    // столицу не двигает, а инвариант состояния требует её среди своих
    // регионов. Пока мир применялся мимо пост-инвариантов, это было незаметно.
    const state = game();
    const source = state.countries.find(c => c.id === SOURCE)!;
    const owned = state.regions.filter(r => r.ownerCountryId === SOURCE);
    const capital = owned.find(r => r.id === source.capitalRegionId)!;

    const war = new WarService(state).declareWar(TARGET, SOURCE);
    // Победитель оккупирует столицу проигравшего и продвинулся достаточно,
    // чтобы договор её забрал.
    capital.occupiedBy = TARGET;
    war.territoryFlips = { toAttackers: 100, toDefenders: 0 };

    const result = applyPrimitiveBatch(state, [{
      verb: "peace", sourceCountryId: TARGET, target: { countryId: SOURCE },
    }]);

    expect(result.rejected).toEqual([]);
    const applied = result.applied[0] as AppliedPeace;
    expect(applied.annexedRegionIds).toContain(capital.id);
    expect(applied.capitalMoves.map(m => m.countryId)).toContain(SOURCE);

    // Инвариант, ради которого перенос и делается: столица среди своих регионов.
    const after = state.countries.find(c => c.id === SOURCE)!;
    expect(state.regions.some(r => r.id === after.capitalRegionId && r.ownerCountryId === SOURCE))
      .toBe(true);
  });
});

// --------------------------------------------------------------------------
// Коридор не обходится: ни хинтом, ни частотой, ни сменой глагола
// --------------------------------------------------------------------------

describe("коридор дипломатии не обходится частотой (docs/PRIMITIVES.md §4)", () => {
  /**
   * Кольца ключей исключаются из сравнения намеренно: ключей ПО ПОСТРОЕНИЮ
   * столько, сколько было запросов, и требовать их совпадения значило бы
   * требовать, чтобы десять запросов притворялись одним.
   */
  function worldWithoutKeys(state: GameState): string {
    return JSON.stringify({ ...state, primitiveBatchKeys: [], primitiveNoopBatchKeys: [] });
  }

  it("десять отдельных вызовов в одном месяце = один батч из десяти, по полному снимку мира", () => {
    // Тот же дифференциальный приём, которым ловился обход коридора памяти
    // воздействий. Здесь он проверяет НОВЫЙ домен: без общего слота пары
    // десять приказов «улучшить отношения» сложились бы в десять коридоров.
    const order = diplomacy("improve", "mild");

    const batched = game();
    applyPrimitiveTurn(batched, Array.from({ length: 10 }, () => order), "one-batch");

    const clicked = game();
    for (let i = 0; i < 10; i++) applyPrimitiveTurn(clicked, [order], `click-${i}`);

    expect(worldWithoutKeys(clicked)).toBe(worldWithoutKeys(batched));

    // И величина именно та, что даёт ОДИН примитив, — иначе тест прошёл бы на
    // двух одинаково сломанных мирах.
    const single = game();
    applyPrimitiveTurn(single, [order], "single");
    expect(relation(clicked, SOURCE, TARGET)).toBe(relation(single, SOURCE, TARGET));
  });

  it("СМЕНА ГЛАГОЛА коридор не открывает: diplomacy и sanction делят слот пары", () => {
    // Обход, который «один verb на цель за ход» НЕ ловит: ключ у него
    // ключуется парой (глагол, цель), поэтому два разных глагола, пишущих в
    // одну ячейку `relations`, прошли бы обоими ключами и сложились.
    const state = game();
    const result = applyPrimitiveTurn(
      state,
      [
        diplomacy("worsen", "severe"),
        { verb: "sanction", sourceCountryId: SOURCE, target: { countryId: TARGET } },
      ],
      "two-verbs-one-pair"
    );

    expect(result.applied).toHaveLength(1);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/per target per turn/);

    // Суммарный сдвиг остался в пределах ОДНОГО коридора.
    expect(Math.abs(relation(state, SOURCE, TARGET))).toBeLessThanOrEqual(DIPLOMACY_RELATION_MAX);
  });

  it("разные ПАРЫ остаются законной комбинацией — слот не запирает весь мир", () => {
    // Граница обязана быть узкой: общий слот на пару не должен превращаться в
    // «одно дипломатическое действие за месяц на всю партию».
    const state = game();
    const third = structuredClone(state.countries.find(c => c.id === TARGET)!);
    third.id = "GBR";
    state.countries.push(third);

    const result = applyPrimitiveTurn(
      state,
      [
        diplomacy("improve", "mild"),
        {
          verb: "diplomacy", sourceCountryId: SOURCE,
          target: { countryId: "GBR" }, params: { direction: "improve" },
        },
      ],
      "two-pairs"
    );

    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(2);
  });
});

// --------------------------------------------------------------------------
// Сверка результата с состоянием
// --------------------------------------------------------------------------

describe("ложь о сдвиге отношений откатывает примитив целиком", () => {
  it("подменённая величина ловится сверкой, а не внешним тестом", () => {
    // Канал `relation:` добавлен в разложение состояния Милстоуном 1 ровно
    // ради этого: до него обработчик, соврав о величине сдвига, был бы пойман
    // тестом, но не откатом, — то есть ложь уехала бы в нарратив.
    const state = game();
    const original = diplomacyCommands.setRelation;
    const spy = vi
      .spyOn(diplomacyCommands, "setRelation")
      .mockImplementation((game, from, to, delta) =>
        // Движется ВДВОЕ больше, чем посчитал коридор: отчёт построен по
        // фактическим чтениям, но диф состояния с ним теперь не сойдётся,
        // потому что вторая запись идёт мимо отчёта.
        original(game, from, to, delta * 2)
      );

    try {
      // Отчёт строится чтением «до/после» вокруг вызова, поэтому подмена самой
      // команды его не ломает. Ломаем связь иначе: дописываем скрытый сдвиг
      // ТРЕТЬЕЙ стране после того, как отчёт собран.
      spy.mockImplementation((game, from, to, delta) => {
        const result = original(game, from, to, delta);
        original(game, from, "GBR", 25);
        return result;
      });
      const bystander = structuredClone(state.countries.find(c => c.id === TARGET)!);
      bystander.id = "GBR";
      state.countries.push(bystander);

      const result = applyPrimitiveBatch(state, [diplomacy("improve", "severe")]);

      expect(result.applied).toEqual([]);
      expect(promptTextOf(result.rejected[0]!)).toMatch(/disagrees with what it changed/);
      // Откат полный: скрытый сдвиг тоже не пережил примитива.
      expect(relation(state, SOURCE, "GBR")).toBe(0);
      expect(relation(state, SOURCE, TARGET)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
