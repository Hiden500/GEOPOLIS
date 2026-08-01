import { describe, it, expect } from "vitest";
import { stripCodeFence } from "../stripCodeFence";

/**
 * Первый кейс — дословно то, на чём падали 3 из 10 живых ходов
 * gemini-3.6-flash-high через OpenAI-совместимый шлюз (2026-08-01).
 * Остальные защищают границу: снимается ТОЛЬКО забор, охватывающий весь ответ,
 * и ничего не выковыривается из прозы.
 */
describe("stripCodeFence", () => {
  it("снимает ```json — ровно та поломка, что ловилась живым замером", () => {
    const raw = '```json\n{"title":"Январь 1946","actions":[]}\n```';
    expect(JSON.parse(stripCodeFence(raw))).toEqual({ title: "Январь 1946", actions: [] });
  });

  it("снимает забор без указания языка", () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("терпит пробелы и перевод строки вокруг забора", () => {
    expect(stripCodeFence('  \n```JSON \n{"a":1}\n```  \n')).toBe('{"a":1}');
  });

  it("не трогает чистый JSON — путь без забора обязан остаться байт в байт", () => {
    const clean = '{"title":"x","actions":[{"type":"research_shift"}]}';
    expect(stripCodeFence(clean)).toBe(clean);
  });

  it("сохраняет тройные кавычки ВНУТРИ строкового значения", () => {
    const raw = '```json\n{"text":"пример ```кода``` внутри"}\n```';
    expect(JSON.parse(stripCodeFence(raw))).toEqual({ text: "пример ```кода``` внутри" });
  });

  it("НЕ выковыривает JSON из прозы: объяснение вокруг ответа остаётся поломкой", () => {
    const raw = 'Вот мой ответ:\n{"a":1}\nНадеюсь, подошло.';
    expect(stripCodeFence(raw)).toBe(raw);
    expect(() => JSON.parse(stripCodeFence(raw))).toThrow();
  });

  it("НЕ склеивает незакрытый забор: оборванный ответ обязан падать, а не проходить", () => {
    const raw = '```json\n{"a":1}';
    expect(stripCodeFence(raw)).toBe(raw);
    expect(() => JSON.parse(stripCodeFence(raw))).toThrow();
  });
});
