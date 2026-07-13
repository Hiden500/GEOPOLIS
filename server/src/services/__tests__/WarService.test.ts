import { describe, it, expect, beforeEach } from "vitest";
import { WarService } from "../WarService";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { setRegionOccupation } from "../../simulation/war/occupation";
import { type GameState } from "@shared/types/GameState";

describe("WarService", () => {
  let game: GameState;
  let service: WarService;

  beforeEach(() => {
    game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA" }),
        createTestCountry({ id: "USSR" }),
      ],
    });
    service = new WarService(game);
  });

  describe("declareWar", () => {
    it("создаёт войну с инициатором/целью и добавляет её в game.wars", () => {
      const war = service.declareWar("USA", "USSR");

      expect(war.attackers).toEqual(["USA"]);
      expect(war.defenders).toEqual(["USSR"]);
      expect(war.active).toBe(true);
      expect(war.startDate).toBe(game.currentDate);
      expect(war.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 0 });
      expect(game.wars).toContain(war);
    });

    it("идемпотентно: повторный вызов для той же пары возвращает ту же войну", () => {
      const first = service.declareWar("USA", "USSR");
      const second = service.declareWar("USA", "USSR");

      expect(second).toBe(first);
      expect(game.wars).toHaveLength(1);
    });

    it("сохраняет warGoal, если передан", () => {
      const war = service.declareWar("USA", "USSR", "Contain communism");
      expect(war.warGoal).toBe("Contain communism");
    });

    it("не сохраняет warGoal, если не передан", () => {
      const war = service.declareWar("USA", "USSR");
      expect(war.warGoal).toBeUndefined();
    });

    it("коалиции: втягивает союзника инициатора на сторону атакующих", () => {
      const ally = createTestCountry({ id: "CAN" });
      ally.diplomacy.allies.push("USA");
      game.countries.find(c => c.id === "USA")!.diplomacy.allies.push("CAN");
      game.countries.push(ally);

      const war = service.declareWar("USA", "USSR");
      expect(war.attackers).toContain("CAN");
    });

    it("коалиции: втягивает гаранта независимости цели на сторону обороняющихся", () => {
      const guarantor = createTestCountry({ id: "GBR" });
      guarantor.diplomacy.guarantees.push("USSR");
      game.countries.push(guarantor);

      const war = service.declareWar("USA", "USSR");
      expect(war.defenders).toContain("GBR");
    });

    it("коалиции: собственные пуппеты инициатора идут на сторону атакующих", () => {
      game.countries.find(c => c.id === "USA")!.diplomacy.puppets.push("PHL");
      game.countries.push(createTestCountry({ id: "PHL" }));

      const war = service.declareWar("USA", "USSR");
      expect(war.attackers).toContain("PHL");
    });

    it("коалиции: сюзерен инициатора (если инициатор сам чей-то пуппет) идёт на сторону атакующих", () => {
      const overlord = createTestCountry({ id: "GBR" });
      overlord.diplomacy.puppets.push("USA");
      game.countries.push(overlord);

      const war = service.declareWar("USA", "USSR");
      expect(war.attackers).toContain("GBR");
    });

    it("не тянет транзитивно (союзник союзника не втягивается)", () => {
      const ally = createTestCountry({ id: "CAN" });
      ally.diplomacy.allies.push("MEX"); // союзник союзника
      game.countries.find(c => c.id === "USA")!.diplomacy.allies.push("CAN");
      game.countries.push(ally, createTestCountry({ id: "MEX" }));

      const war = service.declareWar("USA", "USSR");
      expect(war.attackers).toContain("CAN");
      expect(war.attackers).not.toContain("MEX");
    });
  });

  describe("getActiveWarBetween", () => {
    it("находит войну независимо от порядка аргументов", () => {
      const war = service.declareWar("USA", "USSR");
      expect(service.getActiveWarBetween("USA", "USSR")).toBe(war);
      expect(service.getActiveWarBetween("USSR", "USA")).toBe(war);
    });

    it("возвращает undefined, если войны нет", () => {
      expect(service.getActiveWarBetween("USA", "USSR")).toBeUndefined();
    });

    it("не находит завершённую (active: false) войну", () => {
      const war = service.declareWar("USA", "USSR");
      service.makePeace(war.id);
      expect(service.getActiveWarBetween("USA", "USSR")).toBeUndefined();
    });
  });

  describe("makePeace", () => {
    it("атакующие продвинулись — обороняющиеся проигрывают, легитимность падает", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 0 };
      const defenderBefore = game.countries.find(c => c.id === "USSR")!.politics.legitimacy;

      service.makePeace(war.id);

      const defender = game.countries.find(c => c.id === "USSR")!;
      const attacker = game.countries.find(c => c.id === "USA")!;
      expect(war.active).toBe(false);
      expect(defender.politics.legitimacy).toBeLessThan(defenderBefore);
      expect(attacker.politics.legitimacy).toBe(60); // fixture default, не тронут
    });

    it("обороняющиеся отбились — агрессор проигрывает жёстче (агрессор+проигравший)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 0, toDefenders: 3 };
      const attackerBefore = game.countries.find(c => c.id === "USA")!.politics.legitimacy;

      service.makePeace(war.id);

      const attacker = game.countries.find(c => c.id === "USA")!;
      const defender = game.countries.find(c => c.id === "USSR")!;
      expect(attacker.politics.legitimacy).toBeLessThan(attackerBefore);
      // Штраф агрессору строже обычного штрафа проигравшему
      expect(attackerBefore - attacker.politics.legitimacy).toBe(25);
      expect(defender.politics.legitimacy).toBe(60); // не тронут
    });

    it("решительная победа атакующих (loserFlips=0) — репарации из казны обороняющихся (2026-07-06)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 0 };
      const attackerTreasuryBefore = game.countries.find(c => c.id === "USA")!.economy.treasury;
      const defenderTreasuryBefore = game.countries.find(c => c.id === "USSR")!.economy.treasury;

      service.makePeace(war.id);

      const expectedTransfer = defenderTreasuryBefore * 0.1;
      expect(game.countries.find(c => c.id === "USA")!.economy.treasury)
        .toBeCloseTo(attackerTreasuryBefore + expectedTransfer);
      expect(game.countries.find(c => c.id === "USSR")!.economy.treasury)
        .toBeCloseTo(defenderTreasuryBefore - expectedTransfer);
    });

    it("решительная победа обороняющихся (winnerFlips>=2x) — репарации из казны агрессора (2026-07-06)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 1, toDefenders: 4 }; // 4 >= 1*2
      const attackerTreasuryBefore = game.countries.find(c => c.id === "USA")!.economy.treasury;
      const defenderTreasuryBefore = game.countries.find(c => c.id === "USSR")!.economy.treasury;

      service.makePeace(war.id);

      const expectedTransfer = attackerTreasuryBefore * 0.1;
      expect(game.countries.find(c => c.id === "USSR")!.economy.treasury)
        .toBeCloseTo(defenderTreasuryBefore + expectedTransfer);
      expect(game.countries.find(c => c.id === "USA")!.economy.treasury)
        .toBeCloseTo(attackerTreasuryBefore - expectedTransfer);
    });

    it("обычная (не решительная) победа — легитимность как раньше, репараций нет (2026-07-06)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 2 }; // ratio 1.5 < DECISIVE_FLIP_RATIO=2
      const attackerTreasuryBefore = game.countries.find(c => c.id === "USA")!.economy.treasury;
      const defenderTreasuryBefore = game.countries.find(c => c.id === "USSR")!.economy.treasury;

      service.makePeace(war.id);

      expect(game.countries.find(c => c.id === "USA")!.economy.treasury).toBe(attackerTreasuryBefore);
      expect(game.countries.find(c => c.id === "USSR")!.economy.treasury).toBe(defenderTreasuryBefore);
      expect(game.countries.find(c => c.id === "USSR")!.politics.legitimacy).toBeLessThan(60);
    });

    it("репарации не переводятся, если казна проигравшего уже отрицательна (2026-07-06)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 0 };
      game.countries.find(c => c.id === "USSR")!.economy.treasury = -50_000_000_000;
      const attackerTreasuryBefore = game.countries.find(c => c.id === "USA")!.economy.treasury;

      service.makePeace(war.id);

      expect(game.countries.find(c => c.id === "USA")!.economy.treasury).toBe(attackerTreasuryBefore);
      expect(game.countries.find(c => c.id === "USSR")!.economy.treasury).toBe(-50_000_000_000);
    });

    it("короткая ничья — легитимность не трогается", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 0, toDefenders: 0 };
      game.currentDate = "1946-06-01"; // 5 месяцев с начала

      service.makePeace(war.id);

      expect(game.countries.find(c => c.id === "USA")!.politics.legitimacy).toBe(60);
      expect(game.countries.find(c => c.id === "USSR")!.politics.legitimacy).toBe(60);
    });

    it("затянутая ничья — военная усталость бьёт по обеим сторонам", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 0, toDefenders: 0 };
      game.currentDate = "1949-06-01"; // 3.5 года — далеко за порогом 24 месяцев

      service.makePeace(war.id);

      expect(game.countries.find(c => c.id === "USA")!.politics.legitimacy).toBeLessThan(60);
      expect(game.countries.find(c => c.id === "USSR")!.politics.legitimacy).toBeLessThan(60);
    });

    it("убирает battalion MapFeature этой войны", () => {
      const war = service.declareWar("USA", "USSR");
      game.mapFeatures.push({
        id: "mf-1",
        type: "battalion",
        regionId: 1,
        tags: ["military", "battalion", `war:${war.id}`],
      });
      game.mapFeatures.push({
        id: "mf-2",
        type: "capital",
        tags: ["capital"],
      });

      service.makePeace(war.id);

      expect(game.mapFeatures.find(f => f.id === "mf-1")).toBeUndefined();
      expect(game.mapFeatures.find(f => f.id === "mf-2")).toBeDefined();
    });

    it("белый мир (warScore ниже порога) снимает всю оккупацию, граница не меняется (Шаг 2b)", () => {
      const war = service.declareWar("USA", "USSR");
      // territoryFlips/casualties по нулям → warScore 0 < порога аннексии 30.
      const occupiedRegion = createTestRegion({ id: 1, ownerCountryId: "USSR" });
      game.regions.push(occupiedRegion);
      setRegionOccupation(game, occupiedRegion, "USA");
      expect(game.modifiers).toHaveLength(1);

      service.makePeace(war.id);

      expect(occupiedRegion.ownerCountryId).toBe("USSR"); // не аннексирован
      expect(occupiedRegion.occupiedBy).toBeUndefined();
      expect(game.modifiers).toHaveLength(0);
    });

    it("решительная победа (warScore ≥ порога) аннексирует оккупированное победителю (Шаг 2b)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 0 }; // warScore = 45 ≥ 30
      const occupiedRegion = createTestRegion({ id: 1, ownerCountryId: "USSR" });
      game.regions.push(occupiedRegion);
      setRegionOccupation(game, occupiedRegion, "USA");

      service.makePeace(war.id);

      // maxAnnex = floor(45/25) = 1 → регион переходит США легально.
      expect(occupiedRegion.ownerCountryId).toBe("USA");
      expect(occupiedRegion.occupiedBy).toBeUndefined();
      expect(game.modifiers).toHaveLength(0); // модификатор оккупации снят при передаче
    });

    it("аннексия ограничена бюджетом очков — лишние оккупированные регионы возвращаются", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 2, toDefenders: 0 }; // warScore = 30 → maxAnnex = floor(30/25) = 1
      const r1 = createTestRegion({ id: 1, ownerCountryId: "USSR" });
      const r2 = createTestRegion({ id: 2, ownerCountryId: "USSR" });
      game.regions.push(r1, r2);
      setRegionOccupation(game, r1, "USA");
      setRegionOccupation(game, r2, "USA");

      service.makePeace(war.id);

      // Бюджет = 1 регион; по возрастанию id аннексируется r1, r2 возвращается.
      expect(r1.ownerCountryId).toBe("USA");
      expect(r2.ownerCountryId).toBe("USSR");
      expect(r2.occupiedBy).toBeUndefined();
    });

    it("проигравший-оккупант не аннексирует чужое (аннексирует только победитель по warScore)", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 0 }; // атакующие (USA) побеждают
      // Регион USA, оккупированный USSR (проигравшим) — не должен перейти USSR.
      const usaRegion = createTestRegion({ id: 1, ownerCountryId: "USA" });
      game.regions.push(usaRegion);
      setRegionOccupation(game, usaRegion, "USSR");

      service.makePeace(war.id);

      expect(usaRegion.ownerCountryId).toBe("USA"); // USSR проиграл — не аннексирует
      expect(usaRegion.occupiedBy).toBeUndefined();
    });

    it("не трогает оккупацию от параллельной войны между другими странами", () => {
      const war = service.declareWar("USA", "USSR");
      game.countries.push(createTestCountry({ id: "GBR" }), createTestCountry({ id: "FRA" }));
      const foreignOccupiedRegion = createTestRegion({ id: 2, ownerCountryId: "GBR" });
      game.regions.push(foreignOccupiedRegion);
      setRegionOccupation(game, foreignOccupiedRegion, "FRA");

      service.makePeace(war.id);

      expect(foreignOccupiedRegion.occupiedBy).toBe("FRA");
      expect(game.modifiers).toHaveLength(1);
    });

    it("не делает ничего для уже завершённой войны", () => {
      const war = service.declareWar("USA", "USSR");
      war.territoryFlips = { toAttackers: 3, toDefenders: 0 };
      service.makePeace(war.id);
      const defenderAfterFirst = game.countries.find(c => c.id === "USSR")!.politics.legitimacy;

      service.makePeace(war.id); // повторный вызов — не должен применять штраф ещё раз

      expect(game.countries.find(c => c.id === "USSR")!.politics.legitimacy).toBe(defenderAfterFirst);
    });
  });
});
