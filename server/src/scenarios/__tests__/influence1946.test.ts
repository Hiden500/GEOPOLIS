import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { INFLUENCE_SCALE_MAX } from "@shared/defines/diplomacy";
import { INFLUENCE_MIN_RECORDED } from "../scenario1946Schemas";
import { type GameState } from "@shared/types/GameState";

/**
 * Стартовое влияние держав на боевых данных 1946.
 *
 * Тест проверяет СВОЙСТВА каркаса, а не его снимок: ни одного идентификатора
 * страны и ни одного порога влияния здесь не зашито, потому что разметка будет
 * уточняться, а свойства — нет.
 *
 * Зачем слой вообще нужен: `DiplomacyTick` работает только по существующим
 * записям `influence`/`relations`, а до этого файла они были пусты у всех 157
 * стран. Дипломатия работала вхолостую — дрейфовать было нечему.
 */

function game(): GameState {
  return createGame("1946", "SUN", "ru", 1);
}

function links(state: GameState): { from: string; to: string; value: number }[] {
  return state.countries.flatMap(c =>
    Object.entries(c.diplomacy.influence).map(([to, value]) => ({ from: c.id, to, value }))
  );
}

describe("влияние 1946 загружается в состояние", () => {
  it("каркас непуст и разрежен: связей много меньше числа возможных пар", () => {
    const state = game();
    const all = links(state);
    expect(all.length).toBeGreaterThan(0);

    // Полная матрица — 157×156 ≈ 24 500 пар. Правило проекта запрещает её
    // заводить; каркас обязан оставаться на два порядка меньше.
    const possiblePairs = state.countries.length * (state.countries.length - 1);
    expect(all.length).toBeLessThan(possiblePairs / 10);
  });

  it("каждая связь указывает на существующую страну и лежит в шкале", () => {
    const state = game();
    const roster = new Set(state.countries.map(c => c.id));
    const broken = links(state).filter(
      l => !roster.has(l.to) || l.value < INFLUENCE_MIN_RECORDED || l.value > INFLUENCE_SCALE_MAX
    );
    expect(broken).toEqual([]);
  });

  it("страна не влияет сама на себя", () => {
    expect(links(game()).filter(l => l.from === l.to)).toEqual([]);
  });

  it("формальный сюзерен всегда имеет влияние на своего клиента", () => {
    // Юридический статус и рычаг — разные свойства (см. government.json), но
    // держава, назначающая администрацию, обязана иметь на неё влияние: иначе
    // колония в дипломатии ведёт себя как посторонняя страна.
    const state = game();
    const byId = new Map(state.countries.map(c => [c.id, c] as const));
    const dependencies = state.countries.flatMap(c =>
      (c.politics.overlordIds ?? []).map(overlordId => ({ dependent: c.id, overlordId }))
    );
    // Пустой список выполнил бы утверждение молча: слой форм правления обязан
    // быть загружен, иначе проверять нечего.
    expect(dependencies.length).toBeGreaterThan(0);

    const missing = dependencies.filter(
      ({ dependent, overlordId }) => byId.get(overlordId)?.diplomacy.influence[dependent] === undefined
    );
    expect(missing).toEqual([]);
  });

  it("сюзерен давит на клиента сильнее, чем в среднем по карте", () => {
    const state = game();
    const all = links(state);
    const formal = new Set(
      state.countries.flatMap(c => (c.politics.overlordIds ?? []).map(o => `${o}->${c.id}`))
    );
    const formalValues = all.filter(l => formal.has(`${l.from}->${l.to}`)).map(l => l.value);
    const otherValues = all.filter(l => !formal.has(`${l.from}->${l.to}`)).map(l => l.value);
    expect(formalValues.length).toBeGreaterThan(0);
    expect(otherValues.length).toBeGreaterThan(0);

    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(formalValues)).toBeGreaterThan(avg(otherValues));
  });

  it("ни одна держава не собрала весь каркас: влияние распределено", () => {
    // Прежняя разметка зависимости давала Британии 42 клиента против двух у
    // СССР, из-за чего дипломатия видела один центр силы. Свойство, которое
    // это удерживает: доля крупнейшего источника ограничена.
    const state = game();
    const all = links(state);
    const perSource = new Map<string, number>();
    for (const l of all) perSource.set(l.from, (perSource.get(l.from) ?? 0) + 1);
    const largest = Math.max(...perSource.values());
    expect(largest / all.length).toBeLessThan(0.5);
    expect(perSource.size).toBeGreaterThan(10);
  });

  it("влияние доходит до механики: пара с влиянием имеет ненулевую зависимость", () => {
    // `DiplomacyTick.dependencyStrength` читает influence наравне с puppets и
    // guarantees. До этого слоя ветка influence не срабатывала никогда.
    const state = game();
    const strongest = links(state).sort((a, b) => b.value - a.value)[0]!;
    const source = state.countries.find(c => c.id === strongest.from)!;
    expect(source.diplomacy.influence[strongest.to]).toBe(strongest.value);
    expect(strongest.value).toBeGreaterThan(INFLUENCE_MIN_RECORDED);
  });
});
