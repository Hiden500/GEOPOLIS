import { describe, it, expect } from "vitest";
import { DiplomacyService } from "../DiplomacyService";
import { createTestCountry } from "../../test-utils/fixtures";
import {
  RIVAL_ENTRY_RELATION_SHIFT,
  RIVAL_EXIT_RELATION_SHIFT,
} from "@shared/defines/diplomacy";

describe("DiplomacyService", () => {
  describe("changeRelation", () => {
    it("applies delta to the source country and half the delta to the target", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.changeRelation([a, b], "A", "B", 20);

      expect(a.diplomacy.relations["B"]).toBe(20);
      expect(b.diplomacy.relations["A"]).toBe(10);
    });

    it("clamps relation to [-100, 100]", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A", diplomacy: { ...createTestCountry().diplomacy, relations: { B: 90 } } });
      const b = createTestCountry({ id: "B" });

      service.changeRelation([a, b], "A", "B", 50);

      expect(a.diplomacy.relations["B"]).toBe(100);
    });

    it("does nothing if the source country does not exist", () => {
      const service = new DiplomacyService();
      const b = createTestCountry({ id: "B" });

      expect(() => service.changeRelation([b], "MISSING", "B", 10)).not.toThrow();
    });
  });

  describe("addAlly / removeAlly", () => {
    it("adds both countries to each other's ally list and improves relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.addAlly([a, b], "A", "B");

      expect(a.diplomacy.allies).toContain("B");
      expect(b.diplomacy.allies).toContain("A");
      expect(a.diplomacy.relations["B"]).toBe(20);
    });

    it("removes both countries from each other's ally list and worsens relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A", diplomacy: { ...createTestCountry().diplomacy, allies: ["B"] } });
      const b = createTestCountry({ id: "B", diplomacy: { ...createTestCountry().diplomacy, allies: ["A"] } });

      service.removeAlly([a, b], "A", "B");

      expect(a.diplomacy.allies).not.toContain("B");
      expect(b.diplomacy.allies).not.toContain("A");
      expect(a.diplomacy.relations["B"]).toBe(-30);
    });
  });

  describe("addRival / removeRival", () => {
    it("adds a rival and worsens relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.addRival([a, b], "A", "B");

      expect(a.diplomacy.rivals).toContain("B");
      // Число берётся из константы, а не переписывается сюда: совпадение
      // литерала в тесте с литералом в сервисе — ровно то, из-за чего −40
      // пережило опускание порога, который его вызывает.
      expect(a.diplomacy.relations["B"]).toBe(RIVAL_ENTRY_RELATION_SHIFT);
    });

    it("removes a rival and improves relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A", diplomacy: { ...createTestCountry().diplomacy, rivals: ["B"] } });
      const b = createTestCountry({ id: "B" });

      service.removeRival([a, b], "A", "B");

      expect(a.diplomacy.rivals).not.toContain("B");
      expect(a.diplomacy.relations["B"]).toBe(RIVAL_EXIT_RELATION_SHIFT);
    });

    it("полный цикл соперничество → примирение нейтрален по отношениям", () => {
      // Соперничество ВЫВОДИТСЯ из отношений тиком, а не объявляется отдельным
      // глаголом. Значит выведенный ярлык не имеет права работать насосом:
      // пара, поссорившаяся и помирившаяся, обязана вернуться туда, где была.
      // До 2026-07-31 вход стоил −40, а выход давал +20, и каждый цикл списывал
      // паре 30 пунктов ниоткуда — при пороге −70 это было незаметно, потому что
      // цикла не случалось ни разу.
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      // Обе стороны заводят соперника сами — так это и происходит в тике.
      service.addRival([a, b], "A", "B");
      service.addRival([a, b], "B", "A");
      service.removeRival([a, b], "A", "B");
      service.removeRival([a, b], "B", "A");

      expect(a.diplomacy.relations["B"]).toBeCloseTo(0, 10);
      expect(b.diplomacy.relations["A"]).toBeCloseTo(0, 10);
    });
  });

  describe("changeInfluence", () => {
    it("clamps influence to [0, 100]", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.changeInfluence([a, b], "A", "B", -10);
      expect(a.diplomacy.influence["B"]).toBe(0);

      service.changeInfluence([a, b], "A", "B", 150);
      expect(a.diplomacy.influence["B"]).toBe(100);
    });
  });

  describe("addToSphereOfInfluence / removeFromSphereOfInfluence", () => {
    it("adds a country to the sphere of influence and increases influence", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.addToSphereOfInfluence([a, b], "A", "B");

      expect(a.diplomacy.sphereOfInfluence).toContain("B");
      expect(a.diplomacy.influence["B"]).toBe(10);
    });

    it("removes a country from the sphere of influence and decreases influence", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({
        id: "A",
        diplomacy: { ...createTestCountry().diplomacy, sphereOfInfluence: ["B"], influence: { B: 30 } },
      });
      const b = createTestCountry({ id: "B" });

      service.removeFromSphereOfInfluence([a, b], "A", "B");

      expect(a.diplomacy.sphereOfInfluence).not.toContain("B");
      expect(a.diplomacy.influence["B"]).toBe(10);
    });
  });

  describe("addGuarantee / removeGuarantee", () => {
    it("adds a guarantee and improves relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.addGuarantee([a, b], "A", "B");

      expect(a.diplomacy.guarantees).toContain("B");
      expect(a.diplomacy.relations["B"]).toBe(15);
    });

    it("removes a guarantee and worsens relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A", diplomacy: { ...createTestCountry().diplomacy, guarantees: ["B"] } });
      const b = createTestCountry({ id: "B" });

      service.removeGuarantee([a, b], "A", "B");

      expect(a.diplomacy.guarantees).not.toContain("B");
      expect(a.diplomacy.relations["B"]).toBe(-20);
    });
  });

  describe("addSanction / removeSanction", () => {
    it("adds a sanction type and worsens relations", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.addSanction([a, b], "A", "B", "economic_sanctions");

      expect(a.diplomacy.sanctions["B"]).toEqual(["economic_sanctions"]);
      expect(a.diplomacy.relations["B"]).toBe(-25);
    });

    it("does not duplicate an existing sanction type", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });
      const b = createTestCountry({ id: "B" });

      service.addSanction([a, b], "A", "B", "economic_sanctions");
      service.addSanction([a, b], "A", "B", "economic_sanctions");

      expect(a.diplomacy.sanctions["B"]).toEqual(["economic_sanctions"]);
    });

    it("removes a sanction type and cleans up the empty entry", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({
        id: "A",
        diplomacy: { ...createTestCountry().diplomacy, sanctions: { B: ["economic_sanctions"] } },
      });
      const b = createTestCountry({ id: "B" });

      service.removeSanction([a, b], "A", "B", "economic_sanctions");

      expect(a.diplomacy.sanctions["B"]).toBeUndefined();
    });
  });

  describe("calculateDiplomaticTension", () => {
    it("returns 0 when there is no friction", () => {
      const service = new DiplomacyService();
      const a = createTestCountry({ id: "A" });

      expect(service.calculateDiplomaticTension(a, [a])).toBe(0);
    });

    it("accounts for rivals, sanctions and bad relations, capped at 100", () => {
      const service = new DiplomacyService();
      const b = createTestCountry({ id: "B" });
      const a = createTestCountry({
        id: "A",
        diplomacy: {
          ...createTestCountry().diplomacy,
          rivals: ["B"],
          relations: { B: -90 },
          sanctions: { B: ["economic_sanctions", "trade_embargo"] },
        },
      });

      const tension = service.calculateDiplomaticTension(a, [a, b]);

      expect(tension).toBeGreaterThan(0);
      expect(tension).toBeLessThanOrEqual(100);
    });
  });
});
