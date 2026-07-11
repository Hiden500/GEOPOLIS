import { describe, it, expect } from "vitest";
import * as commands from "../modifiers";
import { effectiveValue } from "@shared/utils/modifiers";
import { ModifierAttribute } from "@shared/defines/modifierAttributes";
import { createTestGameState } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";
import { type Modifier } from "@shared/types/Modifier";

const COUNTRY_TARGET = { kind: "country" as const, id: "USA" };

describe("shared/utils/modifiers — effectiveValue", () => {
  it("без модификаторов возвращает base как есть", () => {
    expect(effectiveValue(50, ModifierAttribute.Stability, COUNTRY_TARGET, [])).toBe(50);
  });

  it("суммирует add-модификаторы", () => {
    const modifiers: Modifier[] = [
      { id: "mod-000000", source: "event:a", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: -10 },
      { id: "mod-000001", source: "event:b", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: 5 },
    ];
    expect(effectiveValue(50, ModifierAttribute.Stability, COUNTRY_TARGET, modifiers)).toBe(45);
  });

  it("перемножает mul-модификаторы после суммирования add", () => {
    const modifiers: Modifier[] = [
      { id: "mod-000000", source: "event:a", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: 10 },
      { id: "mod-000001", source: "event:b", target: COUNTRY_TARGET, attribute: "stability", op: "mul", value: 0.5 },
    ];
    // (50 + 10) * 0.5 = 30
    expect(effectiveValue(50, ModifierAttribute.Stability, COUNTRY_TARGET, modifiers)).toBe(30);
  });

  it("игнорирует модификаторы с другим target или attribute", () => {
    const modifiers: Modifier[] = [
      { id: "mod-000000", source: "x", target: { kind: "country", id: "SUN" }, attribute: "stability", op: "add", value: 100 },
      { id: "mod-000001", source: "x", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: 5 },
    ];
    expect(effectiveValue(50, ModifierAttribute.Stability, COUNTRY_TARGET, modifiers)).toBe(55);
  });
});

function gameWithUsa(): GameState {
  return createTestGameState({ currentDate: "1946-06-01" });
}

describe("commands/modifiers", () => {
  describe("applyModifier", () => {
    it("создаёт модификатор со счётчик-id и добавляет в game.modifiers", () => {
      const game = gameWithUsa();
      const result = commands.applyModifier(game, {
        source: "event:coup",
        target: COUNTRY_TARGET,
        attribute: ModifierAttribute.Stability,
        op: "add",
        value: -10,
        expiresAt: "1946-12-01",
      });

      expect(result).toEqual({ success: true });
      expect(game.modifiers).toHaveLength(1);
      expect(game.modifiers[0]!.id).toBe("mod-000000");
      expect(game.nextFeatureId).toBe(1);
    });

    it("не коллизирует с id Map Feature — тот же счётчик, другой префикс", () => {
      const game = gameWithUsa();
      game.nextFeatureId = 5;
      commands.applyModifier(game, {
        source: "x", target: COUNTRY_TARGET, attribute: ModifierAttribute.Stability, op: "add", value: 1,
      });
      expect(game.modifiers[0]!.id).toBe("mod-000005");
      expect(game.nextFeatureId).toBe(6);
    });
  });

  describe("removeModifier", () => {
    it("удаляет модификатор по id", () => {
      const game = gameWithUsa();
      commands.applyModifier(game, {
        source: "x", target: COUNTRY_TARGET, attribute: ModifierAttribute.Stability, op: "add", value: 1,
      });
      const id = game.modifiers[0]!.id;

      const result = commands.removeModifier(game, id);
      expect(result).toEqual({ success: true });
      expect(game.modifiers).toHaveLength(0);
    });

    it("отклоняет неизвестный id", () => {
      const game = gameWithUsa();
      const result = commands.removeModifier(game, "mod-999999");
      expect(result.success).toBe(false);
    });
  });

  describe("removeExpiredModifiers", () => {
    it("удаляет модификаторы, чей expiresAt <= game.currentDate", () => {
      const game = gameWithUsa();
      game.currentDate = "1947-01-01";
      game.modifiers = [
        { id: "mod-000000", source: "x", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: 1, expiresAt: "1946-12-01" },
      ];

      commands.removeExpiredModifiers(game);
      expect(game.modifiers).toHaveLength(0);
    });

    it("сохраняет ещё не истёкшие", () => {
      const game = gameWithUsa();
      game.currentDate = "1946-06-01";
      game.modifiers = [
        { id: "mod-000000", source: "x", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: 1, expiresAt: "1946-12-01" },
      ];

      commands.removeExpiredModifiers(game);
      expect(game.modifiers).toHaveLength(1);
    });

    it("сохраняет постоянные (без expiresAt)", () => {
      const game = gameWithUsa();
      game.currentDate = "2000-01-01";
      game.modifiers = [
        { id: "mod-000000", source: "x", target: COUNTRY_TARGET, attribute: "stability", op: "add", value: 1 },
      ];

      commands.removeExpiredModifiers(game);
      expect(game.modifiers).toHaveLength(1);
    });
  });

  it("сквозная демонстрация: применённый модификатор влияет на effectiveValue и исчезает после истечения (критерий приёмки Шага 2)", () => {
    const game = gameWithUsa();
    game.currentDate = "1946-06-01";

    commands.applyModifier(game, {
      source: "event:coup",
      target: COUNTRY_TARGET,
      attribute: ModifierAttribute.Stability,
      op: "add",
      value: -10,
      expiresAt: "1946-12-01",
    });

    expect(effectiveValue(50, ModifierAttribute.Stability, COUNTRY_TARGET, game.modifiers)).toBe(40);

    game.currentDate = "1947-01-01";
    commands.removeExpiredModifiers(game);

    expect(game.modifiers).toHaveLength(0);
    expect(effectiveValue(50, ModifierAttribute.Stability, COUNTRY_TARGET, game.modifiers)).toBe(50);
  });
});
