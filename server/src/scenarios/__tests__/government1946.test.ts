import { describe, it, expect } from "vitest";
import {
  POWER_STRUCTURES,
  SOVEREIGNTY_STATUSES,
  SOVEREIGN_STATUS,
  CONDOMINIUM_STATUS,
  NON_VASSAL_SUBORDINATION_STATUSES,
} from "@shared/types/politics/Government";
import { type Country } from "@shared/types/Country";
import { createGame } from "../../game/CreateGame";

/**
 * Слой форм правления по ЗАГРУЖЕННОЙ партии 1946.
 *
 * Проверяются СВОЙСТВА, а не снимок разметки: списка «страна → ожидаемый
 * статус» здесь нет намеренно — разметка ещё уточняется
 * (docs/GOVERNMENT_1946_PROVENANCE.md: у 39 записей средняя уверенность, у 7
 * низкая), и такой список пришлось бы переписывать при каждом уточнении, ничего
 * при этом не проверяя, кроме совпадения данных с самими собой.
 *
 * ГЛАВНОЕ ЗДЕСЬ — последний describe. Юридический статус и `diplomacy.puppets`
 * это два разных предиката (разбор — shared/src/types/politics/Government.ts):
 * их множества не равны и равными быть не обязаны. Но противоречить друг другу
 * они не могут, и именно это удерживает разметку зависимости от расползания на
 * два независимых источника.
 */
function load(): Country[] {
  return createGame("1946", "SUN", "ru", 1).countries;
}

describe("government.json: покрытие и форма записи", () => {
  it("каждая страна сценария получает форму власти и юридический статус", () => {
    const missing = load()
      .filter(c => c.politics.powerStructure === undefined || c.politics.sovereigntyStatus === undefined)
      .map(c => c.id);
    expect(missing).toEqual([]);
  });

  it("значения принадлежат перечням движка", () => {
    const structures = new Set<string>(POWER_STRUCTURES);
    const statuses = new Set<string>(SOVEREIGNTY_STATUSES);
    const offending = load()
      .filter(
        c =>
          (c.politics.powerStructure !== undefined && !structures.has(c.politics.powerStructure)) ||
          (c.politics.sovereigntyStatus !== undefined && !statuses.has(c.politics.sovereigntyStatus))
      )
      .map(c => c.id);
    expect(offending).toEqual([]);
  });

  it("число сюзеренов соответствует статусу: суверен 0, кондоминиум 2, прочие зависимые 1", () => {
    const offending = load()
      .filter(c => {
        const status = c.politics.sovereigntyStatus;
        if (status === undefined) return false;
        const count = (c.politics.overlordIds ?? []).length;
        const expected = status === SOVEREIGN_STATUS ? 0 : status === CONDOMINIUM_STATUS ? 2 : 1;
        return count !== expected;
      })
      .map(c => `${c.id}:${c.politics.sovereigntyStatus}=${(c.politics.overlordIds ?? []).length}`);
    expect(offending).toEqual([]);
  });

  it("каждый сюзерен существует в ростере и не совпадает с самим субъектом", () => {
    const countries = load();
    const roster = new Set(countries.map(c => c.id));
    const dangling = countries.flatMap(c =>
      (c.politics.overlordIds ?? [])
        .filter(id => !roster.has(id) || id === c.id)
        .map(id => `${c.id} -> ${id}`)
    );
    expect(dangling).toEqual([]);
  });
});

describe("government.json не противоречит diplomacy.puppets", () => {
  it("марионетка не бывает юридически суверенной", () => {
    const countries = load();
    const byId = new Map(countries.map(c => [c.id, c]));
    const contradictions = countries.flatMap(suzerain =>
      suzerain.diplomacy.puppets
        .filter(id => byId.get(id)?.politics.sovereigntyStatus === SOVEREIGN_STATUS)
        .map(id => `${id} — марионетка ${suzerain.id}, но sovereigntyStatus='sovereign'`)
    );
    expect(contradictions).toEqual([]);
  });

  it("сюзерен по puppets входит в overlordIds своего субъекта", () => {
    const countries = load();
    const byId = new Map(countries.map(c => [c.id, c]));
    const contradictions = countries.flatMap(suzerain =>
      suzerain.diplomacy.puppets
        .filter(id => {
          const subject = byId.get(id);
          // Субъект вне ростера — это дефект ссылочной целостности, его ловит
          // findDanglingCountryReferences; здесь он не должен маскироваться под
          // расхождение статуса.
          return subject !== undefined && !(subject.politics.overlordIds ?? []).includes(suzerain.id);
        })
        .map(id => `${id} — марионетка ${suzerain.id}, а overlordIds=${JSON.stringify(byId.get(id)?.politics.overlordIds)}`)
    );
    expect(contradictions).toEqual([]);
  });

  it("обратное НЕ требуется: подчинение без вассалитета в данных есть", () => {
    // Негативная сторона того же инварианта, зафиксированная тестом, а не
    // комментарием: если бы «несуверенный ⇒ марионетка» было верно, оба
    // представления были бы одним множеством, и весь слой сводился бы к
    // переименованию `puppets`. Разница держится на зонах оккупации и спорных
    // администрациях — проверяется её НАЛИЧИЕ, без счётчика и без имён стран.
    const countries = load();
    const puppets = new Set(countries.flatMap(c => c.diplomacy.puppets));
    const subordinateNonVassals = countries.filter(
      c =>
        c.politics.sovereigntyStatus !== undefined &&
        c.politics.sovereigntyStatus !== SOVEREIGN_STATUS &&
        !puppets.has(c.id)
    );
    expect(subordinateNonVassals.length).toBeGreaterThan(0);
    // И все они — ровно тех статусов, для которых движок это разрешает.
    const unexpected = subordinateNonVassals
      .filter(c => !NON_VASSAL_SUBORDINATION_STATUSES.includes(c.politics.sovereigntyStatus!))
      .map(c => `${c.id}:${c.politics.sovereigntyStatus}`);
    expect(unexpected).toEqual([]);
  });
});
