import { describe, it, expect } from "vitest";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";
import { LLMService } from "../services/LLMService";
import { applyPrimitiveTurn } from "../primitives/turnBatch";
import { type GameState } from "@shared/types/GameState";
import { regionDiscontent } from "@shared/utils/discontent";
import { MAX_PROMPT_CRISES } from "@shared/defines/discontent";
import { emptyPrimitiveTurnBudget } from "@shared/types/politics/PrimitiveTurnBudget";

/**
 * Сквозная петля Милстоуна 0 на РЕАЛЬНЫХ данных сценария 1946 — не на фикстуре.
 *
 * Зачем отдельно от модульных тестов. Каждое звено петли уже покрыто: тик
 * недовольства, движок примитивов, кризисный кап, граница хода, отклик. Но
 * милстоун обещает не звенья, а замыкание: тик → порог → факт → режиссура
 * модели → ответ игрока → детерминированное применение → новое состояние →
 * новое давление. Разрыв между звеньями (потерянный факт, не долетевший до
 * промта кризис, примитив, применённый мимо границы хода) ни один из модульных
 * тестов не увидит, потому что каждый из них проверяет свою половину стыка.
 *
 * Ответ модели здесь синтетический и зашит в тест: цель — проверить контракт и
 * проводку, а не поведение живой модели (сетевых вызовов в тестах нет).
 */

const PLAYER = "SUN";

function startedGame(): GameState {
  const game = createGame("1946", PLAYER, "ru");
  // Один тик, чтобы латч кризисов заполнился и появились факты «кризис в
  // регионе X» — до первого тика их нет по построению.
  simulateMonth(game);
  return game;
}

function crisisLines(prompt: string): string[] {
  const section = prompt.split("## Regional Crises")[1]!.split("## Rejected Attempts")[0]!;
  return section.split("\n").filter(line => line.startsWith("- region "));
}

