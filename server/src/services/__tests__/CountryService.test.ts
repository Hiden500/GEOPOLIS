import { describe, it, expect, beforeEach } from "vitest";
import { CountryService } from "../CountryService";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { economyTick } from "../../simulation/economy/EconomyTick";
import { type Country } from "@shared/types/Country";

describe("CountryService", () => {
  let service: CountryService;

  beforeEach(() => {
    service = new CountryService();
  });

  describe("updateBudget", () => {
    // Импорт во всех фикстурах ниже НЕНУЛЕВОЙ намеренно: на нулевом импорте
    // «доли от полного дохода» и «доли от располагаемого» дают одно и то же
    // число, и тест перестаёт различать формулы.
    it("сохраняет доли в spendingShares и выводит *Spending = располагаемый доход × доля немедленно", () => {
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          taxRevenue: 100,
          exportIncome: 0,
          stateEnterpriseIncome: 0,
          otherIncome: 0,
          importSpending: 20,
          debtInterest: 0,
          otherExpenses: 0,
        },
      });

      const economy = service.updateBudget(country, {
        military: 0.1,
        research: 0.2,
        education: 0.05,
        infrastructure: 0.05,
        welfare: 0.1,
      });

      expect(economy.spendingShares).toEqual({
        military: 0.1, research: 0.2, education: 0.05, infrastructure: 0.05, welfare: 0.1,
      });
      // доход 100, импорт 20 → база росписи 80: 8 + 16 + 4 + 4 + 8 = 40
      expect(economy.militarySpending).toBe(8);
      expect(economy.researchSpending).toBe(16);
      expect(economy.educationSpending).toBe(4);
      expect(economy.infrastructureSpending).toBe(4);
      expect(economy.welfareSpending).toBe(8);
      // баланс = доход 100 − (пять статей 40 + импорт 20)
      expect(economy.budgetBalance).toBe(40);
    });

    it("учитывает все источники дохода и все обязательные расходы (debtInterest/otherExpenses/importSpending)", () => {
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          taxRevenue: 50,
          exportIncome: 20,
          stateEnterpriseIncome: 20,
          otherIncome: 10,
          importSpending: 12,
          debtInterest: 5,
          otherExpenses: 5,
        },
      });

      const economy = service.updateBudget(country, {
        military: 0, research: 0, education: 0, infrastructure: 0, welfare: 0,
      });

      // income 100 - expenses (0 + debtInterest 5 + otherExpenses 5 + импорт 12) = 78
      expect(economy.budgetBalance).toBe(78);
    });

    it("импорт больше дохода не делает роспись отрицательной", () => {
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          taxRevenue: 100,
          exportIncome: 0,
          stateEnterpriseIncome: 0,
          otherIncome: 0,
          importSpending: 250,
          debtInterest: 0,
          otherExpenses: 0,
        },
      });

      const economy = service.updateBudget(country, {
        military: 0.2, research: 0.1, education: 0.1, infrastructure: 0.05, welfare: 0.05,
      });

      expect(economy.militarySpending).toBe(0);
      expect(economy.welfareSpending).toBe(0);
      // Дефицит остаётся дефицитом: страна купила больше, чем заработала.
      expect(economy.budgetBalance).toBe(-150);
    });

    it("показывает игроку тот же budgetBalance, который при неизменном состоянии посчитает следующий ход", () => {
      // Свойство, ради которого правка и делалась: сохранение росписи и
      // economyTick обязаны сойтись в ОДНОМ числе, а не каждый быть правдоподобным
      // по отдельности. debt/debtInterest обнулены, чтобы сравнение не размывалось
      // пересчётом процентов внутри тика — он к базе росписи отношения не имеет.
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          importSpending: 30_000_000_000,
          debt: 0,
          debtInterest: 0,
        },
      });

      const shares = {
        military: 0.2, research: 0.1, education: 0.1, infrastructure: 0.05, welfare: 0.05,
      };
      const shownToPlayer = service.updateBudget(country, shares).budgetBalance;

      // Состояние между сохранением и ходом не менялось.
      economyTick(country, []);

      expect(country.economy.budgetBalance).toBe(shownToPlayer);
    });

    it("мутирует переданный объект страны (возвращает ту же ссылку economy)", () => {
      const country = createTestCountry();
      const economy = service.updateBudget(country, {
        military: 0.01, research: 0.01, education: 0.01, infrastructure: 0.01, welfare: 0.01,
      });
      expect(economy).toBe(country.economy);
      expect(country.economy.spendingShares?.military).toBe(0.01);
    });
  });

  describe("findCountryById", () => {
    it("возвращает страну по id", () => {
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });
      expect(service.findCountryById([a, b], "B")).toBe(b);
    });

    it("возвращает null, если страна не найдена", () => {
      const a = createTestCountry({ id: "A" });
      expect(service.findCountryById([a], "MISSING")).toBeNull();
    });

    it("возвращает null для пустого списка", () => {
      expect(service.findCountryById([], "A")).toBeNull();
    });
  });

  describe("getCountryRegions", () => {
    it("возвращает только регионы, принадлежащие стране", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A" });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "B" });
      const r3 = createTestRegion({ id: 3, ownerCountryId: "A" });
      const result = service.getCountryRegions([r1, r2, r3], "A");
      expect(result.map(r => r.id)).toEqual([1, 3]);
    });

    it("возвращает пустой массив, если регионов нет", () => {
      expect(service.getCountryRegions([], "A")).toEqual([]);
    });
  });

  describe("calculateTotalGDP", () => {
    it("возвращает economy.gdp страны", () => {
      const country = createTestCountry({
        economy: { ...createTestCountry().economy, gdp: 123 },
      });
      expect(service.calculateTotalGDP(country)).toBe(123);
    });
  });

  describe("calculateGDPPerCapita", () => {
    it("делит ВВП на население", () => {
      const country = createTestCountry({
        population: 1000,
        economy: { ...createTestCountry().economy, gdp: 2000 },
      });
      expect(service.calculateGDPPerCapita(country)).toBe(2);
    });

    it("возвращает 0 при нулевом населении (без деления на ноль)", () => {
      const country = createTestCountry({
        population: 0,
        economy: { ...createTestCountry().economy, gdp: 2000 },
      });
      expect(service.calculateGDPPerCapita(country)).toBe(0);
    });
  });

  describe("canAfford", () => {
    it("true, когда казны хватает (включая равенство)", () => {
      const country = createTestCountry({
        economy: { ...createTestCountry().economy, treasury: 100 },
      });
      expect(service.canAfford(country, 50)).toBe(true);
      expect(service.canAfford(country, 100)).toBe(true);
    });

    it("false, когда казны не хватает", () => {
      const country = createTestCountry({
        economy: { ...createTestCountry().economy, treasury: 100 },
      });
      expect(service.canAfford(country, 101)).toBe(false);
    });
  });

  describe("getNeighborCountries", () => {
    it("находит соседей через neighboringRegionIds, исключая саму страну", () => {
      // A владеет регионом 1 (сосед 2 -> B и 3 -> C); регион 4 -> A не сосед сам себе
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [2, 3, 4] });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "B", neighboringRegionIds: [1] });
      const r3 = createTestRegion({ id: 3, ownerCountryId: "C", neighboringRegionIds: [1] });
      const r4 = createTestRegion({ id: 4, ownerCountryId: "A", neighboringRegionIds: [1] });
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });
      const c = createTestCountry({ id: "C" });

      const neighbors = service.getNeighborCountries(a, [a, b, c], [r1, r2, r3, r4]);
      expect(neighbors.map(c => c.id).sort()).toEqual(["B", "C"]);
    });

    it("не дублирует страну, граничащую несколькими регионами", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [2, 3] });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "B", neighboringRegionIds: [1] });
      const r3 = createTestRegion({ id: 3, ownerCountryId: "B", neighboringRegionIds: [1] });
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      const neighbors = service.getNeighborCountries(a, [a, b], [r1, r2, r3]);
      expect(neighbors.map(c => c.id)).toEqual(["B"]);
    });

    it("возвращает пустой массив, если у страны нет регионов", () => {
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });
      expect(service.getNeighborCountries(a, [a, b], [])).toEqual([]);
    });

    it("игнорирует висячие neighboringRegionIds (несуществующие регионы)", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [99] });
      const a = createTestCountry({ id: "A" });
      expect(service.getNeighborCountries(a, [a], [r1])).toEqual([]);
    });
  });
});
