import { describe, it, expect } from "vitest";
import { getEligibleHingePoints, MAX_HINGE_POINT_SHOWS } from "@shared/utils/hingePoints";
import { type HistoricalHingePoint } from "@shared/types/HistoricalHingePoint";
import { createTestGameState, createTestCountry } from "../../test-utils/fixtures";

function makeHingePoint(overrides: Partial<HistoricalHingePoint> = {}): HistoricalHingePoint {
  return {
    id: "test_hinge",
    title: "Test Hinge Point",
    windowStart: "1946-01",
    windowEnd: "1946-12",
    primaryCountries: ["USA", "SUN"],
    historicalOutcome: "Something historically plausible happens.",
    preconditions: [],
    baseWeight: 0.8,
    divergenceHint: "Could be avoided if relations improve.",
    representable: true,
    ...overrides,
  };
}

describe("getEligibleHingePoints (независимый гейм-дизайн разбор, 2026-07-06)", () => {
  it("возвращает развилку без предусловий внутри окна дат", () => {
    const game = createTestGameState({ currentDate: "1946-06-01" });
    const catalog = [makeHingePoint()];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(1);
  });

  it("не возвращает развилку до начала окна", () => {
    const game = createTestGameState({ currentDate: "1945-12-01" });
    const catalog = [makeHingePoint({ windowStart: "1946-01", windowEnd: "1946-12" })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("не возвращает развилку после конца окна", () => {
    const game = createTestGameState({ currentDate: "1947-01-01" });
    const catalog = [makeHingePoint({ windowStart: "1946-01", windowEnd: "1946-12" })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("не возвращает нерепрезентативную развилку (representable: false)", () => {
    const game = createTestGameState({ currentDate: "1946-06-01" });
    const catalog = [makeHingePoint({ representable: false })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("relationBelow: возвращает развилку, если отношение ниже порога", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      countries: [createTestCountry({ id: "SUN", diplomacy: { ...createTestCountry().diplomacy, relations: { USA: 10 } } })],
    });
    const catalog = [makeHingePoint({ preconditions: [{ type: "relationBelow", a: "SUN", b: "USA", threshold: 40 }] })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(1);
  });

  it("relationBelow: не возвращает, если отношение выше порога", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      countries: [createTestCountry({ id: "SUN", diplomacy: { ...createTestCountry().diplomacy, relations: { USA: 60 } } })],
    });
    const catalog = [makeHingePoint({ preconditions: [{ type: "relationBelow", a: "SUN", b: "USA", threshold: 40 }] })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("relationAbove: возвращает развилку, если отношение выше порога", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      countries: [createTestCountry({ id: "SUN", diplomacy: { ...createTestCountry().diplomacy, relations: { CHN: -10 } } })],
    });
    const catalog = [makeHingePoint({ preconditions: [{ type: "relationAbove", a: "SUN", b: "CHN", threshold: -20 }] })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(1);
  });

  it("noGuaranteeFrom: возвращает развилку, если гарантии нет", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      countries: [createTestCountry({ id: "USA" })],
    });
    const catalog = [makeHingePoint({ preconditions: [{ type: "noGuaranteeFrom", target: "TWN", guarantor: "USA" }] })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(1);
  });

  it("noGuaranteeFrom: не возвращает, если гарантия уже дана", () => {
    const usa = createTestCountry({ id: "USA" });
    usa.diplomacy.guarantees.push("TWN");
    const game = createTestGameState({ currentDate: "1946-06-01", countries: [usa] });
    const catalog = [makeHingePoint({ preconditions: [{ type: "noGuaranteeFrom", target: "TWN", guarantor: "USA" }] })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("stabilityBelow: возвращает развилку, если stability ниже порога", () => {
    const grc = createTestCountry({ id: "GRC", politics: { ...createTestCountry().politics, stability: 30 } });
    const game = createTestGameState({ currentDate: "1946-06-01", countries: [grc] });
    const catalog = [makeHingePoint({ preconditions: [{ type: "stabilityBelow", country: "GRC", threshold: 45 }] })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(1);
  });

  it("требует ВСЕ предусловия одновременно, не любое из них", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      countries: [
        createTestCountry({ id: "SUN", diplomacy: { ...createTestCountry().diplomacy, relations: { CHN: -10 } } }),
        createTestCountry({ id: "TWN" }), // не имеет гаранта — это условие тоже пройдёт
      ],
    });
    const usaWithGuarantee = createTestCountry({ id: "USA" });
    usaWithGuarantee.diplomacy.guarantees.push("TWN"); // ломает второе предусловие
    game.countries.push(usaWithGuarantee);

    const catalog = [makeHingePoint({
      preconditions: [
        { type: "relationAbove", a: "SUN", b: "CHN", threshold: -20 },
        { type: "noGuaranteeFrom", target: "TWN", guarantor: "USA" },
      ],
    })];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("перестаёт показываться после MAX_HINGE_POINT_SHOWS показов, даже если окно ещё открыто", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      hingePointShowCount: { test_hinge: MAX_HINGE_POINT_SHOWS },
    });
    const catalog = [makeHingePoint()];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(0);
  });

  it("всё ещё показывается на MAX_HINGE_POINT_SHOWS - 1 показов", () => {
    const game = createTestGameState({
      currentDate: "1946-06-01",
      hingePointShowCount: { test_hinge: MAX_HINGE_POINT_SHOWS - 1 },
    });
    const catalog = [makeHingePoint()];
    expect(getEligibleHingePoints(game, catalog)).toHaveLength(1);
  });
});
