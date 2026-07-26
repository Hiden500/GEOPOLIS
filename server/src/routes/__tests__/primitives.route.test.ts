import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { getGame, setGame } from "../../game/GameStore";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_REGION_NATIONAL,
} from "../../test-utils/discontentFixtures";

/**
 * HTTP-слой пути игрока (docs/PRIMITIVES.md §1). Проверяется то, чего не видят
 * модульные тесты: коды ответов, форма JSON и границы, которые обязаны жить
 * именно на ручке — чужой источник и idempotency-ключ от клиента.
 */
const app = createApp();

beforeEach(() => {
  setGame(createDiscontentTestGame());
});

afterEach(() => {
  setGame(null as never);
  vi.unstubAllEnvs();
});

const repress = {
  verb: "repress",
  sourceCountryId: "SUN",
  target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
  params: { intensity: "moderate" },
};

function suppressionNow(): number {
  return (
    getGame()!.groupImpactMemory.find(
      m => m.regionId === TEST_REGION_NATIONAL && m.groupId === TEST_GROUP_TITULAR
    )?.suppression ?? 0
  );
}

describe("POST /primitives/apply", () => {
  it("применяет подтверждённый приказ и возвращает локализуемый отклик", async () => {
    const response = await request(app)
      .post("/primitives/apply")
      .send({ primitives: [repress], idempotencyKey: "order-1" });

    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(false);
    expect(response.body.outcomes).toHaveLength(1);
    expect(response.body.outcomes[0].headline.key).toBe("repress.headline");
    expect(suppressionNow()).toBeGreaterThan(0);
  });

  it("тот же ключ второй раз (двойной клик, ретрай) мир не трогает", async () => {
    await request(app)
      .post("/primitives/apply")
      .send({ primitives: [repress], idempotencyKey: "order-1" });
    const afterFirst = suppressionNow();

    const second = await request(app)
      .post("/primitives/apply")
      .send({ primitives: [repress], idempotencyKey: "order-1" });

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.outcomes).toEqual([]);
    expect(suppressionNow()).toBe(afterFirst);
  });

  it("отказывает в приказе от чужого имени, а не переписывает источник молча", async () => {
    const response = await request(app)
      .post("/primitives/apply")
      .send({
        primitives: [{ ...repress, sourceCountryId: "USA" }],
        idempotencyKey: "order-1",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("can only act as SUN");
    expect(suppressionNow()).toBe(0);
  });

  it("отклонённый движком приказ возвращает причину и ничего не применяет", async () => {
    const response = await request(app)
      .post("/primitives/apply")
      .send({
        primitives: [
          {
            verb: "spawn_incident",
            sourceCountryId: "SUN",
            target: { regionId: TEST_REGION_NATIONAL },
            params: { incidentKind: "uprising" },
          },
        ],
        idempotencyKey: "order-1",
      });

    expect(response.status).toBe(200);
    expect(response.body.outcomes).toEqual([]);
    expect(response.body.rejected).toHaveLength(1);
    expect(response.body.rejected[0].verb).toBe("spawn_incident");
    expect(response.body.rejected[0].reason).toContain("uprising");
    expect(getGame()!.mapFeatures).toHaveLength(0);
  });

  it("величина числом в params — 400 от схемы, до всякого применения", async () => {
    const response = await request(app)
      .post("/primitives/apply")
      .send({
        primitives: [{ ...repress, params: { intensity: "severe", magnitude: 0.9 } }],
        idempotencyKey: "order-1",
      });

    expect(response.status).toBe(400);
    expect(suppressionNow()).toBe(0);
  });

  it("без ключа идемпотентности запрос не принимается", async () => {
    const response = await request(app).post("/primitives/apply").send({ primitives: [repress] });

    expect(response.status).toBe(400);
    expect(suppressionNow()).toBe(0);
  });

  it("без активной партии — 404", async () => {
    setGame(null as never);
    const response = await request(app)
      .post("/primitives/apply")
      .send({ primitives: [repress], idempotencyKey: "order-1" });

    expect(response.status).toBe(404);
  });

  it("десять кликов подряд = один приказ: кап хода живёт в состоянии, а не в вызове", async () => {
    // Ровно тот путь, которым кап обходился: каждый клик — свой запрос со своим
    // ключом, дублем не является, и до переезда счётчиков в состояние партии
    // все десять применялись.
    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .post("/primitives/apply")
        .send({ primitives: [repress], idempotencyKey: `click-${i}` });
      expect(response.status).toBe(200);
      expect(response.body.duplicate).toBe(false);
      if (i > 0) {
        expect(response.body.outcomes).toEqual([]);
        expect(response.body.rejected[0].reason).toContain("per target per turn");
      }
    }

    const afterTen = suppressionNow();

    // Сверка величиной, а не «второй запрос ответил отказом»: мир обязан быть
    // ровно там, куда его двигает ОДИН примитив.
    setGame(createDiscontentTestGame());
    await request(app)
      .post("/primitives/apply")
      .send({ primitives: [repress], idempotencyKey: "single" });

    expect(afterTen).toBe(suppressionNow());
  });
});

describe("POST /primitives/translate", () => {
  it("пустой текст не отправляется в модель вовсе", async () => {
    const response = await request(app).post("/primitives/translate").send({ intent: "" });
    expect(response.status).toBe(400);
  });

  it("чужой регион в выделении — 400 ДО вызова модели", async () => {
    // Регион 187 принадлежит SUN; подменяем владельца, чтобы выделение стало
    // чужим. Ключ провайдера при этом не задан: если бы проверка стояла после
    // вызова модели, ответ был бы 502 «нет ключа», а не 400 про регион.
    vi.stubEnv("GEMINI_API_KEY", "");
    const game = getGame()!;
    game.regions.find(r => r.id === TEST_REGION_NATIONAL)!.ownerCountryId = "USA";

    const response = await request(app)
      .post("/primitives/translate")
      .send({ intent: "подавить волнения", selectedRegionId: TEST_REGION_NATIONAL });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not controlled by SUN");
  });

  it("несуществующий регион в выделении — 400, а не выдуманная цель в промте", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const response = await request(app)
      .post("/primitives/translate")
      .send({ intent: "подавить волнения", selectedRegionId: 999999 });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("does not exist");
  });

  it("без ключа провайдера — честный 502, а не молчаливый пустой перевод", async () => {
    // Пустой текст ключа = «не задан» (см. GeminiProvider): игрок должен
    // увидеть причину, иначе «ничего не распозналось» выглядит как отказ
    // понимания, а не как отсутствие настройки.
    vi.stubEnv("GEMINI_API_KEY", "");

    const response = await request(app)
      .post("/primitives/translate")
      .send({ intent: "подавить волнения" });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("GEMINI_API_KEY");
  });
});
