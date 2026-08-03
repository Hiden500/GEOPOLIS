import { describe, it, expect } from "vitest";
import { militaryTick, equipmentResourceCoverage } from "./MilitaryTick";
import { createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { UnitType } from "@shared/types/military/UnitType";
import {
  ACTIVE_PERSONNEL_SHARE,
  RESERVE_PERSONNEL_SHARE,
  WAR_MATERIAL_RESOURCE_IDS,
  EQUIPMENT_RESOURCE_DEMAND_SCALE,
} from "@shared/defines/military";
import { type Country } from "@shared/types/Country";

describe("militaryTick", () => {
  it("grows manpower based on owned regions' population", () => {
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id, population: 10_000_000 });
    const manpowerBefore = country.military.manpower;

    militaryTick(country, [region]);

    expect(country.military.manpower).toBeGreaterThan(manpowerBefore);
  });

  it("halves manpower gain when political stability is below 50", () => {
    const stableCountry = createTestCountry({ id: "STABLE", politics: { ...createTestCountry().politics, stability: 80 } });
    const unstableCountry = createTestCountry({ id: "UNSTABLE", politics: { ...createTestCountry().politics, stability: 10 } });
    const stableRegion = createTestRegion({ id: 1, ownerCountryId: "STABLE", population: 10_000_000 });
    const unstableRegion = createTestRegion({ id: 2, ownerCountryId: "UNSTABLE", population: 10_000_000 });

    militaryTick(stableCountry, [stableRegion]);
    militaryTick(unstableCountry, [unstableRegion]);

    const stableGain = stableCountry.military.manpower - createTestCountry().military.manpower;
    const unstableGain = unstableCountry.military.manpower - createTestCountry().military.manpower;

    expect(unstableGain).toBeLessThan(stableGain);
  });

  it("recovers damaged unit strength up to a cap of 100", () => {
    const country = createTestCountry();
    country.military.units = [
      { id: "u1", name: "1st Infantry", type: UnitType.Infantry, strength: 50, experience: 0, regionId: 1 },
    ];

    militaryTick(country, []);

    expect(country.military.units[0]!.strength).toBeGreaterThan(50);
    expect(country.military.units[0]!.strength).toBeLessThanOrEqual(100);
  });

  it("пул manpower задаёт ПОТОЛОК армии: раздутая activePersonnel ужимается до доли", () => {
    // Фикстура: activePersonnel (500k) выше потолка (10% от manpower) — армия
    // больше пула держаться не может и садится ровно на потолок.
    const country = createTestCountry();
    const region = createTestRegion({ ownerCountryId: country.id });

    militaryTick(country, [region]);

    expect(country.military.activePersonnel).toBe(Math.floor(country.military.manpower * ACTIVE_PERSONNEL_SHARE));
    expect(country.military.reservePersonnel).toBe(Math.floor(country.military.manpower * RESERVE_PERSONNEL_SHARE));
  });

  /**
   * НЕГАТИВНЫЙ КОНТРОЛЬ к правке 2026-07-31 («потери не доезжают»). До неё
   * militaryTick присваивал activePersonnel = manpower × доля, поэтому оба
   * теста ниже падали бы: армия возвращалась к потолку одним тиком, и потери
   * прошлого месяца исчезали бесследно.
   */
  describe("armia — запас, а не производное поле (потери переживают следующий тик)", () => {
    function countryWithArmy(manpower: number, activePersonnel: number) {
      const base = createTestCountry();
      return createTestCountry({
        military: { ...base.military, manpower, activePersonnel },
      });
    }

    it("выбитая под ноль армия не возвращается к потолку за один тик", () => {
      const country = countryWithArmy(1_000_000, 0);

      militaryTick(country, []);

      const ceiling = Math.floor(country.military.manpower * ACTIVE_PERSONNEL_SHARE);
      expect(country.military.activePersonnel).toBeGreaterThan(0);
      expect(country.military.activePersonnel).toBeLessThan(ceiling);
    });

    it("потеря половины армии видна и через тик — армия ниже нетронутой", () => {
      const intact = countryWithArmy(1_000_000, 100_000);
      const bled = countryWithArmy(1_000_000, 50_000);

      militaryTick(intact, []);
      militaryTick(bled, []);

      expect(bled.military.activePersonnel).toBeLessThan(intact.military.activePersonnel);
    });

    it("восстановление занимает месяцы, а не один тик", () => {
      const country = countryWithArmy(1_000_000, 0);
      const ceiling = Math.floor(country.military.manpower * ACTIVE_PERSONNEL_SHARE);

      // Без территории manpower не растёт — потолок неподвижен, меряется
      // именно скорость набора, а не рост пула.
      let months = 0;
      while (country.military.activePersonnel < ceiling && months < 200) {
        militaryTick(country, []);
        months++;
      }

      expect(months).toBeGreaterThan(1);
    });
  });

  it("does not throw when the country owns no regions", () => {
    const country = createTestCountry();

    expect(() => militaryTick(country, [])).not.toThrow();
  });

  describe("производство техники (War Phase 2, 2026-07-06)", () => {
    it("без явного productionAllocation все 8 категорий получают равную долю", () => {
      const country = createTestCountry();

      militaryTick(country, []);

      const gains = Object.values(country.military.equipment);
      expect(gains.every(g => g > 0)).toBe(true);
      const first = gains[0]!;
      for (const g of gains) {
        expect(g).toBeCloseTo(first);
      }
    });

    it("явная доля в productionAllocation даёт этой категории больше остальных", () => {
      const country = createTestCountry({
        military: {
          ...createTestCountry().military,
          productionAllocation: { tanks: 0.7 },
        },
      });

      militaryTick(country, []);

      expect(country.military.equipment.tanks).toBeGreaterThan(country.military.equipment.rifles);
    });

    it("прирост техники растёт с militarySpending", () => {
      const lowSpend = createTestCountry({
        id: "LOW",
        economy: { ...createTestCountry().economy, militarySpending: 5_000_000_000 },
      });
      const highSpend = createTestCountry({
        id: "HIGH",
        economy: { ...createTestCountry().economy, militarySpending: 50_000_000_000 },
      });

      militaryTick(lowSpend, []);
      militaryTick(highSpend, []);

      expect(highSpend.military.equipment.rifles).toBeGreaterThan(lowSpend.military.equipment.rifles);
    });

    it("не производит технику при нулевом militarySpending (страна без территории)", () => {
      const country = createTestCountry({
        economy: { ...createTestCountry().economy, militarySpending: 0 },
      });

      militaryTick(country, []);

      expect(Object.values(country.military.equipment).every(v => v === 0)).toBe(true);
    });
  });

  /**
   * ГЕЙТ СЫРЬЯ (вариант А, решение пользователя 2026-08-02, docs/IDEAS.md §11).
   *
   * НЕГАТИВНЫЙ КОНТРОЛЬ: на восстановленном старом поведении (gain без
   * множителя coverage) падают тесты «без военного сырья техника не
   * производится», «половинное покрытие — половинный выпуск» и «производство
   * потребляет сырьё» — проверено отключением множителя перед коммитом,
   * числа в отчёте задачи.
   */
  describe("гейт сырья (вариант А, 2026-08-02)", () => {
    /** Страна с заданными запасами ВОЕННОГО сырья; остальное — из фикстуры. */
    function countryWithWarStock(id: string, total: number): Country {
      const base = createTestCountry({ id });
      for (const r of WAR_MATERIAL_RESOURCE_IDS) base.stockpile[r] = 0;
      base.stockpile[WAR_MATERIAL_RESOURCE_IDS[0]!] = total;
      return base;
    }

    const totalEquipment = (c: Country): number =>
      Object.values(c.military.equipment).reduce((s, v) => s + (v as number), 0);

    describe("формула покрытия — граничные случаи", () => {
      it("нулевой спрос — покрытие 1 (гейт не активен)", () => {
        expect(equipmentResourceCoverage(0, 0)).toBe(1);
        expect(equipmentResourceCoverage(500, 0)).toBe(1);
      });

      it("спрос есть, сырья нет — покрытие 0", () => {
        expect(equipmentResourceCoverage(0, 1000)).toBe(0);
      });

      it("сырьё ровно по спросу — покрытие 1", () => {
        expect(equipmentResourceCoverage(1000, 1000)).toBe(1);
      });

      it("избыток сырья не поднимает покрытие выше 1", () => {
        expect(equipmentResourceCoverage(50_000, 1000)).toBe(1);
      });

      it("покрыта половина спроса — покрытие 0.5", () => {
        expect(equipmentResourceCoverage(500, 1000)).toBe(0.5);
      });
    });

    it("без военного сырья техника не производится, деньги не спасают", () => {
      const country = countryWithWarStock("STARVED", 0);

      militaryTick(country, []);

      expect(country.economy.militarySpending).toBeGreaterThan(0);
      expect(totalEquipment(country)).toBe(0);
    });

    it("половинное покрытие — половинный выпуск", () => {
      const demand = createTestCountry().economy.militarySpending / EQUIPMENT_RESOURCE_DEMAND_SCALE;
      const starved = countryWithWarStock("HALF", demand / 2);
      const supplied = countryWithWarStock("FULL", demand * 10);

      militaryTick(starved, []);
      militaryTick(supplied, []);

      expect(totalEquipment(supplied)).toBeGreaterThan(0);
      expect(totalEquipment(starved)).toBeCloseTo(totalEquipment(supplied) / 2);
    });

    it("производство потребляет сырьё: покрытый спрос списывается со склада", () => {
      const demand = createTestCountry().economy.militarySpending / EQUIPMENT_RESOURCE_DEMAND_SCALE;
      const country = countryWithWarStock("EATER", demand * 4);

      militaryTick(country, []);

      const left = WAR_MATERIAL_RESOURCE_IDS
        .reduce((s, r) => s + (country.stockpile[r] ?? 0), 0);
      expect(left).toBeCloseTo(demand * 3);
    });

    it("невоенное сырьё (еда) гейт не трогает и не потребляет", () => {
      const country = countryWithWarStock("VEGGIE", 0);
      const foodBefore = country.stockpile.food;

      militaryTick(country, []);

      expect(country.stockpile.food).toBe(foodBefore);
    });
  });
});
