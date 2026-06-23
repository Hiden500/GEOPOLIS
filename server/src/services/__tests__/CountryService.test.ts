import { describe, it, expect, beforeEach } from "vitest";
import { CountryService } from "../CountryService";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { type Country } from "@shared/types/Country";

describe("CountryService", () => {
  let service: CountryService;

  beforeEach(() => {
    service = new CountryService();
  });

  describe("updateBudget", () => {
    it("записывает новые статьи расходов и пересчитывает budgetBalance", () => {
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          taxRevenue: 100,
          exportIncome: 0,
          stateEnterpriseIncome: 0,
          otherIncome: 0,
          debtInterest: 0,
          otherExpenses: 0,
        },
      });

      const economy = service.updateBudget(country, {
        militarySpending: 10,
        researchSpending: 20,
        educationSpending: 5,
        infrastructureSpending: 5,
        welfareSpending: 10,
      });

      expect(economy.militarySpending).toBe(10);
      expect(economy.researchSpending).toBe(20);
      expect(economy.educationSpending).toBe(5);
      expect(economy.infrastructureSpending).toBe(5);
      expect(economy.welfareSpending).toBe(10);
      // income 100 - expenses (10+20+5+5+10) = 50
      expect(economy.budgetBalance).toBe(50);
    });

    it("учитывает все источники дохода и фиксированные расходы (debtInterest/otherExpenses)", () => {
      const country = createTestCountry({
        economy: {
          ...createTestCountry().economy,
          taxRevenue: 50,
          exportIncome: 20,
          stateEnterpriseIncome: 20,
          otherIncome: 10,
          debtInterest: 5,
          otherExpenses: 5,
        },
      });

      const economy = service.updateBudget(country, {
        militarySpending: 0,
        researchSpending: 0,
        educationSpending: 0,
        infrastructureSpending: 0,
        welfareSpending: 0,
      });

      // income 100 - expenses (0 + debtInterest 5 + otherExpenses 5) = 90
      expect(economy.budgetBalance).toBe(90);
    });

    it("мутирует переданный объект страны (возвращает ту же ссылку economy)", () => {
      const country = createTestCountry();
      const economy = service.updateBudget(country, {
        militarySpending: 1,
        researchSpending: 1,
        educationSpending: 1,
        infrastructureSpending: 1,
        welfareSpending: 1,
      });
      expect(economy).toBe(country.economy);
      expect(country.economy.militarySpending).toBe(1);
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
