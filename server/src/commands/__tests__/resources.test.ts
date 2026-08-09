import { describe, it, expect } from "vitest";
import * as commands from "../resources";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { EXTRACTION_BUILD_COST, MAX_EXTRACTION_LEVEL } from "@shared/defines/resources";

function gameWithRegion(regionOverrides: Parameters<typeof createTestRegion>[0] = {}) {
  const region = createTestRegion({
    id: 1, ownerCountryId: "USA", deposits: { oil: 1000 }, extraction: { oil: 5 }, ...regionOverrides,
  });
  const game = createTestGameState({ countries: [createTestCountry({ id: "USA" })], regions: [region] });
  return { game, region };
}

describe("commands/resources", () => {
  describe("buildExtraction", () => {
    it("увеличивает уровень на delta и списывает казну", () => {
      const { game, region } = gameWithRegion();
      const treasuryBefore = game.countries[0]!.economy.treasury;

      const result = commands.buildExtraction(game, "USA", 1, "oil", 1);

      expect(result).toEqual({ success: true });
      expect(region.extraction.oil).toBe(6);
      expect(game.countries[0]!.economy.treasury).toBe(treasuryBefore - EXTRACTION_BUILD_COST);
    });

    it("клампит до MAX_EXTRACTION_LEVEL, списывает только за реальный прирост", () => {
      const { game, region } = gameWithRegion({ extraction: { oil: MAX_EXTRACTION_LEVEL - 1 } });
      const treasuryBefore = game.countries[0]!.economy.treasury;

      commands.buildExtraction(game, "USA", 1, "oil", 5);

      expect(region.extraction.oil).toBe(MAX_EXTRACTION_LEVEL);
      expect(game.countries[0]!.economy.treasury).toBe(treasuryBefore - EXTRACTION_BUILD_COST);
    });

    /**
     * Ложный успех хуже отказа: применяющий код (`LLMService`) результат команды
     * отбрасывает, поэтому «успех, ничего не изменивший» доезжает до летописи как
     * выполненное действие. На сценарии 1946 это был не краевой случай, а норма —
     * все 2055 пар (регион, ресурс) с депозитом стоят ровно на потолке
     * (`server/scripts/probeResourceGates.ts`).
     */
    it("отклоняет наращивание на потолке — не рапортует успех, ничего не изменив", () => {
      const { game, region } = gameWithRegion({ extraction: { oil: MAX_EXTRACTION_LEVEL } });
      const treasuryBefore = game.countries[0]!.economy.treasury;

      const result = commands.buildExtraction(game, "USA", 1, "oil", 1);

      expect(result.success).toBe(false);
      expect(region.extraction.oil).toBe(MAX_EXTRACTION_LEVEL);
      expect(game.countries[0]!.economy.treasury).toBe(treasuryBefore);
    });

    it("отклоняет сворачивание на нуле — симметрично потолку", () => {
      const { game, region } = gameWithRegion({ extraction: { oil: 0 } });

      const result = commands.buildExtraction(game, "USA", 1, "oil", -1);

      expect(result.success).toBe(false);
      expect(region.extraction.oil).toBe(0);
    });

    it("отклоняет, если страна не контролирует регион", () => {
      const { game, region } = gameWithRegion({ ownerCountryId: "OTHER" });

      const result = commands.buildExtraction(game, "USA", 1, "oil", 1);

      expect(result.success).toBe(false);
      expect(region.extraction.oil).toBe(5);
    });

    it("отклоняет, если в регионе нет депозита ресурса", () => {
      const { game } = gameWithRegion({ deposits: {} });

      const result = commands.buildExtraction(game, "USA", 1, "oil", 1);
      expect(result.success).toBe(false);
    });

    it("отклоняет, если в казне не хватает средств", () => {
      const { game, region } = gameWithRegion();
      game.countries[0]!.economy.treasury = EXTRACTION_BUILD_COST - 1;

      const result = commands.buildExtraction(game, "USA", 1, "oil", 1);

      expect(result.success).toBe(false);
      expect(region.extraction.oil).toBe(5);
    });

    it("отрицательный delta снижает уровень бесплатно, без проверки контроля", () => {
      const { game, region } = gameWithRegion({ ownerCountryId: "OTHER" });
      const treasuryBefore = game.countries[0]!.economy.treasury;

      const result = commands.buildExtraction(game, "USA", 1, "oil", -2);

      expect(result).toEqual({ success: true });
      expect(region.extraction.oil).toBe(3);
      expect(game.countries[0]!.economy.treasury).toBe(treasuryBefore);
    });

    it("не опускает уровень ниже 0", () => {
      const { game, region } = gameWithRegion({ extraction: { oil: 1 } });

      commands.buildExtraction(game, "USA", 1, "oil", -5);
      expect(region.extraction.oil).toBe(0);
    });

    it("отклоняет неизвестную страну/регион", () => {
      const { game } = gameWithRegion();
      expect(commands.buildExtraction(game, "GHOST", 1, "oil", 1).success).toBe(false);
      expect(commands.buildExtraction(game, "USA", 999, "oil", 1).success).toBe(false);
    });
  });
});
