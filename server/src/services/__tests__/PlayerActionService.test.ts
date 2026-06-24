import { describe, it, expect, beforeEach } from "vitest";
import { PlayerActionService } from "../PlayerActionService";
import { createTestGameState } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";
import { GameError } from "../../errors/AppError";

describe("PlayerActionService", () => {
  let service: PlayerActionService;
  let game: GameState;

  beforeEach(() => {
    service = new PlayerActionService();
    game = createTestGameState();
  });

  describe("createAction", () => {
    it("создаёт действие с локализованными title/description по типу", () => {
      const action = service.createAction(game, { type: "build_factory", regionId: 5 });
      expect(action.type).toBe("build_factory");
      expect(action.regionId).toBe(5);
      expect(action.title).toBe("Строительство завода");
      expect(action.description).toBe("Строительство нового промышленного предприятия");
      expect(action.id).toMatch(/^action-/);
    });

    it("добавляет действие в game.playerActions", () => {
      const action = service.createAction(game, { type: "build_mine", regionId: 2 });
      expect(game.playerActions).toContain(action);
      expect(game.playerActions).toHaveLength(1);
    });

    it("прокидывает parameters, если они переданы", () => {
      const action = service.createAction(game, {
        type: "recruit_units",
        regionId: 1,
        parameters: { count: 3 },
      });
      expect(action.parameters).toEqual({ count: 3 });
    });

    it("не добавляет ключ parameters, если они не переданы", () => {
      const action = service.createAction(game, { type: "build_infrastructure", regionId: 1 });
      expect("parameters" in action).toBe(false);
    });

    it("покрывает все известные типы действий title/description", () => {
      const types = ["build_factory", "build_mine", "build_infrastructure", "recruit_units"] as const;
      for (const type of types) {
        const action = service.createAction(game, { type, regionId: 1 });
        expect(action.title).not.toBe("Действие");
        expect(action.description).not.toBe("");
      }
    });
  });

  describe("deleteAction", () => {
    it("удаляет действие по id", () => {
      const action = service.createAction(game, { type: "build_factory", regionId: 1 });
      service.deleteAction(game, action.id);
      expect(game.playerActions).toHaveLength(0);
    });

    it("удаляет только указанное действие", () => {
      const a1 = service.createAction(game, { type: "build_factory", regionId: 1 });
      const a2 = service.createAction(game, { type: "build_mine", regionId: 2 });
      service.deleteAction(game, a1.id);
      expect(game.playerActions).toEqual([a2]);
    });

    it("бросает GameError для несуществующего id", () => {
      expect(() => service.deleteAction(game, "missing")).toThrow(GameError);
    });
  });
});
