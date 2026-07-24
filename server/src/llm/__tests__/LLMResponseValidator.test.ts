import { describe, it, expect } from "vitest";
import { LLMResponseValidator } from "../LLMResponseValidator";
import { WarService } from "../../services/WarService";
import { createTestCountry, createTestGameState, createTestRegion } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

/**
 * Структурная и магнитудная валидация (форма/статические капы) переехала в
 * server/src/llm/actionSchemas.test.ts (план 02_LLM_CONTRACT.md, Шаг 2/3).
 * Этот файл — только validateActionApplicability: семантика, знающая о
 * конкретной партии (game.countries/game.wars), которую схема знать не
 * может, плюс единственная динамическая магнитуда — admin-capacity потолок
 * research_shift.share.
 */
describe("LLMResponseValidator.validateActionApplicability", () => {
  function makeGame(): GameState {
    return createTestGameState({
      countries: [
        createTestCountry({ id: "USA", name: { en: "USA" } }),
        createTestCountry({ id: "USSR", name: { en: "USSR" } }),
      ],
    });
  }

  it("отклоняет выдуманную страну-источник", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "guarantee",
      sourceCountryId: "ATLANTIS",
      targetCountryId: "USA",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Source country not found");
  });

  it("отклоняет выдуманную целевую страну (ключевая защита от галлюцинаций LLM)", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "war",
      sourceCountryId: "USA",
      targetCountryId: "ATLANTIS",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Target country not found");
  });

  it("отклоняет повторные санкции, если они уже наложены", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const usa = game.countries.find(c => c.id === "USA")!;
    usa.diplomacy.sanctions["USSR"] = ["economic_sanctions"];
    const result = validator.validateActionApplicability({
      type: "sanction",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Sanctions already exist");
  });

  it("отклоняет повторную гарантию", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const usa = game.countries.find(c => c.id === "USA")!;
    usa.diplomacy.guarantees.push("USSR");
    const result = validator.validateActionApplicability({
      type: "guarantee",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Guarantee already exists");
  });

  it("разрешает санкции, если их ещё нет", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "sanction",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(true);
  });

  it("research_shift: разрешает известный домен страны и допустимый share (2026-07-06)", () => {
    const game = makeGame();
    game.countries.find(c => c.id === "USA")!.technology.domains = { armor: 0 };
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "research_shift",
      sourceCountryId: "USA",
      data: { domain: "armor", share: 0.5 },
    });
    expect(result.valid).toBe(true);
  });

  it("research_shift: отклоняет несуществующий у страны домен", () => {
    const game = makeGame();
    game.countries.find(c => c.id === "USA")!.technology.domains = { armor: 0 };
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "research_shift",
      sourceCountryId: "USA",
      data: { domain: "cyberwarfare", share: 0.5 },
    });
    expect(result.valid).toBe(false);
  });

  it("production_shift: разрешает реальную категорию EquipmentType (War Phase 2, 2026-07-06)", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "production_shift",
      sourceCountryId: "USA",
      data: { equipmentType: "tanks", share: 0.5 },
    });
    expect(result.valid).toBe(true);
  });

  it("war: разрешает объявление, если сторона ещё не воюет и не союзник (2026-07-06)", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "war",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(true);
  });

  it("war: отклоняет, если уже идёт война между этими странами (2026-07-06)", () => {
    const game = makeGame();
    new WarService(game).declareWar("USA", "USSR");
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "war",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Already at war with this country");
  });

  it("war: отклоняет объявление войны союзнику (2026-07-06)", () => {
    const game = makeGame();
    const usa = game.countries.find(c => c.id === "USA")!;
    usa.diplomacy.allies.push("USSR");
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "war",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Cannot declare war on an ally");
  });

  it("peace: отклоняет, если между странами нет активной войны (2026-07-06)", () => {
    const game = makeGame();
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "peace",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("No active war between these countries");
  });

  it("peace: разрешает, если между странами есть активная война (2026-07-06)", () => {
    const game = makeGame();
    new WarService(game).declareWar("USA", "USSR");
    const validator = new LLMResponseValidator(game);
    const result = validator.validateActionApplicability({
      type: "peace",
      sourceCountryId: "USA",
      targetCountryId: "USSR",
    });
    expect(result.valid).toBe(true);
  });

  describe("research_shift: admin capacity — динамический потолок share (2026-07-06)", () => {
    it("активная война снижает потолок на 0.1 за войну", () => {
      const game = makeGame();
      game.countries.find(c => c.id === "USA")!.technology.domains = { armor: 0 };
      new WarService(game).declareWar("USA", "USSR");
      const validator = new LLMResponseValidator(game);

      const atOldCeiling = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.7 },
      });
      expect(atOldCeiling.valid).toBe(false); // потолок теперь 0.6, не статический 0.7

      const atNewCeiling = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.6 },
      });
      expect(atNewCeiling.valid).toBe(true);
    });

    it("страну, не участвующую в войне, потолок не задевает", () => {
      const game = makeGame();
      game.countries.find(c => c.id === "USSR")!.technology.domains = { armor: 0 };
      new WarService(game).declareWar("USA", "USSR");
      // USSR тоже воюет в этом сетапе — берём независимую партию, где USSR ни с кем не воюет.
      const other = createTestGameState({
        countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR", technology: { domains: { armor: 0 } } })],
      });
      const validator = new LLMResponseValidator(other);
      const result = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USSR",
        data: { domain: "armor", share: 0.7 },
      });
      expect(result.valid).toBe(true);
    });

    it("потолок не падает ниже 0.3 при много войнах", () => {
      const many = createTestGameState({
        countries: [
          createTestCountry({ id: "USA", technology: { domains: { armor: 0 } } }),
          createTestCountry({ id: "R1" }),
          createTestCountry({ id: "R2" }),
          createTestCountry({ id: "R3" }),
          createTestCountry({ id: "R4" }),
          createTestCountry({ id: "R5" }),
        ],
      });
      const warService = new WarService(many);
      // 5 отдельных войн против USA — потолок 0.7 - 5*0.1 = 0.2, но пол 0.3.
      warService.declareWar("USA", "R1");
      warService.declareWar("USA", "R2");
      warService.declareWar("USA", "R3");
      warService.declareWar("USA", "R4");
      warService.declareWar("USA", "R5");

      const validator = new LLMResponseValidator(many);
      const atFloor = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.3 },
      });
      expect(atFloor.valid).toBe(true);

      const belowFloor = validator.validateActionApplicability({
        type: "research_shift",
        sourceCountryId: "USA",
        data: { domain: "armor", share: 0.31 },
      });
      expect(belowFloor.valid).toBe(false);
    });
  });

  describe("build_extraction (docs/plans/04_RESOURCES.md)", () => {
    it("отклоняет неизвестный regionId", () => {
      const game = makeGame();
      const validator = new LLMResponseValidator(game);
      const result = validator.validateActionApplicability({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 999, resource: "oil", delta: 1 },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Unknown region: 999");
    });

    it("delta=1: отклоняет, если страна не контролирует регион", () => {
      const game = makeGame();
      game.regions.push(createTestRegion({ id: 1, ownerCountryId: "USSR", deposits: { oil: 1000 } }));
      const validator = new LLMResponseValidator(game);
      const result = validator.validateActionApplicability({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta: 1 },
      });
      expect(result.valid).toBe(false);
    });

    it("delta=1: отклоняет, если в регионе нет депозита ресурса", () => {
      const game = makeGame();
      game.regions.push(createTestRegion({ id: 1, ownerCountryId: "USA", deposits: {} }));
      const validator = new LLMResponseValidator(game);
      const result = validator.validateActionApplicability({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta: 1 },
      });
      expect(result.valid).toBe(false);
    });

    it("delta=1: разрешает, если страна контролирует регион и депозит есть", () => {
      const game = makeGame();
      game.regions.push(createTestRegion({ id: 1, ownerCountryId: "USA", deposits: { oil: 1000 } }));
      const validator = new LLMResponseValidator(game);
      const result = validator.validateActionApplicability({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta: 1 },
      });
      expect(result.valid).toBe(true);
    });

    it("delta=-1: разрешает даже без контроля региона (сворачивание чужой/потерянной добычи)", () => {
      const game = makeGame();
      game.regions.push(createTestRegion({ id: 1, ownerCountryId: "USSR", deposits: {} }));
      const validator = new LLMResponseValidator(game);
      const result = validator.validateActionApplicability({
        type: "build_extraction",
        sourceCountryId: "USA",
        data: { regionId: 1, resource: "oil", delta: -1 },
      });
      expect(result.valid).toBe(true);
    });
  });
});
