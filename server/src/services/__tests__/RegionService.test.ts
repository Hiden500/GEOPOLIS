import { describe, it, expect, beforeEach } from "vitest";
import { RegionService } from "../RegionService";
import { createTestRegion } from "../../test-utils/fixtures";

describe("RegionService", () => {
  let service: RegionService;

  beforeEach(() => {
    service = new RegionService();
  });

  describe("findRegionById", () => {
    it("находит регион по id", () => {
      const r1 = createTestRegion({ id: 1 });
      const r2 = createTestRegion({ id: 2 });
      expect(service.findRegionById([r1, r2], 2)).toBe(r2);
    });

    it("возвращает null, если регион не найден", () => {
      expect(service.findRegionById([createTestRegion({ id: 1 })], 99)).toBeNull();
    });
  });

  describe("getNeighborRegions", () => {
    it("возвращает соседние регионы по neighboringRegionIds", () => {
      const r1 = createTestRegion({ id: 1, neighboringRegionIds: [2, 3] });
      const r2 = createTestRegion({ id: 2 });
      const r3 = createTestRegion({ id: 3 });
      const result = service.getNeighborRegions([r1, r2, r3], 1);
      expect(result.map(r => r.id).sort()).toEqual([2, 3]);
    });

    it("отбрасывает висячие id (несуществующие соседи)", () => {
      const r1 = createTestRegion({ id: 1, neighboringRegionIds: [2, 99] });
      const r2 = createTestRegion({ id: 2 });
      const result = service.getNeighborRegions([r1, r2], 1);
      expect(result.map(r => r.id)).toEqual([2]);
    });

    it("возвращает пустой массив для несуществующего региона", () => {
      expect(service.getNeighborRegions([createTestRegion({ id: 1 })], 99)).toEqual([]);
    });

    it("возвращает пустой массив, если соседей нет", () => {
      const r1 = createTestRegion({ id: 1, neighboringRegionIds: [] });
      expect(service.getNeighborRegions([r1], 1)).toEqual([]);
    });
  });

  describe("getCountryRegions", () => {
    it("фильтрует регионы по владельцу", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A" });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "B" });
      expect(service.getCountryRegions([r1, r2], "A").map(r => r.id)).toEqual([1]);
    });
  });

  describe("calculateRegionGDP", () => {
    it("считает по формуле population * development * infrastructure * 1000 с округлением вниз", () => {
      const region = createTestRegion({
        population: 1000,
        development: 0.5,
        infrastructure: 0.6,
      });
      // 1000 * 0.5 * 0.6 * 1000 = 300000
      expect(service.calculateRegionGDP(region)).toBe(300000);
    });

    it("округляет вниз дробный результат (Math.floor)", () => {
      const region = createTestRegion({
        population: 1,
        development: 0.333,
        infrastructure: 1,
      });
      // 1 * 0.333 * 1 * 1000 = 333 (после floor)
      expect(service.calculateRegionGDP(region)).toBe(333);
    });

    it("возвращает 0 при нулевом развитии", () => {
      const region = createTestRegion({ development: 0 });
      expect(service.calculateRegionGDP(region)).toBe(0);
    });
  });

  describe("bordersCountry", () => {
    it("true, если хотя бы один сосед принадлежит целевой стране", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [2] });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "B" });
      expect(service.bordersCountry([r1, r2], 1, "B")).toBe(true);
    });

    it("false, если ни один сосед не принадлежит целевой стране", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [2] });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "A" });
      expect(service.bordersCountry([r1, r2], 1, "B")).toBe(false);
    });

    it("false для несуществующего региона", () => {
      expect(service.bordersCountry([], 1, "B")).toBe(false);
    });
  });

  describe("getBorderRegions", () => {
    it("возвращает регионы страны, граничащие с целевой страной", () => {
      // A: регион 1 граничит с B (через 3), регион 2 не граничит с B
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [3] });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "A", neighboringRegionIds: [4] });
      const r3 = createTestRegion({ id: 3, ownerCountryId: "B" });
      const r4 = createTestRegion({ id: 4, ownerCountryId: "A" });
      const result = service.getBorderRegions([r1, r2, r3, r4], "A", "B");
      expect(result.map(r => r.id)).toEqual([1]);
    });

    it("возвращает пустой массив, если граница отсутствует", () => {
      const r1 = createTestRegion({ id: 1, ownerCountryId: "A", neighboringRegionIds: [] });
      expect(service.getBorderRegions([r1], "A", "B")).toEqual([]);
    });
  });
});
