import { describe, it, expect, beforeEach } from "vitest";
import { ResearchService } from "../ResearchService";
import { createTestCountry } from "../../test-utils/fixtures";
import { ValidationError } from "../../errors/AppError";

describe("ResearchService", () => {
  let service: ResearchService;

  beforeEach(() => {
    service = new ResearchService();
  });

  describe("setAllocation", () => {
    it("задаёт долю домена в researchAllocation", () => {
      const country = createTestCountry({ technology: { domains: { armor: 0, naval: 0 } } });

      service.setAllocation(country, "armor", 0.6);

      expect(country.technology.researchAllocation).toEqual({ armor: 0.6 });
    });

    it("не трогает долю других доменов при повторном вызове для нового домена", () => {
      const country = createTestCountry({ technology: { domains: { armor: 0, naval: 0 } } });

      service.setAllocation(country, "armor", 0.5);
      service.setAllocation(country, "naval", 0.3);

      expect(country.technology.researchAllocation).toEqual({ armor: 0.5, naval: 0.3 });
    });

    it("перезаписывает долю того же домена", () => {
      const country = createTestCountry({ technology: { domains: { armor: 0 } } });

      service.setAllocation(country, "armor", 0.5);
      service.setAllocation(country, "armor", 0.2);

      expect(country.technology.researchAllocation).toEqual({ armor: 0.2 });
    });

    it("бросает ValidationError для несуществующего домена", () => {
      const country = createTestCountry({ technology: { domains: { armor: 0 } } });

      expect(() => service.setAllocation(country, "cyberwarfare", 0.5)).toThrow(ValidationError);
    });
  });

  describe("getTechnologyState", () => {
    it("возвращает прогресс и тир по каждому домену", () => {
      const country = createTestCountry({
        technology: { domains: { armor: 250, naval: 50 } },
      });

      const state = service.getTechnologyState(country);

      expect(state.domains.armor).toEqual({ progress: 250, tier: 2 });
      expect(state.domains.naval).toEqual({ progress: 50, tier: 0 });
    });

    it("возвращает текущее распределение фокуса", () => {
      const country = createTestCountry({
        technology: { domains: { armor: 0 }, researchAllocation: { armor: 0.6 } },
      });

      const state = service.getTechnologyState(country);

      expect(state.researchAllocation).toEqual({ armor: 0.6 });
    });

    it("возвращает пустое распределение, если не задано", () => {
      const country = createTestCountry({ technology: { domains: { armor: 0 } } });

      const state = service.getTechnologyState(country);

      expect(state.researchAllocation).toEqual({});
    });
  });
});
