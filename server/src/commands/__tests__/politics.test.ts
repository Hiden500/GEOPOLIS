import { describe, it, expect } from "vitest";
import { addGroupImpact, shiftCountryIdeology, spendGovernmentSupport } from "../politics";
import { discontentTick } from "../../simulation/politics/DiscontentTick";
import { regionDiscontent, resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { IDEOLOGY_AXIS_MIN } from "@shared/types/politics/Ideology";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_REGION_NATIONAL,
} from "../../test-utils/discontentFixtures";

/**
 * Командный слой политики — единственная дверь к памяти воздействий. Здесь
 * проверяется её санитарный контроль: неконечная дельта не должна попасть в
 * состояние.
 *
 * Почему это не мелочь: `GroupImpactMemory` — вход формулы недовольства, а
 * `clamp01(NaN) === NaN`. NaN-недовольство делает ЛОЖНЫМИ обе ветки кризисного
 * латча (`DiscontentTick.ts`: `discontent >= порог` и `discontent < порог −
 * гистерезис`), то есть регион молча перестаёт и входить в кризис, и выходить
 * из него — без исключения, без факта, без единой жалобы в логе. Тип
 * `Partial<Record<ImpactField, number>>` при этом допускает `undefined`, а
 * `память + undefined` — это NaN.
 */
describe("commands/politics — addGroupImpact отклоняет неконечную дельту", () => {
  const nonFinite: [string, unknown][] = [
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["строку", "0.5"],
  ];

  it.each(nonFinite)("отказывает на %s и не создаёт запись памяти", (_label, value) => {
    const game = createDiscontentTestGame();

    const result = addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      emboldenment: value as number,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/finite/i);
    // Ни записи, ни частично применённого следа: команда отказала до записи.
    expect(game.groupImpactMemory).toHaveLength(0);
  });

  it("не портит уже существующую память частично применённой дельтой", () => {
    const game = createDiscontentTestGame();
    expect(addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, { suppression: 0.3 }))
      .toEqual({ success: true, applied: { suppression: 0.3 } });
    const before = structuredClone(game.groupImpactMemory);

    // Первое поле корректно, второе — нет: не должно примениться ни одно.
    const result = addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      suppression: 0.2,
      alienation: Number.NaN,
    });

    expect(result.success).toBe(false);
    expect(game.groupImpactMemory).toEqual(before);
  });

  it("недовольство остаётся числом, а кризисный латч продолжает работать", () => {
    const game = createDiscontentTestGame();
    addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      emboldenment: Number.NaN,
    });

    discontentTick(game);

    const region = game.regions.find(r => r.id === TEST_REGION_NATIONAL)!;
    expect(Number.isNaN(regionDiscontent(game, region))).toBe(false);
    // Регион и без воздействия стоит выше порога — латч обязан его увидеть.
    expect(game.regionCrisisLatch).toContain(TEST_REGION_NATIONAL);
  });

  it("конечная дельта по-прежнему применяется", () => {
    const game = createDiscontentTestGame();

    expect(addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, { concession: 0.25 }))
      .toEqual({ success: true, applied: { concession: 0.25 } });

    expect(game.groupImpactMemory).toHaveLength(1);
    expect(game.groupImpactMemory[0]!.concession).toBeCloseTo(0.25, 10);
  });
});

/**
 * Вторая половина того же правила: команда обязана отчитываться ФАКТИЧЕСКИ
 * применённым, а не запрошенным (docs/PRIMITIVES.md §4 — «движок возвращает LLM
 * фактические величины… цифры правдивые, не выдуманные»). Разница видна только
 * здесь: выше по стеку уже поздно, там известно лишь намерение.
 */
