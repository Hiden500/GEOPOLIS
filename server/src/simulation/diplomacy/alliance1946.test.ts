import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { diplomacyTick } from "./DiplomacyTick";
import { allianceThreshold } from "./affinity";
import { ideologyDistance, resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { RELATION_SCALE_MAX } from "@shared/defines/diplomacy";
import { type Country } from "@shared/types/Country";

/**
 * Закрытие дефекта «103 страны не могут заключить союз ни с кем» — НА БОЕВЫХ
 * ДАННЫХ, а не на фикстуре.
 *
 * Дефект возник так: `DiplomacyTick.areIdeologicallyCompatible` искала в тексте
 * ярлыка идеологии шесть подстрок (`democracy`, `republic`, `communism`,
 * `socialism`, `fascism`, `monarchy`). После перевода ярлыка на вывод из
 * координат (2026-07-27) в данных 1946 остались пять ярлыков, и три из них —
 * `Traditionalism` (60 стран), `Nationalism` (25), `Authoritarianism` (18) — не
 * содержат ни одной подстроки. Такие страны не могли заключить союз даже с
 * собственной копией.
 *
 * Тест НЕ фиксирует, сколько стран носит какой ярлык, и не знает ни одного
 * идентификатора: следующее наполнение данных изменит и то, и другое. Он
 * утверждает свойство — «непригодных к союзу нет ни одной» — и проверяет его
 * прогоном движка по тому составу мира, который лежит в сценарии сейчас.
 */

function distanceBetween(a: Country, b: Country): number {
  return ideologyDistance(
    resolveIdeologyCoordinates(a.politics),
    resolveIdeologyCoordinates(b.politics)
  );
}

describe("сценарий 1946: право на союз", () => {
  it("ни одна страна мира не лишена права заключить союз", () => {
    const game = createGame("1946", "SUN", "ru");
    expect(game.countries.length).toBeGreaterThan(0);

    const unable = game.countries.filter(
      a =>
        !game.countries.some(
          b => b.id !== a.id && allianceThreshold(distanceBetween(a, b), 0) < RELATION_SCALE_MAX
        )
    );

    expect(unable.map(c => c.id)).toEqual([]);
  });

  it("движок действительно заключает эти союзы: насыщенные отношения → союз у каждой пары", () => {
    // Проверка не формулы, а тика целиком, и на настоящем ростере: если бы
    // где-то остался запрет (гейт, недостижимый порог, забытая ветка), пары с
    // «неудобными» ярлыками союз не получили бы.
    const game = createGame("1946", "SUN", "ru");
    const roster = [...game.countries].sort((a, b) => a.id.localeCompare(b.id));

    const paired: Country[] = [];
    for (let i = 0; i + 1 < roster.length; i += 2) {
      const a = roster[i]!;
      const b = roster[i + 1]!;
      a.diplomacy.relations[b.id] = RELATION_SCALE_MAX;
      b.diplomacy.relations[a.id] = RELATION_SCALE_MAX;
      paired.push(a, b);
    }
    expect(paired.length).toBeGreaterThan(0);

    diplomacyTick(game);

    const withoutAlly = paired.filter(c => c.diplomacy.allies.length === 0);
    expect(withoutAlly.map(c => c.id)).toEqual([]);
  });

  it("сам по себе мир 1946 в блоки не сваливается: первый тик союзов не создаёт", () => {
    // Обратная сторона: снятый запрет не должен превратиться в раздачу союзов.
    // В январе 1946 формальных блоков нет (НАТО 1949, ОВД 1955), и тик обязан
    // оставить их отсутствие в покое.
    const game = createGame("1946", "SUN", "ru");

    diplomacyTick(game);

    expect(game.countries.filter(c => c.diplomacy.allies.length > 0)).toEqual([]);
  });

  it("дрейф материализует только пары с живым каналом, а не матрицу мира", () => {
    // Цена выбранного решения удерживается тестом, а не обещанием в
    // комментарии: запись об отношениях появляется исключительно у пары,
    // связанной границей или формальным обязательством. Множество связей
    // собрано здесь НЕЗАВИСИМО от тика — совпадение реализаций не помогло бы
    // тесту пройти, если бы тик завёл лишнюю пару.
    const game = createGame("1946", "SUN", "ru");

    const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const linked = new Set<string>();
    const ownerOf = new Map(game.regions.map(r => [r.id, r.ownerCountryId]));
    for (const region of game.regions) {
      for (const neighbourId of region.neighboringRegionIds) {
        const neighbourOwner = ownerOf.get(neighbourId);
        if (!neighbourOwner || neighbourOwner === region.ownerCountryId) continue;
        linked.add(key(region.ownerCountryId, neighbourOwner));
      }
    }
    for (const country of game.countries) {
      const d = country.diplomacy;
      for (const id of [
        ...d.allies,
        ...d.puppets,
        ...d.sphereOfInfluence,
        ...d.guarantees,
        ...Object.keys(d.influence),
      ]) {
        linked.add(key(country.id, id));
      }
    }

    diplomacyTick(game);

    const materialized = new Set<string>();
    for (const country of game.countries) {
      for (const id of Object.keys(country.diplomacy.relations)) {
        materialized.add(key(country.id, id));
      }
    }

    expect(materialized.size).toBeGreaterThan(0);
    expect([...materialized].filter(pair => !linked.has(pair))).toEqual([]);
  });
});
