import { describe, it, expect } from "vitest";
import { type GameState } from "@shared/types/GameState";
import {
  SEND_AID_SHARE_MIN,
  SEND_AID_SHARE_MAX,
  SEND_AID_MIN_TREASURY_SHARE,
  INFLUENCE_SCALE_MAX,
  CONDEMN_LEGITIMACY_MAX,
} from "@shared/defines/diplomacy";
import {
  CAPITAL_FLIGHT_MAX_STABILITY,
  CAPITAL_FLIGHT_GDP_MIN,
  CAPITAL_FLIGHT_GDP_MAX,
} from "@shared/defines/economy";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { applyPrimitiveTurn } from "../turnBatch";
import { rejectionPromptText } from "../rejections";
import {
  type AppliedCapitalFlight,
  type AppliedCondemn,
  type AppliedSendAid,
  type AppliedSupportProxy,
  type Primitive,
  type PrimitiveIntensity,
  type RejectedPrimitive,
} from "../types";
import {
  createDiscontentTestGame,
  createSovietTestCountry,
  destabilizeRegion,
  giveAudience,
  addProxyClientWar,
  TEST_REGION_NATIONAL,
  TEST_REGION_CONTROL,
} from "../../test-utils/discontentFixtures";
import { createTestCountry } from "../../test-utils/fixtures";

/**
 * Мягкие глаголы алфавита (Милстоун 1): `send_aid`, `capital_flight`,
 * `condemn`, `support_proxy`.
 *
 * Файл проверяет ТРИ вещи и не смешивает их:
 *
 *   1. **Предпосылку** — каждый из четырёх отвечает «так не бывает» там, где
 *      состояние его не пускает, и причина уходит в промт человеческим текстом,
 *      а не кодом.
 *   2. **Коридор от состояния** — величину задаёт мир, а не хинт. У каждого
 *      канала проверяется ДОСТИЖИМОЕ схлопывание (`severe` перестаёт
 *      отличаться от `mild`) и то, что доля коридора меняется вместе с
 *      состоянием.
 *   3. **Невозможность обойти коридор частотой** — дифференциально, полным
 *      снимком мира, а не утверждением. У бесплатных глаголов дополнительно
 *      проверяется, что смена ИСТОЧНИКА коридор не открывает.
 *
 * Пороги и коридоры берутся из констант, идентификаторы — из фикстуры: тест
 * проверяет свойство, а не снимок.
 */

const SOURCE = "SUN";
const TARGET = "USA";

function game(): GameState {
  return createDiscontentTestGame();
}

function country(state: GameState, id: string) {
  return state.countries.find(c => c.id === id)!;
}

function treasury(state: GameState, id: string): number {
  return country(state, id).economy.treasury;
}

function influence(state: GameState, from: string, to: string): number {
  return country(state, from).diplomacy.influence[to] ?? 0;
}

function relation(state: GameState, from: string, to: string): number {
  return country(state, from).diplomacy.relations[to] ?? 0;
}

function regionOf(state: GameState, id: number) {
  return state.regions.find(r => r.id === id)!;
}

function promptTextOf(rejected: RejectedPrimitive): string {
  return rejectionPromptText(rejected.rejection);
}

function sendAid(intensity?: PrimitiveIntensity, source = SOURCE): Primitive {
  return {
    verb: "send_aid",
    sourceCountryId: source,
    target: { countryId: TARGET },
    ...(intensity ? { params: { intensity } } : {}),
  };
}

function capitalFlight(
  intensity?: PrimitiveIntensity,
  regionId = TEST_REGION_NATIONAL,
  source = TARGET
): Primitive {
  return {
    verb: "capital_flight",
    sourceCountryId: source,
    target: { regionId },
    ...(intensity ? { params: { intensity } } : {}),
  };
}

function condemn(intensity?: PrimitiveIntensity, source = SOURCE): Primitive {
  return {
    verb: "condemn",
    sourceCountryId: source,
    target: { countryId: TARGET },
    ...(intensity ? { params: { intensity } } : {}),
  };
}

function supportProxy(intensity?: PrimitiveIntensity, source = SOURCE): Primitive {
  return {
    verb: "support_proxy",
    sourceCountryId: source,
    target: { countryId: TARGET },
    ...(intensity ? { params: { intensity } } : {}),
  };
}