describe("commands/politics — фактические дельты, а не запрошенные", () => {
  it("насыщенное поле принимает остаток до потолка, а не запрошенное число", () => {
    const game = createDiscontentTestGame();
    addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, { suppression: 0.98 });

    const result = addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      suppression: 0.41,
    });

    expect(result.success).toBe(true);
    expect(result.applied!.suppression).toBeCloseTo(0.02, 10);
    expect(game.groupImpactMemory[0]!.suppression).toBeCloseTo(1, 10);
  });

  it("поле на потолке принимает ровно ноль", () => {
    const game = createDiscontentTestGame();
    addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, { alienation: 1 });

    const result = addGroupImpact(game, TEST_REGION_NATIONAL, TEST_GROUP_TITULAR, {
      alienation: 0.5,
    });

    expect(result.applied!.alienation).toBe(0);
  });

  it("сдвиг идеологии у края спектра отчитывается нулём, а не запрошенным шагом", () => {
    const game = createDiscontentTestGame();
    const politics = game.countries.find(c => c.id === "SUN")!.politics;
    politics.ideologyCoordinates = { economic: 0, political: IDEOLOGY_AXIS_MIN };

    const result = shiftCountryIdeology(game, "SUN", 0.1, -0.2);

    expect(result.success).toBe(true);
    expect(result.applied!.economic).toBeCloseTo(0.1, 10);
    expect(result.applied!.political).toBe(0);
    expect(politics.ideologyCoordinates.political).toBe(IDEOLOGY_AXIS_MIN);
  });
});

/**
 * Тот же санитарный контроль на двух других командах политического слоя. Живой
 * путь отказа, из-за которого он здесь и появился: `governmentSupport = NaN`
 * проходит предпосылку реформы (`NaN < 25` ложно), `reformMandateFactor(NaN)`
 * даёт NaN-шаг, тот уезжает в координаты идеологии — и недовольство ВСЕХ
 * регионов страны становится NaN, после чего кризисный латч замолкает.
 */
describe("commands/politics — неконечное состояние не уезжает в мир", () => {
  const nonFinite: [string, number][] = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  it.each(nonFinite)("spendGovernmentSupport отказывает на цене %s", (_label, value) => {
    const game = createDiscontentTestGame();

    const result = spendGovernmentSupport(game, "SUN", value);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/finite/i);
  });

  it("spendGovernmentSupport отказывает на отрицательной цене — она бы ДОБАВИЛА поддержку", () => {
    const game = createDiscontentTestGame();
    const before = game.countries.find(c => c.id === "SUN")!.politics.governmentSupport;

    const result = spendGovernmentSupport(game, "SUN", -10);

    expect(result.success).toBe(false);
    expect(game.countries.find(c => c.id === "SUN")!.politics.governmentSupport).toBe(before);
  });

  it("spendGovernmentSupport отказывает, когда сама поддержка уже NaN", () => {
    const game = createDiscontentTestGame();
    game.countries.find(c => c.id === "SUN")!.politics.governmentSupport = Number.NaN;

    const result = spendGovernmentSupport(game, "SUN", 8);

    // Без этой ветки `NaN < 8` ложно, проверка платёжеспособности пропускает, и
    // шкала остаётся NaN уже официально «оплаченной».
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/finite/i);
  });

  it.each(nonFinite)("shiftCountryIdeology отказывает на дельте %s и не трогает координаты", (_label, value) => {
    const game = createDiscontentTestGame();
    const politics = game.countries.find(c => c.id === "SUN")!.politics;
    const before = structuredClone(resolveIdeologyCoordinates(politics));

    const result = shiftCountryIdeology(game, "SUN", 0.1, value);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/finite/i);
    expect(resolveIdeologyCoordinates(politics)).toEqual(before);
  });

  it("недовольство региона остаётся числом после отказа обеих команд", () => {
    const game = createDiscontentTestGame();
    game.countries.find(c => c.id === "SUN")!.politics.governmentSupport = Number.NaN;

    spendGovernmentSupport(game, "SUN", 8);
    shiftCountryIdeology(game, "SUN", Number.NaN, Number.NaN);
    discontentTick(game);

    const region = game.regions.find(r => r.id === TEST_REGION_NATIONAL)!;
    expect(Number.isNaN(regionDiscontent(game, region))).toBe(false);
    expect(game.regionCrisisLatch).toContain(TEST_REGION_NATIONAL);
  });
});
