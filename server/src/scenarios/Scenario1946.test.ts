import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildScenario1946, ScenarioDataError } from "./Scenario1946";
import { RELATION_SCALE_MIN, RELATION_SCALE_MAX } from "@shared/defines/diplomacy";

/**
 * Расслоение regions.json (docs/plans/05_DATA_LAYOUT.md, Срез 1): core (география) +
 * names.en/names.ru (локализация) + state (владение/экономика) собираются в Region[]
 * на загрузке. countries.json (Срез 2) — авторский формат без нулевых блоков,
 * собирается в Country[] через createCountry(). Фикстуры пишутся во временную
 * директорию — не зависят от реальных 1366 регионов/128 стран сценария (те
 * покрыты сквозным createGame("1946", ...) в CreateGame.test.ts).
 */
describe("buildScenario1946 (план 05, Срезы 1-2)", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario1946-test-"));
    return tmpDir;
  }

  function writeFixture(dir: string, files: {
    core?: unknown;
    state?: unknown;
    namesEn?: unknown;
    namesRu?: unknown;
    countries?: unknown;
  }): void {
    const defaultCore = [
      { id: 1, geoJsonId: "EUR-0001", area: 451.5, neighboringRegionIds: [2], sourceAdm1Codes: ["EUR-0001"] },
      { id: 2, geoJsonId: "EUR-0002", area: 100, neighboringRegionIds: [1] },
    ];
    const defaultState = [
      {
        id: 1, ownerCountryId: "AND", population: 5500, urbanization: 0.137,
        stability: 0.798, infrastructure: 0.51, development: 0.565, gdp: 1584825,
        deposits: { food: 6 }, extraction: { food: 10 },
      },
      {
        id: 2, ownerCountryId: "FRA", population: 1000, urbanization: 0.5,
        stability: 0.5, infrastructure: 0.5, development: 0.5, gdp: 100000,
        deposits: {}, extraction: {},
      },
    ];
    const defaultNamesEn = { "EUR-0001": "Andorra", "EUR-0002": "Some Region" };
    const defaultNamesRu = { "EUR-0001": "Андорра", "EUR-0002": "Какой-то регион" };
    const defaultCountries: unknown[] = [];

    fs.writeFileSync(path.join(dir, "regions.core.json"), JSON.stringify(files.core ?? defaultCore));
    fs.writeFileSync(path.join(dir, "regions.state.json"), JSON.stringify(files.state ?? defaultState));
    fs.writeFileSync(path.join(dir, "names.en.json"), JSON.stringify(files.namesEn ?? defaultNamesEn));
    fs.writeFileSync(path.join(dir, "names.ru.json"), JSON.stringify(files.namesRu ?? defaultNamesRu));
    fs.writeFileSync(path.join(dir, "countries.json"), JSON.stringify(files.countries ?? defaultCountries));
  }

  it("критерий 1: собирает Region[] из core+state+names по id/geoJsonId", () => {
    const dir = makeTmpDir();
    writeFixture(dir, {});

    const scenario = buildScenario1946(dir);

    expect(scenario.regions).toHaveLength(2);
    const andorra = scenario.regions.find(r => r.id === 1)!;
    expect(andorra.geoJsonId).toBe("EUR-0001");
    expect(andorra.names).toEqual({ en: "Andorra", ru: "Андорра" });
    expect(andorra.ownerCountryId).toBe("AND");
    expect(andorra.area).toBe(451.5);
    expect(andorra.population).toBe(5500);
    expect(andorra.deposits).toEqual({ food: 6 });
    expect(andorra.extraction).toEqual({ food: 10 });
    expect(andorra.neighboringRegionIds).toEqual([2]);
  });

  it("падает с внятной ошибкой на битом JSON (regions.core.json)", () => {
    const dir = makeTmpDir();
    writeFixture(dir, {});
    fs.writeFileSync(path.join(dir, "regions.core.json"), "{ this is not valid json");

    expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
    expect(() => buildScenario1946(dir)).toThrow(/regions\.core\.json/);
  });

  it("падает с внятной ошибкой, если regions.state.json не проходит схему (отсутствует поле)", () => {
    const dir = makeTmpDir();
    writeFixture(dir, {
      state: [{ id: 1, ownerCountryId: "AND" /* нет population/urbanization/... */ }],
    });

    expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
  });

  it("падает с внятной ошибкой, если у региона из core нет записи в state", () => {
    const dir = makeTmpDir();
    writeFixture(dir, {
      core: [{ id: 1, geoJsonId: "EUR-0001", area: 451.5, neighboringRegionIds: [] }],
      state: [], // регион 1 не описан
    });

    expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
    expect(() => buildScenario1946(dir)).toThrow(/id=1/);
  });

  it("падает с внятной ошибкой, если у региона нет имени ни в одной локали", () => {
    const dir = makeTmpDir();
    writeFixture(dir, {
      namesEn: {}, // EUR-0001/EUR-0002 отсутствуют
      namesRu: {},
    });

    expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
    expect(() => buildScenario1946(dir)).toThrow(/geoJsonId/);
  });

  it("допускает частичную локализацию (имя только в одном языке)", () => {
    const dir = makeTmpDir();
    writeFixture(dir, {
      namesEn: { "EUR-0001": "Andorra", "EUR-0002": "Some Region" },
      namesRu: { "EUR-0001": "Андорра" }, // EUR-0002 без русского имени — не фатально
    });

    const scenario = buildScenario1946(dir);
    const second = scenario.regions.find(r => r.id === 2)!;
    expect(second.names).toEqual({ en: "Some Region" });
  });

  describe("countries.json (Срез 2)", () => {
    it("критерий: авторская запись без нулевых блоков собирается в полноценный Country через createCountry", () => {
      const dir = makeTmpDir();
      writeFixture(dir, {
        countries: [{
          id: "AND", name: { en: "Andorra" }, shortName: { en: "Andorra" }, color: "#123456",
          capitalRegionId: 1, economyType: "mixed",
          politics: { ideology: "Liberal Democracy" },
        }],
      });

      const scenario = buildScenario1946(dir);

      expect(scenario.countries).toHaveLength(1);
      const country = scenario.countries[0]!;
      expect(country.id).toBe("AND");
      expect(country.technology).toEqual({ domains: {} });
      expect(country.military.equipment.tanks).toBe(0);
      expect(country.diplomacy.puppets).toEqual([]);
      expect(country.stockpile.oil).toBe(0);
      expect(country.politics.ideology).toBe("Liberal Democracy");
    });

    it("currencyZoneAnchor переживает загрузку (не срезается схемой — план 10)", () => {
      const dir = makeTmpDir();
      writeFixture(dir, {
        countries: [{
          id: "QGS", name: { en: "Soviet Occupation Zone (Germany)" }, shortName: { en: "QGS" }, color: "#123456",
          capitalRegionId: 1, economyType: "planned",
          politics: { ideology: "Communism" },
          currencyZoneAnchor: "SUN",
        }],
      });

      const scenario = buildScenario1946(dir);

      expect(scenario.countries[0]!.currencyZoneAnchor).toBe("SUN");
    });

    it("падает с внятной ошибкой, если у страны нет politics.ideology", () => {
      const dir = makeTmpDir();
      writeFixture(dir, {
        countries: [{
          id: "AND", name: { en: "Andorra" }, shortName: { en: "Andorra" }, color: "#123456",
          capitalRegionId: 1, economyType: "mixed",
          politics: {}, // нет ideology — обязательное поле
        }],
      });

      expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
      expect(() => buildScenario1946(dir)).toThrow(/countries\.json/);
    });

    it("падает с внятной ошибкой на неизвестном economyType", () => {
      const dir = makeTmpDir();
      writeFixture(dir, {
        countries: [{
          id: "AND", name: { en: "Andorra" }, shortName: { en: "Andorra" }, color: "#123456",
          capitalRegionId: 1, economyType: "communist", // не planned/mixed/market
          politics: { ideology: "Communism" },
        }],
      });

      expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
    });
  });

  /**
   * Фундамент недовольства (docs/CONCEPT.md §4.1/§4.2): три слоя поверх
   * основной разметки. Ключевое свойство — покрытие частичное по замыслу, и
   * «слоя нет» отличается от «слой испорчен».
   */
  describe("groups/demographics/ideology (срез, сессия A)", () => {
    const GROUPS = {
      groups: [
        { id: "andorrans", names: { en: "Andorrans", ru: "Андоррцы" }, desiredIdeology: { economic: 0.2, political: 0.6 } },
        { id: "french", names: { en: "French" }, desiredIdeology: { economic: 0.1, political: 0.7 } },
      ],
    };
    const COUNTRIES = [{
      id: "AND", name: { en: "Andorra" }, shortName: { en: "Andorra" }, color: "#123456",
      capitalRegionId: 1, economyType: "mixed", politics: { ideology: "Liberal Democracy" },
    }];

    function writeLayers(dir: string, layers: { groups?: unknown; demographics?: unknown; ideology?: unknown }): void {
      if (layers.groups !== undefined) {
        fs.writeFileSync(path.join(dir, "groups.json"), JSON.stringify(layers.groups));
      }
      if (layers.demographics !== undefined) {
        fs.writeFileSync(path.join(dir, "demographics.json"), JSON.stringify(layers.demographics));
      }
      if (layers.ideology !== undefined) {
        fs.writeFileSync(path.join(dir, "ideology.json"), JSON.stringify(layers.ideology));
      }
    }

    it("раскладывает демо-состав по регионам и координаты по странам", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });
      writeLayers(dir, {
        groups: GROUPS,
        demographics: { regions: [{ regionId: 1, groups: [{ groupId: "andorrans", share: 0.7 }, { groupId: "french", share: 0.3 }] }] },
        ideology: { countries: [{ countryId: "AND", economic: 0.15, political: 0.65 }] },
      });

      const scenario = buildScenario1946(dir);

      expect(scenario.ethnicGroups).toHaveLength(2);
      expect(scenario.regions.find(r => r.id === 1)!.demographics).toEqual([
        { groupId: "andorrans", share: 0.7 },
        { groupId: "french", share: 0.3 },
      ]);
      // Регион без записи остаётся неразмеченным — это штатное состояние.
      expect(scenario.regions.find(r => r.id === 2)!.demographics).toBeUndefined();
      expect(scenario.countries.find(c => c.id === "AND")!.politics.ideologyCoordinates)
        .toEqual({ economic: 0.15, political: 0.65 });
    });

    it("отсутствие всех трёх файлов — не ошибка (сценарии-заглушки без демо-состава)", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });

      const scenario = buildScenario1946(dir);

      expect(scenario.ethnicGroups).toEqual([]);
      expect(scenario.regions.every(r => r.demographics === undefined)).toBe(true);
    });

    it("демография без каталога групп — рассыпавшийся набор, честная ошибка", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });
      writeLayers(dir, { demographics: { regions: [] } });

      expect(() => buildScenario1946(dir)).toThrow(/groups\.json отсутствует/);
    });

    it("сумма долей региона обязана быть 1.0", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });
      writeLayers(dir, {
        groups: GROUPS,
        demographics: { regions: [{ regionId: 1, groups: [{ groupId: "andorrans", share: 0.5 }] }] },
      });

      expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
    });

    it("ссылка на несуществующую группу — ошибка, а не тихо мёртвая разметка", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });
      writeLayers(dir, {
        groups: GROUPS,
        demographics: { regions: [{ regionId: 1, groups: [{ groupId: "martians", share: 1 }] }] },
      });

      expect(() => buildScenario1946(dir)).toThrow(/неизвестную группу/);
    });

    it("ссылка на несуществующий регион/страну — ошибка", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });
      writeLayers(dir, {
        groups: GROUPS,
        demographics: { regions: [{ regionId: 4242, groups: [{ groupId: "andorrans", share: 1 }] }] },
      });
      expect(() => buildScenario1946(dir)).toThrow(/нет региона id=4242/);

      const dir2 = makeTmpDir();
      writeFixture(dir2, { countries: COUNTRIES });
      writeLayers(dir2, {
        groups: GROUPS,
        ideology: { countries: [{ countryId: "ZZZ", economic: 0, political: 0 }] },
      });
      expect(() => buildScenario1946(dir2)).toThrow(/нет страны id="ZZZ"/);
    });

    it("координата вне диапазона [-1, 1] не проходит схему", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: COUNTRIES });
      writeLayers(dir, {
        groups: GROUPS,
        ideology: { countries: [{ countryId: "AND", economic: 1.5, political: 0 }] },
      });

      expect(() => buildScenario1946(dir)).toThrow(/ideology\.json/);
    });
  });

  /**
   * Стартовый дипломатический слой (`diplomacy.json`, docs/DIPLOMACY.md).
   *
   * Тесты идут на фикстурах, а не на боевых данных, и это не временная мера:
   * самого файла в сценарии 1946 ещё нет — его наполняет отдельная работа.
   * Поэтому «файла нет» здесь не крайний случай, а текущий штатный путь, и он
   * покрыт наравне с остальными.
   *
   * Пороги шкалы берутся из `shared/src/defines/diplomacy.ts`: зашитое число
   * пережило бы рекалибровку шкалы молча и перестало бы проверять границу.
   */
  describe("diplomacy.json (стартовый дипломатический слой)", () => {
    const DIPLO_COUNTRIES = ["AAA", "BBB", "CCC"].map((id, index) => ({
      id,
      name: { en: id },
      shortName: { en: id },
      color: `#00000${index + 1}`,
      capitalRegionId: 1,
      economyType: "mixed",
      politics: { ideology: "Liberal Democracy" },
    }));

    function writeDiplomacy(dir: string, diplomacy: unknown): void {
      fs.writeFileSync(path.join(dir, "diplomacy.json"), JSON.stringify(diplomacy));
    }

    function loadWith(diplomacy: unknown) {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: DIPLO_COUNTRIES });
      writeDiplomacy(dir, diplomacy);
      return () => buildScenario1946(dir);
    }

    function countryOf(scenario: ReturnType<typeof buildScenario1946>, id: string) {
      return scenario.countries.find(c => c.id === id)!;
    }

    it("отсутствие файла — штатный путь, а не ошибка (данных слоя ещё нет)", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: DIPLO_COUNTRIES });

      const scenario = buildScenario1946(dir);

      expect(scenario.countries).toHaveLength(DIPLO_COUNTRIES.length);
      expect(scenario.countries.every(c =>
        Object.keys(c.diplomacy.relations).length === 0 &&
        c.diplomacy.allies.length === 0 &&
        c.diplomacy.rivals.length === 0 &&
        c.diplomacy.guarantees.length === 0
      )).toBe(true);
    });

    it("одна запись пары кладёт отношения ОБЕИМ сторонам", () => {
      const scenario = loadWith({
        relations: [{ pair: ["AAA", "BBB"], value: 72 }],
      })();

      expect(countryOf(scenario, "AAA").diplomacy.relations["BBB"]).toBe(72);
      expect(countryOf(scenario, "BBB").diplomacy.relations["AAA"]).toBe(72);
      // Третья страна связи не получает: слой разреженный.
      expect(countryOf(scenario, "CCC").diplomacy.relations).toEqual({});
    });

    it("порядок кодов в паре не значим — связь та же самая", () => {
      const direct = loadWith({ relations: [{ pair: ["AAA", "BBB"], value: -40 }] })();
      const reversed = loadWith({ relations: [{ pair: ["BBB", "AAA"], value: -40 }] })();

      for (const scenario of [direct, reversed]) {
        expect(countryOf(scenario, "AAA").diplomacy.relations["BBB"]).toBe(-40);
        expect(countryOf(scenario, "BBB").diplomacy.relations["AAA"]).toBe(-40);
      }
    });

    it("союз и соперничество попадают в списки обеих сторон", () => {
      const scenario = loadWith({
        alliances: [{ pair: ["AAA", "BBB"] }],
        rivalries: [{ pair: ["AAA", "CCC"] }],
      })();

      expect(countryOf(scenario, "AAA").diplomacy.allies).toEqual(["BBB"]);
      expect(countryOf(scenario, "BBB").diplomacy.allies).toEqual(["AAA"]);
      expect(countryOf(scenario, "AAA").diplomacy.rivals).toEqual(["CCC"]);
      expect(countryOf(scenario, "CCC").diplomacy.rivals).toEqual(["AAA"]);
    });

    it("гарантия направленная: пишется гаранту и НЕ пишется защищаемому", () => {
      const scenario = loadWith({
        guarantees: [{ guarantor: "AAA", protected: "BBB" }],
      })();

      expect(countryOf(scenario, "AAA").diplomacy.guarantees).toEqual(["BBB"]);
      expect(countryOf(scenario, "BBB").diplomacy.guarantees).toEqual([]);
    });

    it("договор и политика независимы: союз при холодных отношениях грузится как есть", () => {
      // Англо-советский договор 1942 жил до 1955-го, а отношения к 1946 уже
      // портились. Загрузчик не вправе «поправить» такие данные: распад союза —
      // дело DiplomacyTick, а не загрузки.
      const scenario = loadWith({
        relations: [{ pair: ["AAA", "BBB"], value: 5 }],
        alliances: [{ pair: ["AAA", "BBB"] }],
      })();

      expect(countryOf(scenario, "AAA").diplomacy.allies).toEqual(["BBB"]);
      expect(countryOf(scenario, "AAA").diplomacy.relations["BBB"]).toBe(5);
    });

    it("ссылка на несуществующую страну — ошибка с названием этой страны", () => {
      for (const [layer, payload] of [
        ["relations", { relations: [{ pair: ["AAA", "ZZZ"], value: 10 }] }],
        ["alliances", { alliances: [{ pair: ["AAA", "ZZZ"] }] }],
        ["rivalries", { rivalries: [{ pair: ["AAA", "ZZZ"] }] }],
        ["guarantees", { guarantees: [{ guarantor: "AAA", protected: "ZZZ" }] }],
        ["guarantees", { guarantees: [{ guarantor: "ZZZ", protected: "AAA" }] }],
      ] as const) {
        const load = loadWith(payload);
        expect(load, layer).toThrow(ScenarioDataError);
        expect(load, layer).toThrow(/несуществующую страну "ZZZ"/);
      }
    });

    it("самопара отвергается во всех списках", () => {
      for (const payload of [
        { relations: [{ pair: ["AAA", "AAA"], value: 10 }] },
        { alliances: [{ pair: ["AAA", "AAA"] }] },
        { rivalries: [{ pair: ["AAA", "AAA"] }] },
      ]) {
        expect(loadWith(payload)).toThrow(/сама с собой/);
      }
      expect(loadWith({ guarantees: [{ guarantor: "AAA", protected: "AAA" }] }))
        .toThrow(/гарантирует сама себе/);
    });

    it("дубль пары отвергается в ЛЮБОМ порядке кодов", () => {
      expect(loadWith({
        relations: [{ pair: ["AAA", "BBB"], value: 10 }, { pair: ["BBB", "AAA"], value: 60 }],
      })).toThrow(/встречается дважды/);

      expect(loadWith({
        alliances: [{ pair: ["AAA", "BBB"] }, { pair: ["BBB", "AAA"] }],
      })).toThrow(/встречается дважды/);

      expect(loadWith({
        guarantees: [
          { guarantor: "AAA", protected: "BBB" },
          { guarantor: "AAA", protected: "BBB" },
        ],
      })).toThrow(/встречается дважды/);
    });

    it("значение вне шкалы отношений отвергается с обеих границ", () => {
      expect(loadWith({ relations: [{ pair: ["AAA", "BBB"], value: RELATION_SCALE_MAX + 1 }] }))
        .toThrow(ScenarioDataError);
      expect(loadWith({ relations: [{ pair: ["AAA", "BBB"], value: RELATION_SCALE_MIN - 1 }] }))
        .toThrow(ScenarioDataError);

      // Сами границы — валидные значения, а не запрещённые.
      const edge = loadWith({
        relations: [
          { pair: ["AAA", "BBB"], value: RELATION_SCALE_MAX },
          { pair: ["AAA", "CCC"], value: RELATION_SCALE_MIN },
        ],
      })();
      expect(countryOf(edge, "AAA").diplomacy.relations["BBB"]).toBe(RELATION_SCALE_MAX);
      expect(countryOf(edge, "AAA").diplomacy.relations["CCC"]).toBe(RELATION_SCALE_MIN);
    });

    it("пара одновременно в alliances и rivalries отвергается", () => {
      // Иначе загрузка построила бы страну, у которой один и тот же сосед
      // разом в allies и в rivals.
      expect(loadWith({
        alliances: [{ pair: ["AAA", "BBB"] }],
        rivalries: [{ pair: ["BBB", "AAA"] }],
      })).toThrow(/одновременно в alliances и rivalries/);
    });

    it("битый JSON и несовпадение формы падают как ScenarioDataError", () => {
      const dir = makeTmpDir();
      writeFixture(dir, { countries: DIPLO_COUNTRIES });
      fs.writeFileSync(path.join(dir, "diplomacy.json"), "{ not json");
      expect(() => buildScenario1946(dir)).toThrow(ScenarioDataError);
      expect(() => buildScenario1946(dir)).toThrow(/diplomacy\.json/);

      // Пара из одного кода — не пара.
      expect(loadWith({ alliances: [{ pair: ["AAA"] }] })).toThrow(/diplomacy\.json/);
    });
  });
});
