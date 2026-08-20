import { describe, it, expect } from "vitest";
import { warTick } from "./WarTick";
import { createTestGameState, createTestCountry, createTestRegion } from "../../test-utils/fixtures";
import { type War } from "@shared/types/War";
import { TIER_PROGRESS_THRESHOLD } from "@shared/utils/technology";

function makeWar(overrides: Partial<War> = {}): War {
  return {
    id: "war-1",
    attackers: ["USA"],
    defenders: ["USSR"],
    supporters: [],
    startDate: "1946-01-01",
    active: true,
    territoryFlips: { toAttackers: 0, toDefenders: 0 },
    casualties: {},
    ...overrides,
  };
}

describe("warTick", () => {
  it("ничего не делает без контактных границ (регионы не соседи)", () => {
    const game = createTestGameState({
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 0 });
    expect(game.regions[0]!.ownerCountryId).toBe("USA");
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[0]!.occupiedBy).toBeUndefined();
    expect(game.regions[1]!.occupiedBy).toBeUndefined();
    expect(game.mapFeatures).toHaveLength(0);
  });

  it("при равной силе на контакте — фронт стоит, но battalion размещается", () => {
    const game = createTestGameState({
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })], // activePersonnel равны (фикстура)
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 0 });
    expect(game.regions[0]!.ownerCountryId).toBe("USA");
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[0]!.occupiedBy).toBeUndefined();
    expect(game.regions[1]!.occupiedBy).toBeUndefined();
    expect(game.mapFeatures.filter(f => f.type === "battalion")).toHaveLength(2);
  });

  it("решающий перевес атакующих — регион обороны флипается к атакующим", () => {
    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
        createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    // Флип двигает только оккупацию — легальное владение (ownerCountryId) не меняется.
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.occupiedBy).toBe("USA");
    expect(game.regions[0]!.ownerCountryId).toBe("USA"); // не откатился — сам не был под угрозой
    expect(game.regions[0]!.occupiedBy).toBeUndefined();
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 1, toDefenders: 0 });
  });

  it("решающий перевес обороны — регион атакующих флипается к обороне", () => {
    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
        createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    expect(game.regions[0]!.ownerCountryId).toBe("USA");
    expect(game.regions[0]!.occupiedBy).toBe("USSR");
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.occupiedBy).toBeUndefined();
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 0, toDefenders: 1 });
  });

  it("combined-arms бонус может решить исход при равной численности (2026-07-06)", () => {
    const strongArms = {
      armor: TIER_PROGRESS_THRESHOLD * 20,
      infantry: TIER_PROGRESS_THRESHOLD * 20,
      aviation: TIER_PROGRESS_THRESHOLD * 20,
      naval: TIER_PROGRESS_THRESHOLD * 20,
    }; // тир 20 в каждом военном домене → мультипликатор 2.0 (1 + 20*0.05)

    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", technology: { domains: strongArms } }),
        createTestCountry({ id: "USSR" }), // домены пустые — мультипликатор 1
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    // При равном activePersonnel (фикстура) перевес даёт один combined-arms
    // бонус. Требуемая величина выросла 2026-07-31 вместе с переходом на
    // локальную боевую мощь: обороняющийся регион добавляет к защите свою
    // инфраструктуру (REGION_DEFENSE_INFRASTRUCTURE_WEIGHT), поэтому порога
    // 1.5x стало мало — при infrastructure 0.6 фикстуры нужен перевес
    // 1.5 × (1 + 0.6 × 0.5) = 1.95x. Тир поднят с 11 до 20 именно поэтому:
    // свойство «техническое превосходство решает исход» осталось прежним,
    // изменилась только цена входа.
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.occupiedBy).toBe("USA");
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 1, toDefenders: 0 });
  });

  it("экипировка (War Phase 2) может решить исход при равной activePersonnel (2026-07-06)", () => {
    const equippedCountry = createTestCountry({
      id: "USA",
      military: {
        ...createTestCountry().military,
        equipment: { ...createTestCountry().military.equipment, tanks: 1000 },
      },
    });

    const game = createTestGameState({
      countries: [
        equippedCountry,
        createTestCountry({ id: "USSR" }), // экипировка по нулям (фикстура)
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);

    // 1000 танков × EQUIPMENT_STRENGTH_WEIGHT=500 = 500 000 доп. силы — при
    // равном activePersonnel (500 000 у обеих сторон, фикстура) это удваивает
    // силу США, превышая FLIP_THRESHOLD_RATIO=1.5.
    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.occupiedBy).toBe("USA");
    expect(game.wars[0]!.territoryFlips).toEqual({ toAttackers: 1, toDefenders: 0 });
  });

  it("игнорирует неактивные войны", () => {
    const game = createTestGameState({
      countries: [
        createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
        createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
      ],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar({ active: false })],
    });

    warTick(game);

    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.occupiedBy).toBeUndefined();
    expect(game.mapFeatures).toHaveLength(0);
  });

  it("освобождение: легальный владелец отбивает оккупированный регион через цепочку фронта — occupiedBy и модификатор снимаются", () => {
    // Цепочка USA(1)-USSR(2)-USSR(3): после первого флипа регион 2 оккупирован
    // USA, новый фронт — между регионом 2 (под USA) и регионом 3 (свой для
    // USSR) — оттуда USSR и отбивает регион 2 обратно.
    const usa = createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } });
    const ussr = createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 500_000 } });
    const game = createTestGameState({
      countries: [usa, ussr],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1, 3] }),
        createTestRegion({ id: 3, ownerCountryId: "USSR", landNeighboringRegionIds: [2] }),
      ],
      wars: [makeWar()],
    });

    warTick(game); // USA оккупирует регион 2
    expect(game.regions[1]!.occupiedBy).toBe("USA");
    expect(game.modifiers).toHaveLength(1);

    // USSR мобилизуется и отбивает регион — новый контроллёр региона 2
    // (эффективный контроль региона 3) совпадает с легальным владельцем
    // региона 2 (USSR), оккупация должна сняться, не смениться.
    usa.military.activePersonnel = 100_000;
    ussr.military.activePersonnel = 10_000_000;
    warTick(game);

    expect(game.regions[1]!.ownerCountryId).toBe("USSR");
    expect(game.regions[1]!.occupiedBy).toBeUndefined();
    expect(game.modifiers).toHaveLength(0);
  });

  it("не дублирует battalion на повторном вызове без изменения фронта", () => {
    const game = createTestGameState({
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
      regions: [
        createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
        createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
      ],
      wars: [makeWar()],
    });

    warTick(game);
    warTick(game);

    expect(game.mapFeatures.filter(f => f.type === "battalion")).toHaveLength(2);
  });

  describe("потери → демография (план 08, Шаг 3)", () => {
    it("равная сила, 2 фронтовых региона: каждая сторона теряет базу × 2 × 0.5 = 10 000 с activePersonnel", () => {
      const game = createTestGameState({
        countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
        regions: [
          createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
          createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
        ],
        wars: [makeWar()],
      });

      warTick(game);

      // totalFront=2, доля=0.5 → 10 000/сторона. activePersonnel 500 000 хватает
      // покрыть целиком — гражданских потерь нет.
      const usa = game.countries[0]!;
      const ussr = game.countries[1]!;
      expect(usa.military.activePersonnel).toBe(490_000);
      expect(ussr.military.activePersonnel).toBe(490_000);
      expect(usa.military.manpower).toBe(990_000);
      expect(ussr.military.manpower).toBe(990_000);
      expect(game.regions[0]!.population).toBe(1_000_000); // гражданские не тронуты
      expect(game.regions[1]!.population).toBe(1_000_000);
      expect(game.wars[0]!.casualties).toEqual({ USA: 10_000, USSR: 10_000 });
    });

    it("без контакта (регионы не соседи) потерь нет", () => {
      const game = createTestGameState({
        countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
        regions: [
          createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [] }),
          createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [] }),
        ],
        wars: [makeWar()],
      });

      warTick(game);

      expect(game.countries[0]!.military.activePersonnel).toBe(500_000);
      expect(game.countries[1]!.military.activePersonnel).toBe(500_000);
      expect(game.wars[0]!.casualties).toEqual({});
    });

    it("слабейшая сторона теряет больше (доля силы противника)", () => {
      const game = createTestGameState({
        countries: [
          createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000_000 } }),
          createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 500_000 } }),
        ],
        regions: [
          createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
          createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
        ],
        wars: [makeWar()],
      });

      warTick(game);

      // Слабый USSR (сила ~1/11 суммы) несёт бо́льшую долю потерь, чем сильный USA.
      const casualties = game.wars[0]!.casualties;
      expect(casualties.USSR!).toBeGreaterThan(casualties.USA!);
    });

    it("переполнение сверх activePersonnel уходит в население фронтовых регионов и manpower", () => {
      const game = createTestGameState({
        countries: [
          createTestCountry({ id: "USA", military: { ...createTestCountry().military, activePersonnel: 5_000 } }),
          createTestCountry({ id: "USSR", military: { ...createTestCountry().military, activePersonnel: 5_000 } }),
        ],
        regions: [
          createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
          createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
        ],
        wars: [makeWar()],
      });

      warTick(game);

      // Равная (крошечная) сила → фронт стоит, 10 000 потерь/сторона.
      //
      // ЧИСЛА ПЕРЕСЧИТАНЫ 2026-07-31 вместе с потолком убыли армии
      // (MAX_MONTHLY_ARMY_LOSS_SHARE): за месяц армия теряет не больше своей
      // доли — 15% от 5 000 = 750, — а ВЕСЬ остальной урон по-прежнему уходит
      // в гражданских и мобилизационный пул. Проверяемое свойство то же самое:
      // война не ограничивается кадровыми потерями и достаёт до населения.
      const usa = game.countries[0]!;
      expect(usa.military.activePersonnel).toBe(4_250);      // 5 000 − 750
      // Весь overflow страны идёт в её собственный регион — каждая сторона
      // контролирует ровно один, делить не на кого.
      expect(game.regions[0]!.population).toBe(990_750);      // 1 000 000 − 9 250
      expect(game.regions[1]!.population).toBe(990_750);
      expect(usa.military.manpower).toBe(990_000);            // весь урон 10 000 из пула
      expect(game.wars[0]!.casualties).toEqual({ USA: 10_000, USSR: 10_000 });
    });

    it("неактивная война потерь не наносит", () => {
      const game = createTestGameState({
        countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "USSR" })],
        regions: [
          createTestRegion({ id: 1, ownerCountryId: "USA", landNeighboringRegionIds: [2] }),
          createTestRegion({ id: 2, ownerCountryId: "USSR", landNeighboringRegionIds: [1] }),
        ],
        wars: [makeWar({ active: false })],
      });

      warTick(game);

      expect(game.countries[0]!.military.activePersonnel).toBe(500_000);
      expect(game.wars[0]!.casualties).toEqual({});
    });
  });
});
