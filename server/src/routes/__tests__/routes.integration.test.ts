import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { createApp } from "../../app";
import { setGame } from "../../game/GameStore";

/**
 * Route-слой: HTTP-проводка поверх сервисов (docs/TODO.md — "единственный
 * незакрытый кусок тест-трека"). Реальный Express-app (createApp(), без
 * listen()) через supertest — проверяет то, что модульные тесты сервисов не
 * покрывают: статус-коды, форма JSON-ответа, что Zod-отказ и каждый класс
 * ошибки (AppError.ts) долетают до клиента правильным кодом.
 */
const app = createApp();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVES_DIR = path.resolve(__dirname, "..", "..", "..", "data", "saves");
const TEST_SLOT = "__test_routes_slot";

function cleanupSaves(): void {
  for (const slot of [TEST_SLOT, "autosave"]) {
    const filePath = path.join(SAVES_DIR, `${slot}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

beforeEach(() => {
  setGame(null as any); // тот же паттерн, что GameService.ts (deleteSave/сброс)
  cleanupSaves();
});
afterEach(cleanupSaves);

async function startGame() {
  return request(app)
    .post("/game/start")
    .send({ scenarioId: "1946", playerCountryId: "USA", locale: "ru" });
}

describe("GET /game/state", () => {
  it("404, если нет активной игры", async () => {
    const res = await request(app).get("/game/state");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it("200 с текущим GameState после старта", async () => {
    await startGame();
    const res = await request(app).get("/game/state");
    expect(res.status).toBe(200);
    expect(res.body.playerCountryId).toBe("USA");
    expect(res.body.currentDate).toBe("1946-01-01");
  });
});

describe("POST /game/start", () => {
  it("200 и валидный GameState на корректный запрос", async () => {
    const res = await startGame();
    expect(res.status).toBe(200);
    expect(res.body.playerCountryId).toBe("USA");
    expect(Array.isArray(res.body.countries)).toBe(true);
    expect(Array.isArray(res.body.regions)).toBe(true);
    expect(res.body.countries.length).toBeGreaterThan(0);
  });

  it("400 с деталями Zod на отсутствующее обязательное поле", async () => {
    const res = await request(app).post("/game/start").send({ scenarioId: "1946" });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it("400 на несуществующий scenarioId", async () => {
    const res = await request(app)
      .post("/game/start")
      .send({ scenarioId: "no-such-scenario", playerCountryId: "USA" });
    expect(res.status).toBe(400);
  });
});

describe("POST /game/next-turn", () => {
  it("409 (гейт хода), если LLM ещё не ответила в этом цикле", async () => {
    await startGame();
    const res = await request(app).post("/game/next-turn").send({});
    expect(res.status).toBe(409);
  });

  it("404, если нет активной игры", async () => {
    const res = await request(app).post("/game/next-turn").send({});
    expect(res.status).toBe(404);
  });
});

describe("GET /scenarios/list", () => {
  it("200, массив сценариев с featuredCountries/tier", async () => {
    const res = await request(app).get("/scenarios/list");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const scenario1946 = res.body.find((s: { id: string }) => s.id === "1946");
    expect(scenario1946).toBeDefined();
    expect(Array.isArray(scenario1946.featuredCountries)).toBe(true);
    expect(scenario1946.featuredCountries[0].tier).toBeDefined();
  });
});

describe("PUT /budget", () => {
  it("404, если нет активной игры", async () => {
    const res = await request(app).put("/budget").send({
      military: 0.2, research: 0.1, education: 0.1, infrastructure: 0.1, welfare: 0.1,
    });
    expect(res.status).toBe(404);
  });

  it("200 на валидное обновление после старта игры", async () => {
    await startGame();
    const res = await request(app).put("/budget").send({
      military: 0.2, research: 0.1, education: 0.1, infrastructure: 0.1, welfare: 0.1,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("400 на долю за пределами капа (Zod .max())", async () => {
    await startGame();
    const res = await request(app).put("/budget").send({
      military: 999, research: 0.1, education: 0.1, infrastructure: 0.1, welfare: 0.1,
    });
    expect(res.status).toBe(400);
  });
});

describe("PUT /player-intent", () => {
  it("404, если нет активной игры", async () => {
    const res = await request(app).put("/player-intent").send({ intent: "test" });
    expect(res.status).toBe(404);
  });

  it("200 и сохраняет свободный текст намерения", async () => {
    await startGame();
    const res = await request(app).put("/player-intent").send({ intent: "Наращивать флот" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("Наращивать флот");
  });
});

describe("GET /research/state", () => {
  it("404, если нет активной игры", async () => {
    const res = await request(app).get("/research/state");
    expect(res.status).toBe(404);
  });

  it("200 с состоянием технологий страны игрока после старта", async () => {
    await startGame();
    const res = await request(app).get("/research/state");
    expect(res.status).toBe(200);
  });
});

describe("GET /llm/prompt и POST /llm/response", () => {
  it("/llm/prompt: 404 без активной игры, 200 со строкой prompt после старта", async () => {
    const before = await request(app).get("/llm/prompt");
    expect(before.status).toBe(404);

    await startGame();
    const after = await request(app).get("/llm/prompt");
    expect(after.status).toBe(200);
    expect(typeof after.body.prompt).toBe("string");
    expect(after.body.prompt.length).toBeGreaterThan(0);
  });

  it("/llm/response: 400 на отсутствующее поле response", async () => {
    await startGame();
    const res = await request(app).post("/llm/response").send({});
    expect(res.status).toBe(400);
  });
});

describe("POST /llm/auto", () => {
  it("404, если нет активной игры (падает до сетевого вызова провайдера)", async () => {
    const res = await request(app).post("/llm/auto").send({});
    expect(res.status).toBe(404);
  });
});

describe("Сейвы: save -> saves -> load -> delete (round trip через HTTP)", () => {
  it("POST /game/save: 404, если нет активной игры", async () => {
    const res = await request(app).post("/game/save").send({ slot: TEST_SLOT });
    expect(res.status).toBe(404);
  });

  it("полный цикл, 404 после удаления", async () => {
    await startGame();

    const save = await request(app).post("/game/save").send({ slot: TEST_SLOT });
    expect(save.status).toBe(200);

    const list = await request(app).get("/game/saves");
    expect(list.status).toBe(200);
    expect(list.body.some((s: { slot: string }) => s.slot === TEST_SLOT)).toBe(true);

    const load = await request(app).post("/game/load").send({ slot: TEST_SLOT });
    expect(load.status).toBe(200);
    expect(load.body.playerCountryId).toBe("USA");

    const del = await request(app).delete(`/game/saves/${TEST_SLOT}`);
    expect(del.status).toBe(200);

    const loadAfterDelete = await request(app).post("/game/load").send({ slot: TEST_SLOT });
    expect(loadAfterDelete.status).toBe(404);
  });

  it("400 на имя слота вне разрешённого алфавита (защита от path traversal)", async () => {
    await startGame();
    const res = await request(app).post("/game/save").send({ slot: "../../etc/passwd" });
    expect(res.status).toBe(400);
  });
});
