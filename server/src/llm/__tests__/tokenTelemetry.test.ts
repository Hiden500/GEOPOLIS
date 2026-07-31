import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  parseGeminiUsage,
  appendTokenUsage,
  readTokenUsage,
  percentiles,
  tokenUsageLogPath,
} from "../tokenTelemetry";

/**
 * Телеметрия расхода токенов.
 *
 * Главное свойство, которое здесь охраняется, — телеметрия НЕ ВЛИЯЕТ на игру:
 * ни отсутствие метаданных у провайдера, ни недоступный каталог логов, ни
 * оборванная строка в журнале не должны ронять ход. Всё остальное (перцентили,
 * разбор полей) — арифметика вокруг этого свойства.
 */

let tempDir: string;
let previousLog: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-usage-"));
  previousLog = process.env.TOKEN_USAGE_LOG;
  process.env.TOKEN_USAGE_LOG = path.join(tempDir, "nested", "token-usage.jsonl");
});

afterEach(() => {
  if (previousLog === undefined) delete process.env.TOKEN_USAGE_LOG;
  else process.env.TOKEN_USAGE_LOG = previousLog;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("разбор usageMetadata провайдера", () => {
  it("читает вход, выход, мысли и итог", () => {
    const usage = parseGeminiUsage({
      usageMetadata: {
        promptTokenCount: 3200,
        candidatesTokenCount: 800,
        thoughtsTokenCount: 1500,
        totalTokenCount: 5500,
      },
    });
    expect(usage).toEqual({
      promptTokens: 3200,
      responseTokens: 800,
      thoughtTokens: 1500,
      totalTokens: 5500,
    });
  });

  it("ответ без метаданных не считается ошибкой", () => {
    // Провайдер может не вернуть usageMetadata (квота, смена схемы ответа).
    // Текст ответа при этом уже получен и применяется — телеметрия молчит.
    expect(parseGeminiUsage({ candidates: [] })).toBeUndefined();
    expect(parseGeminiUsage(null)).toBeUndefined();
    expect(parseGeminiUsage("нет")).toBeUndefined();
  });

  it("метаданные без входа или итога отбрасываются целиком", () => {
    expect(parseGeminiUsage({ usageMetadata: { candidatesTokenCount: 10 } })).toBeUndefined();
    expect(parseGeminiUsage({ usageMetadata: { promptTokenCount: 10 } })).toBeUndefined();
  });

  it("нечисловые значения не превращаются в NaN в журнале", () => {
    expect(
      parseGeminiUsage({ usageMetadata: { promptTokenCount: "много", totalTokenCount: 10 } })
    ).toBeUndefined();
  });

  it("отсутствие мыслей — не ноль, а отсутствие поля", () => {
    const usage = parseGeminiUsage({
      usageMetadata: { promptTokenCount: 100, totalTokenCount: 150 },
    });
    expect(usage?.thoughtTokens).toBeUndefined();
  });
});

describe("журнал", () => {
  const entry = {
    at: "1946-01-01T00:00:00.000Z",
    model: "test-model",
    purpose: "world-cycle",
    promptTokens: 3000,
    responseTokens: 500,
    totalTokens: 3500,
  };

  it("создаёт каталог и дописывает строку за строкой", () => {
    expect(appendTokenUsage(entry)).toBe(true);
    expect(appendTokenUsage({ ...entry, totalTokens: 4000 })).toBe(true);

    const read = readTokenUsage(tokenUsageLogPath());
    expect(read).toHaveLength(2);
    expect(read[1]!.totalTokens).toBe(4000);
  });

  it("недоступный путь не роняет вызывающего", () => {
    // Каталог логов может быть недоступен (права, диск). Телеметрия обязана
    // вернуть false, а не бросить: иначе наблюдатель роняет игровой ход.
    process.env.TOKEN_USAGE_LOG = path.join(tempDir, "file-as-dir");
    fs.writeFileSync(process.env.TOKEN_USAGE_LOG, "занято", "utf-8");
    process.env.TOKEN_USAGE_LOG = path.join(tempDir, "file-as-dir", "log.jsonl");

    expect(() => appendTokenUsage(entry)).not.toThrow();
    expect(appendTokenUsage(entry)).toBe(false);
  });

  it("оборванная строка не теряет остальной журнал", () => {
    const target = tokenUsageLogPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `${JSON.stringify(entry)}\n{"at":"обрыв\n${JSON.stringify(entry)}\n`,
      "utf-8"
    );
    expect(readTokenUsage(target)).toHaveLength(2);
  });

  it("отсутствующий журнал читается как пустой", () => {
    expect(readTokenUsage(path.join(tempDir, "нет-такого.jsonl"))).toEqual([]);
  });
});

describe("перцентили", () => {
  it("считаются ближайшим рангом, без интерполяции", () => {
    // Ряд из 10 значений: p90 обязан быть реально случившимся 90, а не
    // средним между 90 и 100.
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const p = percentiles(values)!;
    expect(p.count).toBe(10);
    expect(p.min).toBe(10);
    expect(p.median).toBe(50);
    expect(p.p90).toBe(90);
    expect(p.max).toBe(100);
    expect(values).toContain(p.p99);
  });

  it("не зависят от порядка на входе", () => {
    const shuffled = percentiles([100, 10, 50, 30])!;
    const sorted = percentiles([10, 30, 50, 100])!;
    expect(shuffled).toEqual(sorted);
  });

  it("пустая выборка не даёт выдуманных чисел", () => {
    expect(percentiles([])).toBeUndefined();
  });

  it("единственный вызов даёт одно и то же во всех точках", () => {
    const p = percentiles([777])!;
    expect([p.min, p.median, p.p90, p.p99, p.max]).toEqual([777, 777, 777, 777, 777]);
  });
});