// --------------------------------------------------------------------------
// send_aid
// --------------------------------------------------------------------------

describe("send_aid: донор платит, получатель усиливается, влияние покупается", () => {
  it("деньги реально переходят из казны в казну — ровно та сумма, о которой отчитался движок", () => {
    const state = game();
    const donorBefore = treasury(state, SOURCE);
    const recipientBefore = treasury(state, TARGET);

    const result = applyPrimitiveBatch(state, [sendAid("moderate")]);
    expect(result.rejected).toEqual([]);

    const moved = donorBefore - treasury(state, SOURCE);
    expect(moved).toBeGreaterThan(0);
    // Приход получателя равен расходу донора: помощь не создаёт и не сжигает
    // денег, она их переносит.
    expect(treasury(state, TARGET) - recipientBefore).toBeCloseTo(moved, 6);

    // Отчёт согласен с состоянием — иначе примитив откатила бы сверка, но
    // проверяется это и снаружи: сверка тождественна там, где отчёт строится из
    // дифа, и здесь важно, что суммы сходятся ПО ОБЕИМ сторонам.
    const applied = result.applied[0] as AppliedSendAid;
    const donorEffect = applied.countryScalarEffects.find(
      e => e.countryId === SOURCE && e.field === "treasury"
    )!;
    expect(donorEffect.delta).toBeCloseTo(-moved, 6);
  });

  it("сумма лежит внутри объявленного коридора долей казны, каким бы ни был хинт", () => {
    for (const intensity of ["mild", "moderate", "severe"] as const) {
      const state = game();
      const before = treasury(state, SOURCE);
      applyPrimitiveBatch(state, [sendAid(intensity)]);

      const share = (before - treasury(state, SOURCE)) / before;
      expect(share).toBeGreaterThanOrEqual(SEND_AID_SHARE_MIN);
      expect(share).toBeLessThanOrEqual(SEND_AID_SHARE_MAX);
    }
  });

  it("неплатёжеспособный донор отклоняется, и причина называет ПРАВИЛО, а не код", () => {
    const state = game();
    // Казна ровно ПОД порогом платёжеспособности — предпосылка выражена долей
    // от ВВП, поэтому и подготовка выражается ею же, а не числом.
    const donor = country(state, SOURCE);
    donor.economy.treasury = donor.economy.gdp * (SEND_AID_MIN_TREASURY_SHARE / 2);

    const result = applyPrimitiveBatch(state, [sendAid("severe")]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("donorInsolvent");
    expect(promptTextOf(result.rejected[0]!)).toMatch(/treasury/);
  });

  it("КОРИДОР ВЛИЯНИЯ СХЛОПЫВАЕТСЯ: на потолке шкалы `severe` не отличается от `mild`", () => {
    // Достижимое схлопывание канала влияния, обязательное по контракту
    // `magnitude.ts`: донору, чьё влияние уже равно ста, купить нечего.
    const results = (["mild", "severe"] as const).map(intensity => {
      const state = game();
      country(state, SOURCE).diplomacy.influence[TARGET] = INFLUENCE_SCALE_MAX;
      applyPrimitiveBatch(state, [sendAid(intensity)]);
      return influence(state, SOURCE, TARGET);
    });

    expect(results[0]).toBe(results[1]);
    expect(results[0]).toBe(INFLUENCE_SCALE_MAX);
  });

  it("доля коридора влияния зависит от состояния — проверка выше сама по себе СЛАБАЯ", () => {
    // Найдено негативным контролем: снятие множителя `influenceRoom` проверку
    // выше НЕ роняет, потому что ровно на потолке результат режет кламп шкалы
    // (`changeInfluence` клампит в 0..100), а не коридор. Тот же дефект, что
    // разобран у `diplomacy` в `magnitude.ts`.
    //
    // Содержательное утверждение — «оставшийся запас шкалы задаёт ширину», и
    // видно оно только ВДАЛИ от края.
    const gainAt = (current: number): number => {
      const state = game();
      country(state, SOURCE).diplomacy.influence[TARGET] = current;
      applyPrimitiveBatch(state, [sendAid("severe")]);
      return influence(state, SOURCE, TARGET) - current;
    };

    const roomy = gainAt(0);
    // Место ещё есть (до потолка далеко, кламп не участвует), но его меньше.
    const tight = gainAt(INFLUENCE_SCALE_MAX * 0.8);

    expect(roomy).toBeGreaterThan(tight);
    // Разрыв требуется СОДЕРЖАТЕЛЬНЫЙ, а не любой: при коридоре-константе оба
    // равны «на бумаге» и расходятся лишь на шум double.
    expect(roomy / tight).toBeGreaterThan(1.5);
  });

  it("состояние двигает ширину коридора: соизмеримой экономике дают больше, чем крошечной", () => {
    // Свойство `aidScale`, ради которого множитель и существует, — и ЖИВОЙ вход
    // на поставляемых данных: ВВП разбросан на шесть порядков, тогда как
    // отношение казны к ВВП там почти константа.
    const shareGivenTo = (recipientGdp: number): number => {
      const state = game();
      country(state, TARGET).economy.gdp = recipientGdp;
      const before = treasury(state, SOURCE);
      applyPrimitiveBatch(state, [sendAid("severe")]);
      return (before - treasury(state, SOURCE)) / before;
    };

    const comparable = shareGivenTo(country(game(), SOURCE).economy.gdp);
    const tiny = shareGivenTo(country(game(), SOURCE).economy.gdp / 1000);

    expect(comparable).toBeGreaterThan(tiny);
  });

  it("ОТНОШЕНИЯ не двигает вовсе — потепление приходит симуляцией, а не вторым сдвигом", () => {
    // Решение сессии, названное явно (docs/PRIMITIVES.md §2): помощь покупает
    // ВЛИЯНИЕ, а влияние выше порога сферы поднимает отношения тиком, через
    // член зависимости структурного тяготения. Прямая запись в `relations`
    // сделала бы «помочь и одновременно договариваться» невозможным в один
    // месяц по одной паре — из-за общего слота пары.
    const state = game();
    applyPrimitiveBatch(state, [sendAid("severe")]);

    expect(relation(state, SOURCE, TARGET)).toBe(0);
    expect(relation(state, TARGET, SOURCE)).toBe(0);
    expect(influence(state, SOURCE, TARGET)).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// capital_flight
// --------------------------------------------------------------------------

describe("capital_flight: капитал бежит из сломанного доверия, а не по приказу", () => {
  it("спокойный регион отклоняет отток — предпосылка есть, хотя спецификация её не требует", () => {
    const state = game();
    regionOf(state, TEST_REGION_NATIONAL).stability = CAPITAL_FLIGHT_MAX_STABILITY;

    const result = applyPrimitiveBatch(state, [capitalFlight("severe")]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("regionTooStableForFlight");
    expect(promptTextOf(result.rejected[0]!)).toMatch(/stability/);
  });

  it("бьёт и по производству региона, и по казне его фактического контролёра", () => {
    const state = game();
    destabilizeRegion(state, TEST_REGION_NATIONAL);
    const gdpBefore = regionOf(state, TEST_REGION_NATIONAL).gdp;
    const treasuryBefore = treasury(state, SOURCE);

    const result = applyPrimitiveBatch(state, [capitalFlight("moderate")]);
    expect(result.rejected).toEqual([]);

    expect(regionOf(state, TEST_REGION_NATIONAL).gdp).toBeLessThan(gdpBefore);
    expect(treasury(state, SOURCE)).toBeLessThan(treasuryBefore);

    // Пострадал контролёр региона, а не источник примитива: отток устраивает
    // мир, а платит тот, чья это земля.
    const applied = result.applied[0] as AppliedCapitalFlight;
    expect(applied.countryId).toBe(SOURCE);
    expect(applied.sourceCountryId).toBe(TARGET);
  });

  it("доля вывода лежит внутри объявленного коридора, каким бы ни был хинт", () => {
    for (const intensity of ["mild", "moderate", "severe"] as const) {
      const state = game();
      destabilizeRegion(state, TEST_REGION_NATIONAL);
      const before = regionOf(state, TEST_REGION_NATIONAL).gdp;
      applyPrimitiveBatch(state, [capitalFlight(intensity)]);

      const share = (before - regionOf(state, TEST_REGION_NATIONAL).gdp) / before;
      expect(share).toBeGreaterThanOrEqual(CAPITAL_FLIGHT_GDP_MIN);
      expect(share).toBeLessThanOrEqual(CAPITAL_FLIGHT_GDP_MAX);
    }
  });

  it("КОРИДОР СХЛОПЫВАЕТСЯ: из неразвитого региона бежать нечему, и `severe` равен `mild`", () => {
    // Второе достижимое схлопывание глагола (первое — стабильность ровно на
    // пороге, но там примитив отклоняется предпосылкой, а не даёт минимум).
    const results = (["mild", "severe"] as const).map(intensity => {
      const state = game();
      destabilizeRegion(state, TEST_REGION_NATIONAL);
      regionOf(state, TEST_REGION_NATIONAL).development = 0;
      const before = regionOf(state, TEST_REGION_NATIONAL).gdp;
      applyPrimitiveBatch(state, [capitalFlight(intensity)]);
      return before - regionOf(state, TEST_REGION_NATIONAL).gdp;
    });

    expect(results[0]).toBe(results[1]);
  });

  it("состояние двигает ширину: чем ниже стабильность, тем глубже отток", () => {
    const drainAt = (stability: number): number => {
      const state = game();
      const region = regionOf(state, TEST_REGION_NATIONAL);
      region.stability = stability;
      const before = region.gdp;
      applyPrimitiveBatch(state, [capitalFlight("severe")]);
      return before - regionOf(state, TEST_REGION_NATIONAL).gdp;
    };

    expect(drainAt(0)).toBeGreaterThan(drainAt(CAPITAL_FLIGHT_MAX_STABILITY * 0.9));
  });

  it("вес региона в экономике страны решает, сколько потеряет КАЗНА", () => {
    // Без веса паника в окраинной провинции стоила бы державе столько же,
    // сколько паника в её промышленном ядре.
    const treasuryLoss = (countryGdpMultiplier: number): number => {
      const state = game();
      destabilizeRegion(state, TEST_REGION_NATIONAL);
      country(state, SOURCE).economy.gdp =
        regionOf(state, TEST_REGION_NATIONAL).gdp * countryGdpMultiplier;
      const before = treasury(state, SOURCE);
      applyPrimitiveBatch(state, [capitalFlight("severe")]);
      return before - treasury(state, SOURCE);
    };

    // Регион — вся экономика страны против региона в сотую её часть.
    expect(treasuryLoss(1)).toBeGreaterThan(treasuryLoss(100));
  });
});

// --------------------------------------------------------------------------
// condemn
// --------------------------------------------------------------------------

describe("condemn: репутационный удар с трибуны, без материального", () => {
  it("без трибуны отклоняется — предпосылка живая, а не формальность", () => {
    // Прямой подсчёт по сценарию 1946: 110 стран из 157 не имеют ни исходящего
    // влияния, ни формальных связей вовсе. Фикстура повторяет именно этот
    // случай — источник без единой связи.
    const state = game();
    const result = applyPrimitiveBatch(state, [condemn("severe")]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("noPodium");
    expect(promptTextOf(result.rejected[0]!)).toMatch(/podium/);
  });

  it("бьёт по легитимности цели и НЕ трогает ничего материального", () => {
    const state = game();
    giveAudience(state, SOURCE, TARGET);
    const legitimacyBefore = country(state, TARGET).politics.legitimacy;
    const treasuryBefore = treasury(state, TARGET);

    const result = applyPrimitiveBatch(state, [condemn("moderate")]);
    expect(result.rejected).toEqual([]);

    expect(country(state, TARGET).politics.legitimacy).toBeLessThan(legitimacyBefore);
    // «Без материального» — не фигура речи: ни казны, ни отношений, ни санкций.
    expect(treasury(state, TARGET)).toBe(treasuryBefore);
    expect(relation(state, SOURCE, TARGET)).toBe(0);
  });

  it("удар лежит внутри объявленного коридора, каким бы ни был хинт", () => {
    for (const intensity of ["mild", "moderate", "severe"] as const) {
      const state = game();
      giveAudience(state, SOURCE, TARGET);
      const before = country(state, TARGET).politics.legitimacy;
      applyPrimitiveBatch(state, [condemn(intensity)]);

      const damage = before - country(state, TARGET).politics.legitimacy;
      expect(damage).toBeGreaterThan(0);
      expect(damage).toBeLessThanOrEqual(CONDEMN_LEGITIMACY_MAX);
    }
  });

  it("КОРИДОР СХЛОПЫВАЕТСЯ: режиму с нулевой легитимностью терять нечего", () => {
    const state = game();
    giveAudience(state, SOURCE, TARGET);
    country(state, TARGET).politics.legitimacy = 0;

    const result = applyPrimitiveBatch(state, [condemn("severe")]);

    // Примитив ПРИМЕНЯЕТСЯ (предпосылка выполнена) и честно отчитывается о
    // нулевом эффекте — тот же путь, что у репрессии по группе на потолке
    // подавления. Отказывать за то, что состояние не оставило места, значило бы
    // завести два разных ответа на одно положение мира.
    expect(result.rejected).toEqual([]);
    expect(country(state, TARGET).politics.legitimacy).toBe(0);
    expect((result.applied[0] as AppliedCondemn).countryScalarEffects).toEqual([]);
  });

  it("доля коридора зависит от остатка легитимности — проверка выше сама по себе СЛАБАЯ", () => {
    // Та же находка негативного контроля, что у влияния `send_aid`: снятие
    // множителя `legitimacyRoom` проверку выше НЕ роняет, потому что на нуле
    // результат режет пол шкалы, а не коридор. Содержательное утверждение
    // видно только вдали от края.
    const damageAt = (legitimacy: number): number => {
      const state = game();
      giveAudience(state, SOURCE, TARGET);
      country(state, TARGET).politics.legitimacy = legitimacy;
      applyPrimitiveBatch(state, [condemn("severe")]);
      return legitimacy - country(state, TARGET).politics.legitimacy;
    };

    // Обе точки далеко от пола: удар не превышает CONDEMN_LEGITIMACY_MAX,
    // поэтому кламп в ноль не участвует ни там, ни там.
    const proud = damageAt(100);
    const shaky = damageAt(CONDEMN_LEGITIMACY_MAX * 4);

    expect(proud).toBeGreaterThan(shaky);
    expect(proud / shaky).toBeGreaterThan(1.5);
  });

  it("состояние двигает ширину: голос с большой аудиторией бьёт сильнее", () => {
    const damageWithAudience = (size: number): number => {
      const state = game();
      const source = country(state, SOURCE);
      for (let i = 0; i < size; i++) source.diplomacy.influence[`AUD${i}`] = 50;
      const before = country(state, TARGET).politics.legitimacy;
      applyPrimitiveBatch(state, [condemn("severe")]);
      return before - country(state, TARGET).politics.legitimacy;
    };

    expect(damageWithAudience(20)).toBeGreaterThan(damageWithAudience(1));
  });
});

// --------------------------------------------------------------------------
// support_proxy
// --------------------------------------------------------------------------

describe("support_proxy: патрон вливает силу, не становясь стороной войны", () => {
  function proxyGame(): GameState {
    const state = game();
    addProxyClientWar(state, TARGET);
    giveAudience(state, SOURCE, TARGET);
    return state;
  }

  it("клиент без войны отклоняется", () => {
    const state = game();
    giveAudience(state, SOURCE, TARGET);

    const result = applyPrimitiveBatch(state, [supportProxy("severe")]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("proxyNotAtWar");
  });

  it("патрон, воюющий в той же войне, отклоняется — это своя война, а не прокси", () => {
    const state = game();
    const enemy = addProxyClientWar(state, TARGET);
    giveAudience(state, SOURCE, TARGET);
    // Патрон входит в ту же войну на стороне клиента.
    state.wars.find(w => w.active)!.defenders.push(SOURCE);
    expect(enemy).toBeTruthy();

    const result = applyPrimitiveBatch(state, [supportProxy("severe")]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("proxyPatronIsBelligerent");
  });

  it("без патронажа отклоняется: помогать чужому клиенту — не то же, что своему", () => {
    const state = game();
    addProxyClientWar(state, TARGET);

    const result = applyPrimitiveBatch(state, [supportProxy("severe")]);

    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.rejection.code).toBe("proxyNoPatronage");
  });

  it("патрон платит казной, клиент получает живую силу, и патрон в войну НЕ вступает", () => {
    const state = proxyGame();
    const patronTreasury = treasury(state, SOURCE);
    const clientPersonnel = country(state, TARGET).military.activePersonnel;

    const result = applyPrimitiveBatch(state, [supportProxy("severe")]);
    expect(result.rejected).toEqual([]);

    expect(treasury(state, SOURCE)).toBeLessThan(patronTreasury);
    expect(country(state, TARGET).military.activePersonnel).toBeGreaterThan(clientPersonnel);

    // ГЛАВНОЕ свойство глагола: списки сторон войны не изменились.
    const war = state.wars.find(w => w.active)!;
    expect(war.attackers).not.toContain(SOURCE);
    expect(war.defenders).not.toContain(SOURCE);
    expect((result.applied[0] as AppliedSupportProxy).warId).toBe(war.id);
  });

  it("КОРИДОР СХЛОПЫВАЕТСЯ: без канала патронажа `severe` равен `mild`", () => {
    // Схлопывание достигается влиянием на границе применимости: единица влияния
    // предпосылку проходит, но канала практически не даёт.
    const results = (["mild", "severe"] as const).map(intensity => {
      const state = game();
      addProxyClientWar(state, TARGET);
      country(state, SOURCE).diplomacy.influence[TARGET] = Number.MIN_VALUE;
      const before = country(state, TARGET).military.activePersonnel;
      applyPrimitiveBatch(state, [supportProxy(intensity)]);
      return country(state, TARGET).military.activePersonnel - before;
    });

    expect(results[0]).toBe(results[1]);
  });

  it("состояние двигает ширину: прижатому клиенту поставляют больше", () => {
    const reinforcementWithOccupied = (occupied: number): number => {
      const state = proxyGame();
      const enemyId = state.wars.find(w => w.active)!.attackers[0]!;
      // Оккупация реальная, через поле состояния, а не подкрутка множителя.
      for (const region of state.regions.filter(r => r.ownerCountryId === SOURCE).slice(0, occupied)) {
        region.ownerCountryId = TARGET;
        region.occupiedBy = enemyId;
      }
      const before = country(state, TARGET).military.activePersonnel;
      applyPrimitiveBatch(state, [supportProxy("severe")]);
      return country(state, TARGET).military.activePersonnel - before;
    };

    expect(reinforcementWithOccupied(2)).toBeGreaterThan(reinforcementWithOccupied(0));
  });
});

// --------------------------------------------------------------------------
// Коридор не обходится частотой — дифференциально, а не утверждением
// --------------------------------------------------------------------------

describe("коридоры мягких воздействий не обходятся частотой (docs/PRIMITIVES.md §4)", () => {
  /**
   * Кольца ключей исключаются из сравнения намеренно: ключей ПО ПОСТРОЕНИЮ
   * столько, сколько было запросов, и требовать их совпадения значило бы
   * требовать, чтобы десять запросов притворялись одним.
   */
  function worldWithoutKeys(state: GameState): string {
    return JSON.stringify({ ...state, primitiveBatchKeys: [], primitiveNoopBatchKeys: [] });
  }

  /**
   * Канал, в который глагол пишет свою величину, — для сравнения с миром, где
   * примитив применился ровно один раз.
   *
   * Полным снимком это сравнить НЕЛЬЗЯ, и причина содержательна: десять
   * вызовов, из которых девять отклонены капом, оставляют девять записей
   * диагностики, а один законный вызов — ни одной. Диагностика и есть
   * доказательство того, что кап сработал; требовать её совпадения значило бы
   * требовать, чтобы кап молчал.
   */
  const cases: {
    name: string;
    order: Primitive;
    prepare: (state: GameState) => void;
    channel: (state: GameState) => number;
  }[] = [
    {
      name: "send_aid",
      order: sendAid("mild"),
      prepare: () => {},
      channel: state => treasury(state, TARGET),
    },
    {
      name: "capital_flight",
      order: capitalFlight("mild"),
      prepare: state => destabilizeRegion(state, TEST_REGION_NATIONAL),
      channel: state => regionOf(state, TEST_REGION_NATIONAL).gdp,
    },
    {
      name: "condemn",
      order: condemn("mild"),
      prepare: state => giveAudience(state, SOURCE, TARGET),
      channel: state => country(state, TARGET).politics.legitimacy,
    },
    {
      name: "support_proxy",
      order: supportProxy("mild"),
      prepare: state => {
        addProxyClientWar(state, TARGET);
        giveAudience(state, SOURCE, TARGET);
      },
      channel: state => country(state, TARGET).military.activePersonnel,
    },
  ];

  it.each(cases)(
    "$name: десять отдельных вызовов в одном месяце = один батч из десяти, по полному снимку мира",
    ({ order, prepare, channel }) => {
      const batched = game();
      prepare(batched);
      applyPrimitiveTurn(batched, Array.from({ length: 10 }, () => order), "one-batch");

      const clicked = game();
      prepare(clicked);
      for (let i = 0; i < 10; i++) applyPrimitiveTurn(clicked, [order], `click-${i}`);

      expect(worldWithoutKeys(clicked)).toBe(worldWithoutKeys(batched));

      // И величина именно та, что даёт ОДИН примитив, — иначе тест прошёл бы на
      // двух одинаково сломанных мирах.
      const single = game();
      prepare(single);
      applyPrimitiveTurn(single, [order], "single");
      expect(channel(clicked)).toBe(channel(single));
      // Мир при этом действительно изменился: «ничего не произошло десять раз»
      // прошло бы проверку выше по построению.
      const untouched = game();
      prepare(untouched);
      expect(channel(single)).not.toBe(channel(untouched));
    }
  );

  it("condemn: СМЕНА ИСТОЧНИКА коридор не открывает — ячейка легитимности принадлежит цели", () => {
    // Обход, который ключ «глагол + источник + цель» НЕ поймал бы: десять
    // разных государств бьют по одной репутации, каждому это стоит НОЛЬ.
    // Поэтому ключ капа у этого глагола источника не содержит вовсе.
    const state = game();
    const second = createSovietTestCountry({ id: "GBR" });
    state.countries.push(second);
    giveAudience(state, SOURCE, TARGET);
    giveAudience(state, "GBR", TARGET);

    const before = country(state, TARGET).politics.legitimacy;
    const result = applyPrimitiveTurn(
      state,
      [condemn("severe", SOURCE), condemn("severe", "GBR")],
      "two-sources-one-target"
    );

    expect(result.applied).toHaveLength(1);
    expect(promptTextOf(result.rejected[0]!)).toMatch(/per target per turn/);
    expect(before - country(state, TARGET).politics.legitimacy).toBeLessThanOrEqual(
      CONDEMN_LEGITIMACY_MAX
    );
  });

  it("capital_flight: смена источника коридор не открывает — ячейка принадлежит региону", () => {
    const state = game();
    state.countries.push(createTestCountry({ id: "GBR" }));
    destabilizeRegion(state, TEST_REGION_NATIONAL);

    const before = regionOf(state, TEST_REGION_NATIONAL).gdp;
    const result = applyPrimitiveTurn(
      state,
      [capitalFlight("severe", TEST_REGION_NATIONAL, TARGET),
       capitalFlight("severe", TEST_REGION_NATIONAL, "GBR")],
      "two-sources-one-region"
    );

    expect(result.applied).toHaveLength(1);
    const share = (before - regionOf(state, TEST_REGION_NATIONAL).gdp) / before;
    expect(share).toBeLessThanOrEqual(CAPITAL_FLIGHT_GDP_MAX);
  });

  it("разные ЦЕЛИ остаются законной комбинацией — кап не запирает весь мир", () => {
    // Граница обязана быть узкой: ключ без источника не должен превращаться в
    // «одно осуждение за месяц на всю партию».
    const state = game();
    state.countries.push(createTestCountry({ id: "GBR" }));
    giveAudience(state, SOURCE, TARGET);

    const result = applyPrimitiveTurn(
      state,
      [
        condemn("mild", SOURCE),
        { verb: "condemn", sourceCountryId: SOURCE, target: { countryId: "GBR" } },
      ],
      "two-targets"
    );

    expect(result.applied).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("capital_flight по РАЗНЫМ регионам — тоже законная комбинация", () => {
    const state = game();
    destabilizeRegion(state, TEST_REGION_NATIONAL);
    destabilizeRegion(state, TEST_REGION_CONTROL);

    const result = applyPrimitiveTurn(
      state,
      [
        capitalFlight("mild", TEST_REGION_NATIONAL, TARGET),
        capitalFlight("mild", TEST_REGION_CONTROL, TARGET),
      ],
      "two-regions"
    );

    expect(result.applied).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });
});
