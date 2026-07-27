import { describe, it, expect } from "vitest";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";
import { LLMService } from "../services/LLMService";
import { applyPrimitiveTurn } from "../primitives/turnBatch";
import { type GameState } from "@shared/types/GameState";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
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
    // Текст УТВЕРЖДАЕТ конкретное изменение мира, а не «три абзаца нарратива»:
    // именно такой заголовок и становился ложным каноном, когда примитив под
    // ним отклонялся (внешний аудит 2026-07-26). Здесь он законен — примитивы
    // применяются, — и тест обязан показать, что канон подтверждён фактами.
    const directorResponse = JSON.stringify({
      title: "Волнения вспыхнули и вылились на улицы",
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
    expect(cycle.narrativeCanonized).toBe(true);

    // Событие записано — и несёт рядом с текстом ФАКТИЧЕСКИЙ результат, а не
    // одну прозу: по нему потребитель проверяет заголовок, не заглядывая в мир.
    const event = game.eventHistory.at(-1)!;
    expect(event.title).toBe("Волнения вспыхнули и вылились на улицы");
    expect(event.primitiveOutcomes).toHaveLength(2);
    expect(event.rejectedPrimitives).toBeUndefined();
    // `countries` считается из применённых примитивов, а не из старого канала
    // `actions` (его здесь нет вовсе): без этого чистое primitive-событие
    // получало `countries: []` и выпадало из памяти собственной страны.
    const owner = game.regions.find(r => r.id === hottestId)!.ownerCountryId;
    expect(event.countries).toContain(owner);
    expect(event.countries).toContain("USA");
    expect(new LLMService(game).generatePrompt()).toContain(
      "Волнения вспыхнули и вылились на улицы"
    );

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

    // (г) ОДИН приказ — абсолютный якорь величины. Без него тест держался бы
    // только на равенстве «клики = батч», то есть прошёл бы и на двух одинаково
    // сломанных мирах, а магнитуда могла бы уехать молча. Тот же приём, что в
    // соседнем `server/src/primitives/__tests__/turnBatch.test.ts` («десять
    // отдельных приказов = один батч из десяти»), — продублирован здесь
    // намеренно: milestone-тест обязан ловить сдвиг сам, а не через соседа.
    const single = startedGame();
    applyPrimitiveTurn(single, [order], "single");

    expect(batchResult.applied).toHaveLength(1);
    expect(batchResult.rejected).toHaveLength(9);
    expect(clickResults.filter(r => r.applied.length > 0)).toHaveLength(1);
    expect(clickResults.flatMap(r => r.rejected)).toHaveLength(9);

    expect(memory(clicked)!.suppression).toBe(memory(batched)!.suppression);
    expect(memory(clicked)!.alienation).toBe(memory(batched)!.alienation);

    // Десять кликов оставляют ровно след ОДНОГО примитива, а не десяти сложенных.
    expect(memory(clicked)!.suppression).toBe(memory(single)!.suppression);
    expect(memory(clicked)!.alienation).toBe(memory(single)!.alienation);
    // …и это след настоящий, а не «ничего не произошло у всех троих».
    expect(memory(single)!.suppression).toBeGreaterThan(0);

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

  /**
   * Нарратив пишется ТОЛЬКО после commit и по фактически применённому
   * результату (docs/CONCEPT.md §7.2). Найдено внешним аудитом 2026-07-26:
   * `title`/`descriptions` уходили в `eventHistory` безусловно, поэтому
   * отклонённое предложение модели становилось каноном наравне с настоящим
   * событием — та самая боль Pax Historia «событие осталось, а мир не
   * изменился».
   */
  describe("неприменённый ответ не становится каноном", () => {
    it("полный отказ: события нет, а диагностика есть", () => {
      const game = startedGame();
      const regionId = game.regionCrisisLatch[0]!;
      const eventsBefore = game.eventHistory.length;

      // Сценарий аудита дословно: модель объявляет восстание подавленным и
      // предлагает `repress` ОТ ИМЕНИ страны игрока. Граница агентности
      // примитив правильно отклоняет — и текст под ним обязан отправиться в
      // диагностику, а не в летопись.
      const cycle = new LLMService(game).processResponse(
        JSON.stringify({
          title: "Восстание подавлено",
          descriptions: "Войска вошли в город, порядок восстановлен.",
          actions: [],
          primitives: [{ verb: "repress", sourceCountryId: PLAYER, target: { regionId } }],
        })
      );

      // Ответ обработан (это не ошибка формата) — но каноном не стал.
      expect(cycle.success).toBe(true);
      expect(cycle.narrativeCanonized).toBe(false);
      // Сервер не отдаёт прозу, описывающую то, чего не произошло: отличить
      // «так и было» от «предложено и отклонено» иначе было бы нечем.
      expect(cycle.title).toBeUndefined();
      expect(cycle.descriptions).toBeUndefined();
      expect(cycle.rejectedPrimitives).toHaveLength(1);

      expect(game.eventHistory).toHaveLength(eventsBefore);
      expect(game.eventHistory.some(e => e.title === "Восстание подавлено")).toBe(false);

      // Диагностика на месте в обе стороны: игроку — причина в ответе (выше),
      // модели — та же причина в следующем промте.
      expect(new LLMService(game).generatePrompt()).toContain("Attempt rejected (repress)");

      // И ложный заголовок не может добраться до летописи: она склеивает
      // заголовки событий, а события нет.
      for (let i = 0; i < 12; i++) simulateMonth(game);
      expect(game.chronicle.some(c => c.summary.includes("Восстание подавлено"))).toBe(false);
    });

    it("чистый нарратив без предложений остаётся законным событием", () => {
      // Граница проведена по «предложила и не применилось», а не по «ничего не
      // применилось»: ответ без единого примитива и действия — фоновый слой
      // (docs/PRIMITIVES.md §4), он о мире ничего не утверждает. Иначе правка
      // молча снесла бы весь нарративный слой игры.
      const game = startedGame();
      const eventsBefore = game.eventHistory.length;

      const cycle = new LLMService(game).processResponse(
        JSON.stringify({
          title: "Мир замер в ожидании",
          descriptions: "Три абзаца нарратива без единого предложения к движку.",
          actions: [],
          primitives: [],
        })
      );

      expect(cycle.narrativeCanonized).toBe(true);
      expect(game.eventHistory).toHaveLength(eventsBefore + 1);
      expect(game.eventHistory.at(-1)!.title).toBe("Мир замер в ожидании");
      // …но законное событие ≠ установленный факт: подтверждать в нём нечего,
      // и в ленте игрок увидит его помеченным (решение 2026-07-27).
      expect(cycle.factuality).toBe("unconfirmed");
      expect(game.eventHistory.at(-1)!.factuality).toBe("unconfirmed");
    });

    it("частично применённый ответ помечен, а не выдан за факт", () => {
      // Средний путь, выбранный пользователем 2026-07-27: событие остаётся (в
      // нём есть реально применённая часть), но несёт степень
      // подтверждённости — игрок видит заявление режиссёра, а не факт.
      const game = startedGame();
      const regionId = game.regionCrisisLatch[0]!;
      const region = game.regions.find(r => r.id === regionId)!;
      const groupId = [...region.demographics!].sort((a, b) => b.share - a.share)[0]!.groupId;

      const cycle = new LLMService(game).processResponse(
        JSON.stringify({
          title: "Волнения вспыхнули, и войска их подавили",
          descriptions: "Агитаторы вышли на улицы; порядок восстановлен к вечеру.",
          actions: [],
          primitives: [
            // Применится: мир действует на игрока — это разрешено.
            {
              verb: "incite_unrest",
              sourceCountryId: "USA",
              target: { regionId, groupId },
              params: { intensity: "severe" },
            },
            // Не применится: подавление в своей стране выбирает игрок, а не
            // режиссёр (граница агентности). Вторая половина заголовка — про
            // это, и она ложна.
            { verb: "repress", sourceCountryId: PLAYER, target: { regionId } },
          ],
        })
      );

      expect(cycle.narrativeCanonized).toBe(true);
      expect(cycle.factuality).toBe("partial");
      expect(cycle.primitiveOutcomes).toHaveLength(1);
      expect(cycle.rejectedPrimitives).toHaveLength(1);

      const event = game.eventHistory.at(-1)!;
      expect(event.title).toBe("Волнения вспыхнули, и войска их подавили");
      expect(event.factuality).toBe("partial");
    });

    it("летопись доносит применённое, а не заявленное", () => {
      // Заголовок частично применённого ответа вправе описывать отклонённую
      // половину; до 2026-07-27 он через год сворачивался в летопись — долгую
      // память кампании, которая целиком уходит в КАЖДЫЙ следующий промт.
      const game = startedGame();
      const regionId = game.regionCrisisLatch[0]!;
      const region = game.regions.find(r => r.id === regionId)!;
      const groupId = [...region.demographics!].sort((a, b) => b.share - a.share)[0]!.groupId;

      new LLMService(game).processResponse(
        JSON.stringify({
          title: "Волнения вспыхнули, и войска их подавили",
          descriptions: "Агитаторы вышли на улицы; порядок восстановлен к вечеру.",
          actions: [],
          primitives: [
            {
              verb: "incite_unrest",
              sourceCountryId: "USA",
              target: { regionId, groupId },
              params: { intensity: "severe" },
            },
            { verb: "repress", sourceCountryId: PLAYER, target: { regionId } },
          ],
        })
      );

      // Второй ответ того же года — чистый нарратив. Он ничего не предлагал,
      // подтверждать нечего: в ленте он есть, в многолетней памяти его нет.
      new LLMService(game).processResponse(
        JSON.stringify({
          title: "По Европе поползли слухи о новом союзе",
          descriptions: "Три абзаца нарратива без единого предложения к движку.",
          actions: [],
          primitives: [],
        })
      );

      for (let i = 0; i < 12; i++) simulateMonth(game);

      const year1946 = game.chronicle.find(c => c.year === 1946)!;
      expect(year1946).toBeDefined();
      // Ни одно из двух заявлений в летопись не попало…
      expect(year1946.summary).not.toContain("подавили");
      expect(year1946.summary).not.toContain("слухи");
      // …а применённое — попало, с местом, взятым из фактического результата.
      const regionName = getText(region.names, LLM_LOCALE);
      expect(year1946.summary).toBe(`applied: incite_unrest in ${regionName}`);

      // И та же строка — то, что увидит модель в следующем промте.
      expect(new LLMService(game).generatePrompt()).toContain(
        `- 1946: applied: incite_unrest in ${regionName}`
      );
    });

    it("устаревший ответ: игрок потратил ход, пока провайдер отвечал", async () => {
      // Самый реальный вариант той же болезни. Модель пишет текст под состояние
      // мира, которого к моменту применения уже нет: пока провайдер отвечает,
      // игрок расходует структурный слот месяца. Примитив модели корректно
      // отклоняется ПОВТОРНОЙ валидацией — и её текст, описывающий несбывшееся,
      // не должен стать событием.
      //
      // Гонка воспроизводится, а не имитируется: приказ игрока отдаётся ВНУТРИ
      // ожидания провайдера — ровно там, где его отдаёт живой игрок.
      const game = startedGame();
      const eventsBefore = game.eventHistory.length;

      const staleResponse = JSON.stringify({
        title: "Вашингтон объявил о демократической реформе",
        descriptions: "Реформа проведена, курс страны сдвинулся.",
        actions: [],
        primitives: [
          {
            verb: "enact_reform",
            sourceCountryId: "USA",
            target: { countryId: "USA" },
            params: { politicalDirection: "democratic" },
          },
        ],
      });

      const cycle = await new LLMService(game).runAutoCycle(() => {
        const playerReform = applyPrimitiveTurn(
          game,
          [
            {
              verb: "enact_reform",
              sourceCountryId: PLAYER,
              target: { countryId: PLAYER },
              params: { politicalDirection: "democratic" },
            },
          ],
          "player-reform"
        );
        // Предпосылка сценария: игрок реально занял единственный структурный
        // слот хода, а не просто «попробовал».
        expect(playerReform.applied).toHaveLength(1);
        return Promise.resolve(staleResponse);
      });

      expect(cycle.success).toBe(true);
      expect(cycle.narrativeCanonized).toBe(false);
      expect(cycle.rejectedPrimitives).toHaveLength(1);
      expect(cycle.rejectedPrimitives[0]!.reason).toMatch(/structural/);

      expect(game.eventHistory).toHaveLength(eventsBefore);
      expect(
        game.eventHistory.some(e => e.title.includes("демократической реформе"))
      ).toBe(false);
    });
  });
});
