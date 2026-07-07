import { describe, it, expect, beforeEach, vi } from "vitest";
import { LLMService } from "../LLMService";
import { createTestCountry, createTestGameState } from "../../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

function gameWithUsaUssr(overrides: Partial<GameState> = {}): GameState {
  return createTestGameState({
    playerCountryId: "USA",
    countries: [
      createTestCountry({ id: "USA", name: "USA", tier: "major" }),
      createTestCountry({ id: "USSR", name: "USSR", tier: "major" }),
    ],
    ...overrides,
  });
}

describe("LLMService", () => {
  describe("generatePrompt", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    it("включает дату, имя страны игрока и JSON-схему ответа", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain(game.currentDate);
      expect(prompt).toContain("USA");
      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"descriptions"');
      expect(prompt).toContain('"actions"');
      // перечень допустимых типов действий присутствует в инструкции
      expect(prompt).toContain("diplomacy|war|peace|annex|puppet|sanction|guarantee|influence");
    });

    it("## Language: требует писать нарратив на языке локали игры (2026-07-05)", () => {
      game.locale = "ru";
      let prompt = service.generatePrompt();
      expect(prompt).toContain("## Language");
      expect(prompt).toContain("in Russian");

      game.locale = "en";
      prompt = service.generatePrompt();
      expect(prompt).toContain("in English");
    });

    it("сообщает LLM жёсткие пределы магнитуды (Hard limits)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("Hard limits");
      expect(prompt).toContain("±40");
      expect(prompt).toContain("±20");
    });

    it("Narrative requirements: требует минимум 3 абзаца и охват Spotlight-стран (2026-07-05, живой тест на Groq/Gemini)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("Narrative requirements");
      expect(prompt).toContain("at least 3 distinct paragraphs");
      expect(prompt).toContain("at least 2 of the");
      expect(prompt).toContain("Spotlight Countries specifically");
    });

    it("Narrative requirements: запрещает страны вне ## Country IDs", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("MUST NOT mention, narrate about, or take action for any country");
      expect(prompt).toContain("## Country IDs");
    });

    it("Narrative requirements: требует историческую конкретику месяца, с оговоркой про альтернативную историю", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("concrete real historical events");
      expect(prompt).toContain("Deviations from real history");
    });

    it("Instructions: требует принять фантастическое намерение игрока как канон (2026-07-06)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("fundamentally incompatible with");
      expect(prompt).toContain("MUST accept it as canon");
    });

    it("Notable Developments: 'No notable developments this month' без фактов (2026-07-06)", () => {
      const prompt = service.generatePrompt();
      const section = prompt.slice(
        prompt.indexOf("## Notable Developments"),
        prompt.indexOf("## Recent Events")
      );
      expect(section).toContain("No notable developments this month");
    });

    it("Notable Developments: рендерит факт по видимой стране и очищает pendingWorldFacts (2026-07-06)", () => {
      game.pendingWorldFacts.push({ countryId: "USA", text: "USA technology reached tier 1 in armor" });

      const prompt = service.generatePrompt();
      const section = prompt.slice(
        prompt.indexOf("## Notable Developments"),
        prompt.indexOf("## Recent Events")
      );
      expect(section).toContain("USA technology reached tier 1 in armor");
      expect(game.pendingWorldFacts).toEqual([]);
    });

    it("Historical Context: 'No historical hinge points active this period' с реальными id вне срабатывающих предусловий (2026-07-06)", () => {
      // Каталог развилок ключуется на реальные id (SUN/USA/CHN/TWN/GRC/...), не на
      // условный "USSR" из gameWithUsaUssr() — отдельная игра с этими id.
      const usa = createTestCountry({ id: "USA", name: "USA" });
      usa.diplomacy.guarantees.push("TWN"); // ломает предусловие chinese_civil_war
      const hpGame = createTestGameState({
        playerCountryId: "USA",
        currentDate: "1946-06-01", // внутри окна chinese_civil_war/greek_civil_war, до cold_war_hardening
        countries: [usa, createTestCountry({ id: "SUN", name: "Soviet Union" })],
      });
      const hpService = new LLMService(hpGame);

      const prompt = hpService.generatePrompt();
      const section = prompt.slice(
        prompt.indexOf("## Historical Context"),
        prompt.indexOf("## Recent Events")
      );
      expect(section).toContain("No historical hinge points active this period");
    });

    it("Historical Context: показывает развилку при выполненных предусловиях и инкрементирует showCount (2026-07-06)", () => {
      const usa = createTestCountry({ id: "USA", name: "USA" });
      const sun = createTestCountry({ id: "SUN", name: "Soviet Union" });
      sun.diplomacy.relations = { USA: 10 }; // < 40 — предусловие cold_war_hardening выполнено
      const hpGame = createTestGameState({
        playerCountryId: "USA",
        currentDate: "1947-06-01", // внутри окна cold_war_hardening
        countries: [usa, sun],
      });
      const hpService = new LLMService(hpGame);

      const prompt = hpService.generatePrompt();
      const section = prompt.slice(
        prompt.indexOf("## Historical Context"),
        prompt.indexOf("## Recent Events")
      );
      expect(section).toContain("доктрина Трумэна");
      expect(hpGame.hingePointShowCount["cold_war_hardening"]).toBe(1);
    });

    it("Spotlight Countries: секция требует минимум 2 конкретных страны, не просто упоминание", () => {
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Spotlight Countries"), prompt.indexOf("## Active Wars"));
      expect(section).toContain("MUST give at least 2 of them a");
      expect(section).toContain("not just a passing mention");
    });

    it("Active Wars: 'No active wars', если войн нет (2026-07-06)", () => {
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Active Wars"), prompt.indexOf("## Recent Events"));
      expect(section).toContain("No active wars");
    });

    it("Active Wars: показывает стороны, статус фронта и цель войны по именам стран (2026-07-06)", () => {
      game.wars.push({
        id: "war-1",
        attackers: ["USA"],
        defenders: ["USSR"],
        supporters: [],
        startDate: game.currentDate,
        warGoal: "Contain communism",
        active: true,
        territoryFlips: { toAttackers: 3, toDefenders: 0 },
      });
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Active Wars"), prompt.indexOf("## Recent Events"));
      expect(section).toContain("USA vs USSR");
      expect(section).toContain("attackers advancing");
      expect(section).toContain("goal: Contain communism");
    });

    it("Active Wars: не показывает завершённые (active: false) войны (2026-07-06)", () => {
      game.wars.push({
        id: "war-1",
        attackers: ["USA"],
        defenders: ["USSR"],
        supporters: [],
        startDate: game.currentDate,
        active: false,
        territoryFlips: { toAttackers: 0, toDefenders: 0 },
      });
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Active Wars"), prompt.indexOf("## Recent Events"));
      expect(section).toContain("No active wars");
    });

    it("Narrative requirements: инструктирует избегать прямой войны между ядерными державами (2026-07-06)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("nuclear-armed Major Powers");
      expect(prompt).toContain("proxy support");
    });

    it("Instructions: упоминает research_shift и его пределы (2026-07-06)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("research_shift");
      expect(prompt).toContain("diplomacy|war|peace|annex|puppet|sanction|guarantee|influence|research_shift|production_shift");
    });

    it("Instructions: упоминает production_shift и категории техники (War Phase 2, 2026-07-06)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("production_shift");
      expect(prompt).toContain("rifles/trucks/tanks");
      expect(prompt).toContain("submarines");
    });

    it("Player Country: показывает ВВП/чел, индекс благосостояния и тиры технологий (2026-07-06)", () => {
      game.countries.find(c => c.id === "USA")!.technology.domains = { armor: 250, naval: 0 };
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Player Country"), prompt.indexOf("## Major Powers"));
      expect(section).toContain("per capita");
      expect(section).toContain("Living standard index");
      expect(section).toContain("armor T2");
      expect(section).not.toContain("naval"); // тир 0 — не показывается
    });

    it("Player Country: 'no notable tech progress yet' без прогресса", () => {
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Player Country"), prompt.indexOf("## Major Powers"));
      expect(section).toContain("no notable tech progress yet");
    });

    it("Major Powers: показывает тиры технологий по каждой державе (2026-07-06)", () => {
      game.countries.find(c => c.id === "USSR")!.technology.domains = { rocketry: 300 };
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Major Powers"), prompt.indexOf("## Spotlight Countries"));
      expect(section).toContain("rocketry T3");
    });

    it("Память страны: показывает последние заголовки eventHistory по стране игрока, самые свежие первыми (2026-07-05, вопрос 7)", () => {
      game.eventHistory = [
        { id: "e1", date: "1946-01-01", title: "Event One", description: "", countries: ["USA"] },
        { id: "e2", date: "1946-02-01", title: "Event Two", description: "", countries: ["USA"] },
      ];
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Player Country"), prompt.indexOf("## Major Powers"));
      expect(section).toContain("Recent: Event Two (1946-02-01); Event One (1946-01-01)");
    });

    it("Память страны: ничего не показывает, если по стране ещё не было событий", () => {
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Player Country"), prompt.indexOf("## Major Powers"));
      expect(section).not.toContain("Recent:");
    });

    it("Память страны: у Major Powers окно ограничено MAJOR_RECENT_TITLES_COUNT (3)", () => {
      game.eventHistory = [
        { id: "e1", date: "1946-01-01", title: "Oldest", description: "", countries: ["USSR"] },
        { id: "e2", date: "1946-02-01", title: "Middle1", description: "", countries: ["USSR"] },
        { id: "e3", date: "1946-03-01", title: "Middle2", description: "", countries: ["USSR"] },
        { id: "e4", date: "1946-04-01", title: "Newest", description: "", countries: ["USSR"] },
      ];
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Major Powers"), prompt.indexOf("## Spotlight Countries"));
      expect(section).toContain("Recent: Newest (1946-04-01); Middle2 (1946-03-01); Middle1 (1946-02-01)");
      expect(section).not.toContain("Oldest");
    });

    it("Память страны: у Spotlight-стран окно ограничено SPOTLIGHT_RECENT_TITLES_COUNT (2)", () => {
      const g = createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({ id: "USA", name: "USA", tier: "major" }),
          createTestCountry({ id: "AAA", name: "Alpha" }),
        ],
        eventHistory: [
          { id: "e1", date: "1946-01-01", title: "Old", description: "", countries: ["AAA"] },
          { id: "e2", date: "1946-02-01", title: "Mid", description: "", countries: ["AAA"] },
          { id: "e3", date: "1946-03-01", title: "New", description: "", countries: ["AAA"] },
        ],
      });
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Spotlight Countries"), prompt.indexOf("## Active Wars"));
      expect(section).toContain("Recent: New (1946-03-01); Mid (1946-02-01)");
      expect(section).not.toContain("Old");
    });

    it("Player Intent: включает текст намерения игрока, если оно задано", () => {
      game.playerIntent = "наращиваем добычу угля в 12: Силезия";
      const prompt = service.generatePrompt();
      expect(prompt).toContain("## Player Intent");
      expect(prompt).toContain("наращиваем добычу угля в 12: Силезия");
    });

    it("Player Intent: fallback-строка, если намерение пустое", () => {
      const prompt = service.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Player Intent"), prompt.indexOf("## Country IDs"));
      expect(section).toContain("No player intent this cycle");
    });

    it("Country IDs: даёт реальные id упомянутых стран, не только имена (регрессия 2026-07-04: SOV/ROM вместо SUN/ROU)", () => {
      const prompt = service.generatePrompt();
      expect(prompt).toContain("## Country IDs");
      expect(prompt).toContain("- USA: USA");
      expect(prompt).toContain("- USSR: USSR");
      expect(prompt).toContain("Never invent, abbreviate, or guess an id from a");
    });

    it("Country IDs: включает союзников/соперников игрока и стороны напряжённостей, даже если tier не major", () => {
      const g = createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({ id: "USA", name: "USA" }),
          createTestCountry({
            id: "SUN",
            name: "Soviet Union",
            diplomacy: { ...createTestCountry().diplomacy, rivals: ["ROU"] },
          }),
          createTestCountry({ id: "ROU", name: "Romania" }),
        ],
      });
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      expect(prompt).toContain("- ROU: Romania");
      expect(prompt).toContain("- SUN: Soviet Union");
    });

    it("Country IDs: не включает id, которых нет в game.countries (нет самоподтверждения выдумки)", () => {
      const g = createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({
            id: "USA",
            name: "USA",
            diplomacy: { ...createTestCountry().diplomacy, allies: ["ATLANTIS"] },
          }),
        ],
      });
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const idsSection = prompt.slice(prompt.indexOf("## Country IDs"), prompt.indexOf("## Instructions"));
      expect(idsSection).not.toContain("ATLANTIS");
    });

    it("детерминирован: два вызова дают одинаковый промт", () => {
      const a = service.generatePrompt();
      const b = service.generatePrompt();
      expect(a).toBe(b);
    });

    it("не мутирует порядок game.countries (регрессия на квирк .sort(), 2026-06-23)", () => {
      const g = createTestGameState({
        playerCountryId: "WEAK",
        countries: [
          createTestCountry({ id: "WEAK", name: "Weak", economy: { ...createTestCountry().economy, gdp: 1 } }),
          createTestCountry({ id: "STRONG", name: "Strong", economy: { ...createTestCountry().economy, gdp: 1_000 } }),
        ],
      });
      const svc = new LLMService(g);
      svc.generatePrompt();
      // generatePrompt сортирует копию, исходный порядок сохраняется
      expect(g.countries.map(c => c.id)).toEqual(["WEAK", "STRONG"]);
    });
  });

  describe("Spotlight Countries (расширение круга стран, вопрос 11)", () => {
    function gameWithRoster(): GameState {
      return createTestGameState({
        playerCountryId: "USA",
        countries: [
          createTestCountry({ id: "USA", name: "USA", tier: "major" }),
          createTestCountry({ id: "BBB", name: "Bravo" }),
          createTestCountry({ id: "AAA", name: "Alpha" }),
          createTestCountry({ id: "DDD", name: "Delta" }),
          createTestCountry({ id: "CCC", name: "Charlie" }),
          createTestCountry({ id: "EEE", name: "Echo" }),
          createTestCountry({ id: "FFF", name: "Foxtrot" }),
        ],
      });
    }

    it("выбирает первые LLM_SPOTLIGHT_COUNT не-major стран по id, начиная с курсора 0", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const section = prompt.slice(prompt.indexOf("## Spotlight Countries"), prompt.indexOf("## Active Wars"));
      // Пул по id: AAA, BBB, CCC, DDD, EEE, FFF — первые 5 от курсора 0
      expect(section).toContain("Alpha");
      expect(section).toContain("Bravo");
      expect(section).toContain("Charlie");
      expect(section).toContain("Delta");
      expect(section).toContain("Echo");
      expect(section).not.toContain("Foxtrot");
    });

    it("generatePrompt не двигает курсор ротации (идемпотентно)", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      svc.generatePrompt();
      svc.generatePrompt();
      expect(g.llmSpotlightCursor ?? 0).toBe(0);
    });

    it("курсор двигается только после успешного processResponse, с оборачиванием пула", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const response = JSON.stringify({ descriptions: "x", actions: [] });

      svc.processResponse(response);
      // Пул из 6 стран, шаг 5 → курсор 5
      expect(g.llmSpotlightCursor).toBe(5);

      const promptAfter = svc.generatePrompt();
      const section = promptAfter.slice(
        promptAfter.indexOf("## Spotlight Countries"),
        promptAfter.indexOf("## Active Wars")
      );
      // От курсора 5 в пуле из 6 (AAA..FFF): FFF, затем оборот на AAA..DDD
      expect(section).toContain("Foxtrot");
      expect(section).toContain("Alpha");

      svc.processResponse(response);
      // (5 + 5) % 6 = 4
      expect(g.llmSpotlightCursor).toBe(4);
    });

    it("майоры никогда не попадают в пул ротации", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      const majorsSection = prompt.slice(prompt.indexOf("## Major Powers"), prompt.indexOf("## Spotlight Countries"));
      expect(majorsSection).toContain("USA");
    });

    it("пустой пул (все страны major) не роняет промт", () => {
      const g = gameWithUsaUssr(); // и USA, и USSR — major
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      expect(prompt).toContain("No spotlight countries this cycle");
    });

    it("страны в ротации попадают в ## Country IDs", () => {
      const g = gameWithRoster();
      const svc = new LLMService(g);
      const prompt = svc.generatePrompt();
      expect(prompt).toContain("- AAA: Alpha");
      expect(prompt).toContain("- EEE: Echo");
    });
  });

  describe("applyLlmActions", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    const usa = () => game.countries.find(c => c.id === "USA")!;
    const ussr = () => game.countries.find(c => c.id === "USSR")!;

    it("diplomacy: применяет relationChange из data симметрично (половина обратной стороне)", () => {
      service.applyLlmActions([
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 20 } },
      ]);
      expect(usa().diplomacy.relations["USSR"]).toBe(20);
      expect(ussr().diplomacy.relations["USA"]).toBe(10);
    });

    it("war: обрушивает отношения (delta -100, обратная сторона -50) и создаёт реальную War (2026-07-06)", () => {
      service.applyLlmActions([{ type: "war", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.relations["USSR"]).toBe(-100);
      expect(ussr().diplomacy.relations["USA"]).toBe(-50);

      const war = game.wars.find(w => w.attackers.includes("USA") && w.defenders.includes("USSR"));
      expect(war).toBeDefined();
      expect(war!.active).toBe(true);
    });

    it("war: сохраняет warGoal из data.warGoal, если передан (2026-07-06)", () => {
      service.applyLlmActions([
        { type: "war", sourceCountryId: "USA", targetCountryId: "USSR", data: { warGoal: "Liberate Manchuria" } },
      ]);
      const war = game.wars.find(w => w.attackers.includes("USA"));
      expect(war!.warGoal).toBe("Liberate Manchuria");
    });

    it("peace: улучшает отношения (delta +50) и завершает реальную войну (2026-07-06)", () => {
      service.applyLlmActions([{ type: "war", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      service.applyLlmActions([{ type: "peace", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.relations["USSR"]).toBe(50 - 100);
      expect(ussr().diplomacy.relations["USA"]).toBe(25 - 50);

      const war = game.wars.find(w => w.attackers.includes("USA") && w.defenders.includes("USSR"));
      expect(war!.active).toBe(false);
    });

    it("peace: не падает, если активной войны нет (2026-07-06)", () => {
      service.applyLlmActions([{ type: "peace", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.relations["USSR"]).toBe(50);
      expect(game.wars).toHaveLength(0);
    });

    it("sanction: добавляет санкцию по умолчанию и ухудшает отношения на -25", () => {
      service.applyLlmActions([{ type: "sanction", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.sanctions["USSR"]).toEqual(["economic_sanctions"]);
      expect(usa().diplomacy.relations["USSR"]).toBe(-25);
    });

    it("sanction: использует sanctionType из data, если передан", () => {
      service.applyLlmActions([
        { type: "sanction", sourceCountryId: "USA", targetCountryId: "USSR", data: { sanctionType: "arms_embargo" } },
      ]);
      expect(usa().diplomacy.sanctions["USSR"]).toEqual(["arms_embargo"]);
    });

    it("guarantee: добавляет гарантию и улучшает отношения на +15", () => {
      service.applyLlmActions([{ type: "guarantee", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.guarantees).toContain("USSR");
      expect(usa().diplomacy.relations["USSR"]).toBe(15);
    });

    it("influence: применяет influenceChange по умолчанию (10)", () => {
      service.applyLlmActions([{ type: "influence", sourceCountryId: "USA", targetCountryId: "USSR" }]);
      expect(usa().diplomacy.influence["USSR"]).toBe(10);
    });

    it("annex/puppet: не падает и не меняет отношения (пока не реализовано)", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      service.applyLlmActions([
        { type: "annex", sourceCountryId: "USA", targetCountryId: "USSR" },
        { type: "puppet", sourceCountryId: "USA", targetCountryId: "USSR" },
      ]);
      expect(usa().diplomacy.relations["USSR"]).toBeUndefined();
      logSpy.mockRestore();
    });

    it("действие без targetCountryId — no-op (не падает, не меняет отношения)", () => {
      service.applyLlmActions([{ type: "diplomacy", sourceCountryId: "USA" }]);
      expect(usa().diplomacy.relations["USSR"]).toBeUndefined();
    });

    it("research_shift: задаёт долю домена в researchAllocation (2026-07-06)", () => {
      usa().technology.domains = { armor: 0, naval: 0 };
      service.applyLlmActions([
        { type: "research_shift", sourceCountryId: "USA", data: { domain: "armor", share: 0.6 } },
      ]);
      expect(usa().technology.researchAllocation).toEqual({ armor: 0.6 });
    });

    it("research_shift: не падает и не применяет без domain/share в data", () => {
      usa().technology.domains = { armor: 0 };
      service.applyLlmActions([{ type: "research_shift", sourceCountryId: "USA" }]);
      expect(usa().technology.researchAllocation).toBeUndefined();
    });

    it("применяет несколько действий подряд", () => {
      service.applyLlmActions([
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 10 } },
        { type: "influence", sourceCountryId: "USA", targetCountryId: "USSR", data: { influenceChange: 5 } },
      ]);
      expect(usa().diplomacy.relations["USSR"]).toBe(10);
      expect(usa().diplomacy.influence["USSR"]).toBe(5);
    });
  });

  describe("состояние LLM-цикла в gameState", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    it("savePrompt/saveResponse пишут в gameState", () => {
      service.savePrompt("PROMPT");
      service.saveResponse("RESPONSE");
      expect(game.llmContext).toBe("PROMPT");
      expect(game.llmResponse).toBe("RESPONSE");
    });

    it("incrementLlmTurn увеличивает счётчик с нуля", () => {
      service.incrementLlmTurn();
      service.incrementLlmTurn();
      expect(game.llmTurn).toBe(2);
    });

    it("save/get/clear pending actions", () => {
      const actions = [{ type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR" } as const];
      service.savePendingActions(actions);
      expect(service.getPendingActions()).toEqual(actions);
      service.clearPendingActions();
      expect(service.getPendingActions()).toEqual([]);
    });

    it("getPendingActions возвращает пустой массив, если ничего не сохранено", () => {
      expect(service.getPendingActions()).toEqual([]);
    });
  });

  describe("processResponse (полный проход LLM-цикла)", () => {
    let game: GameState;
    let service: LLMService;

    beforeEach(() => {
      game = gameWithUsaUssr();
      service = new LLMService(game);
    });

    const usa = () => game.countries.find(c => c.id === "USA")!;

    const validResponse = JSON.stringify({
      descriptions: "США улучшают отношения с СССР.",
      actions: [
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 20 } },
      ],
    });

    it("валидный ответ: применяет действия, пишет response/turn/eventHistory", () => {
      const result = service.processResponse(validResponse);

      expect(result.success).toBe(true);
      expect(result.descriptions).toBe("США улучшают отношения с СССР.");
      expect(result.appliedActions).toHaveLength(1);
      expect(result.rejectedActions).toHaveLength(0);

      expect(usa().diplomacy.relations["USSR"]).toBe(20);
      expect(game.llmResponse).toBe(validResponse);
      expect(game.llmTurn).toBe(1);

      expect(game.eventHistory).toHaveLength(1);
      const event = game.eventHistory[0]!;
      expect(event.id).toBe("llm-turn-1");
      expect(event.date).toBe(game.currentDate);
      expect(event.description).toBe("США улучшают отношения с СССР.");
      expect(event.countries).toEqual(["USA", "USSR"]);
    });

    it("валидный ответ: очищает playerIntent (одноразовое, не история)", () => {
      game.playerIntent = "построить укрепления на границе";
      service.processResponse(validResponse);
      expect(game.playerIntent).toBe("");
    });

    it("гейт (2026-07-06): валидный ответ выставляет llmRespondedThisTurn в true", () => {
      game.llmRespondedThisTurn = false;
      service.processResponse(validResponse);
      expect(game.llmRespondedThisTurn).toBe(true);
    });

    it("гейт (2026-07-06): невалидный ответ НЕ выставляет llmRespondedThisTurn", () => {
      game.llmRespondedThisTurn = false;
      service.processResponse("это не JSON");
      expect(game.llmRespondedThisTurn).toBe(false);
    });

    it("title: использует title из ответа LLM как Event.title, если он есть (2026-07-05, для таймлайна)", () => {
      const responseWithTitle = JSON.stringify({
        title: "USA-USSR Relations Thaw",
        descriptions: "США улучшают отношения с СССР.",
        actions: [],
      });
      const result = service.processResponse(responseWithTitle);
      expect(result.title).toBe("USA-USSR Relations Thaw");
      expect(game.eventHistory[0]!.title).toBe("USA-USSR Relations Thaw");
    });

    it("title: fallback на общий заголовок, если LLM его не прислала", () => {
      const result = service.processResponse(validResponse);
      expect(result.title).toBe(`Мировые события (LLM, ход ${game.llmTurn})`);
      expect(game.eventHistory[0]!.title).toBe(`Мировые события (LLM, ход ${game.llmTurn})`);
    });

    it("невалидный ответ: НЕ очищает playerIntent (ничего не применено)", () => {
      game.playerIntent = "построить укрепления на границе";
      service.processResponse("это не JSON");
      expect(game.playerIntent).toBe("построить укрепления на границе");
    });

    it("невалидный JSON: отказ целиком, ничего не применяется", () => {
      const result = service.processResponse("это не JSON");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid JSON format");
      expect(usa().diplomacy.relations["USSR"]).toBeUndefined();
      expect(game.llmTurn).toBeUndefined();
      expect(game.eventHistory).toHaveLength(0);
    });

    it("невалидная структура (нет descriptions): отказ с причиной", () => {
      const result = service.processResponse(JSON.stringify({ actions: [] }));

      expect(result.success).toBe(false);
      expect(result.error).toBe("Missing descriptions field");
      expect(game.eventHistory).toHaveLength(0);
    });

    it("действие с несуществующей страной: отказ целиком (структурная валидация)", () => {
      const result = service.processResponse(JSON.stringify({
        descriptions: "x",
        actions: [{ type: "war", sourceCountryId: "MARS", targetCountryId: "USA" }],
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Source country not found");
    });

    it("действие с магнитудой за пределами отклоняется точечно с причиной", () => {
      const result = service.processResponse(JSON.stringify({
        descriptions: "x",
        actions: [
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 500 } },
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 10 } },
        ],
      }));

      expect(result.success).toBe(true);
      expect(result.appliedActions).toHaveLength(1);
      expect(result.rejectedActions).toHaveLength(1);
      expect(result.rejectedActions[0]!.reason).toContain("relationChange out of range");
      expect(usa().diplomacy.relations["USSR"]).toBe(10);
    });

    it("неприменимое действие отклоняется точечно с причиной, остальные применяются", () => {
      // Повторная гарантия неприменима
      usa().diplomacy.guarantees.push("USSR");

      const result = service.processResponse(JSON.stringify({
        descriptions: "x",
        actions: [
          { type: "guarantee", sourceCountryId: "USA", targetCountryId: "USSR" },
          { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "USSR", data: { relationChange: 5 } },
        ],
      }));

      expect(result.success).toBe(true);
      expect(result.appliedActions).toHaveLength(1);
      expect(result.rejectedActions).toHaveLength(1);
      expect(result.rejectedActions[0]!.reason).toBe("Guarantee already exists");
      expect(usa().diplomacy.relations["USSR"]).toBe(5);
    });

    it("счётчик хода и id события растут при повторных проходах", () => {
      service.processResponse(validResponse);
      service.processResponse(validResponse);

      expect(game.llmTurn).toBe(2);
      expect(game.eventHistory.map(e => e.id)).toEqual(["llm-turn-1", "llm-turn-2"]);
    });
  });
});