describe("Милстоун 0: петля замыкается на данных 1946", () => {
  it("тик → порог → кап промта → режиссура → ответ игрока → новое состояние", () => {
    const game = startedGame();

    // --- 1. Тик вырастил недовольство, порог дал кризисы -------------------
    const latched = game.regionCrisisLatch.length;
    expect(latched).toBeGreaterThan(MAX_PROMPT_CRISES);

    const crisisFacts = game.pendingWorldFacts.filter(f => f.kind === "region_crisis");
    expect(crisisFacts.length).toBe(latched);

    // --- 2. Кризисный кап на границе промта --------------------------------
    const prompt = new LLMService(game).generatePrompt();
    const shown = crisisLines(prompt);
    expect(shown).toHaveLength(MAX_PROMPT_CRISES);
    expect(prompt).toContain(`(${latched - MAX_PROMPT_CRISES} more region(s) are above the threshold`);
    // Кризисные факты потреблены секцией, а не потеряны фильтром видимости.
    expect(game.pendingWorldFacts.some(f => f.kind === "region_crisis")).toBe(false);

    // Самый острый регион — цель режиссуры. Берётся из промта, а не зашит
    // числом: тест не должен ломаться от калибровки коэффициентов.
    const hottestId = Number(shown[0]!.match(/^- region (\d+)/)![1]);
    const hottest = game.regions.find(r => r.id === hottestId)!;
    const groupId = [...hottest.demographics!].sort((a, b) => b.share - a.share)[0]!.groupId;
    const discontentBefore = regionDiscontent(game, hottest)!;

    // --- 3. Режиссура: модель поднимает давление цепочкой §4 ---------------
    const directorResponse = JSON.stringify({
      title: "Волнения",
      descriptions: "Три абзаца нарратива.",
      actions: [],
      primitives: [
        {
          verb: "incite_unrest",
          sourceCountryId: "USA",
          target: { regionId: hottestId, groupId },
          params: { intensity: "severe" },
        },
        {
          verb: "spawn_incident",
          sourceCountryId: "USA",
          target: { regionId: hottestId },
          params: { incidentKind: "protest" },
        },
      ],
    });

    const cycle = new LLMService(game).processResponse(directorResponse);
    expect(cycle.success).toBe(true);
    expect(cycle.rejectedPrimitives).toEqual([]);
    expect(cycle.primitiveOutcomes).toHaveLength(2);

    const afterDirector = regionDiscontent(game, game.regions.find(r => r.id === hottestId)!)!;
    expect(afterDirector).toBeGreaterThan(discontentBefore);

    // Отклик виден: объект на карте есть, история места пополнилась.
    const feature = game.mapFeatures.find(f => f.regionId === hottestId && f.type === "protest");
    expect(feature).toBeDefined();
    expect(game.regions.find(r => r.id === hottestId)!.placeHistory).toHaveLength(2);

    // --- 4. Ответ игрока примитивом ---------------------------------------
    const answer = applyPrimitiveTurn(
      game,
      [
        {
          verb: "repress",
          sourceCountryId: PLAYER,
          target: { regionId: hottestId },
          params: { intensity: "severe" },
        },
      ],
      "player-answer-1"
    );

    expect(answer.duplicate).toBe(false);
    expect(answer.applied).toHaveLength(1);
    expect(answer.outcomes[0]!.headline.key).toBe("repress.headline");

    const afterAnswer = regionDiscontent(game, game.regions.find(r => r.id === hottestId)!)!;
    expect(afterAnswer).toBeLessThan(afterDirector);

    // --- 5. Двойной клик мир не трогает ------------------------------------
    const repeated = applyPrimitiveTurn(
      game,
      [
        {
          verb: "repress",
          sourceCountryId: PLAYER,
          target: { regionId: hottestId },
          params: { intensity: "severe" },
        },
      ],
      "player-answer-1"
    );
    expect(repeated.duplicate).toBe(true);
    expect(regionDiscontent(game, game.regions.find(r => r.id === hottestId)!)!).toBe(afterAnswer);

    // --- 6. Новое давление: подавление гаснет, отчуждение остаётся ----------
    // Именно здесь петля замыкается: ответ игрока не возвращает мир в исходную
    // точку, а сдвигает равновесие — репрессия выдыхается за месяцы, а
    // отчуждение прибавляется к идеологической дистанции почти навсегда.
    for (let i = 0; i < 12; i++) simulateMonth(game);

    const memory = game.groupImpactMemory.find(
      m => m.regionId === hottestId && m.groupId === groupId
    )!;
    expect(memory.suppression).toBeLessThan(0.05);
    expect(memory.alienation).toBeGreaterThan(0);

    const afterYear = regionDiscontent(game, game.regions.find(r => r.id === hottestId)!)!;
    expect(afterYear).toBeGreaterThan(afterAnswer);
  });

  it("десять кликов «Подавить» за месяц = один приказ: коридор не обходится частотой", () => {
    // Сценарий независимого ревью (2026-07-26), воспроизведённый числом. Ручка
    // `POST /primitives/apply` зовёт границу хода на КАЖДЫЙ клик игрока, и пока
    // счётчики капов жили внутри вызова, десять кликов «Подавить» по одной паре
    // за один месяц упирали оба поля памяти в потолок — ровно то, что коридор
    // магнитуды запрещает делать одним примитивом.
    const REGION = 68; // Saare
    const GROUP = "estonians";

    const order = {
      verb: "repress" as const,
      sourceCountryId: PLAYER,
      target: { regionId: REGION, groupId: GROUP },
      params: { intensity: "mild" as const },
    };

    function memory(state: GameState) {
      return state.groupImpactMemory.find(m => m.regionId === REGION && m.groupId === GROUP);
    }

    // Предпосылка сценария: регион и группа на месте, разметка не поехала.
    const probe = startedGame();
    expect(probe.currentDate).toBe("1946-02-01");
    expect(probe.regions.find(r => r.id === REGION)?.demographics?.some(d => d.groupId === GROUP))
      .toBe(true);

    // (а) один батч из десяти
    const batched = startedGame();
    const batchResult = applyPrimitiveTurn(
      batched,
      Array.from({ length: 10 }, () => order),
      "batch"
    );

    // (б) десять отдельных запросов с РАЗНЫМИ ключами — десять кликов игрока
    const clicked = startedGame();
    const clickResults = Array.from({ length: 10 }, (_, i) =>
      applyPrimitiveTurn(clicked, [order], `click-${i}`)
    );

    // (в) то же, но с бюджетом хода, обнуляемым между вызовами, — поведение ДО
    // правки. Нужен, чтобы «одинаково» не значило «одинаково сломано».
    const perCall = startedGame();
    for (let i = 0; i < 10; i++) {
      perCall.primitiveTurnBudget = emptyPrimitiveTurnBudget(perCall.currentDate);
      applyPrimitiveTurn(perCall, [order], `legacy-${i}`);
    }

    expect(batchResult.applied).toHaveLength(1);
    expect(batchResult.rejected).toHaveLength(9);
    expect(clickResults.filter(r => r.applied.length > 0)).toHaveLength(1);
    expect(clickResults.flatMap(r => r.rejected)).toHaveLength(9);

    expect(memory(clicked)!.suppression).toBe(memory(batched)!.suppression);
    expect(memory(clicked)!.alienation).toBe(memory(batched)!.alienation);

    // Цена отсутствия защиты названа числом, а не словом «обход».
    expect(memory(perCall)!.suppression).toBeGreaterThan(memory(clicked)!.suppression);
    expect(memory(perCall)!.suppression).toBe(1);
    expect(memory(perCall)!.alienation).toBe(1);
  });

  it("режиссёр не может ответить за игрока, игрок — может", () => {
    const game = startedGame();
    const regionId = game.regionCrisisLatch[0]!;

    const refused = new LLMService(game).processResponse(
      JSON.stringify({
        title: "t",
        descriptions: "d",
        actions: [],
        primitives: [
          { verb: "repress", sourceCountryId: PLAYER, target: { regionId } },
        ],
      })
    );
    expect(refused.primitiveOutcomes).toEqual([]);
    expect(refused.rejectedPrimitives).toHaveLength(1);

    const allowed = applyPrimitiveTurn(
      game,
      [{ verb: "repress", sourceCountryId: PLAYER, target: { regionId } }],
      "player-1"
    );
    expect(allowed.applied).toHaveLength(1);
  });
});
