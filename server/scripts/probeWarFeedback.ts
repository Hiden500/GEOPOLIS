/**
 * Есть ли у войны обратная связь — замер на живом сценарии 1946.
 *
 * ЗАЧЕМ. `docs/TODO.md` (P1) утверждает две вещи, ни одна из которых не
 * проверена числами: (1) потери, списанные `WarTick` с `activePersonnel`,
 * затираются `MilitaryTick`, который пересчитывает то же поле из `manpower`
 * раньше в том же месяце, а сам `manpower` растёт быстрее потерь — обе стороны
 * затяжной войны становятся СИЛЬНЕЕ; (2) войну не завершает ни один тик, только
 * глагол `peace` от LLM/игрока. Скрипт объявляет войну примитивом `war` и гонит
 * партию, печатая помесячную траекторию живой силы, населения фронта, фронта и
 * счёта войны. Утверждение backlog становится либо подтверждённым числом, либо
 * опровергнутым.
 *
 * Контрольный прогон (--control) — та же пара стран без войны: без него рост
 * manpower у воюющей стороны не с чем сравнить, и «армия выросла» ничего не
 * доказывает.
 *
 * Запуск:  npx tsx scripts/probeWarFeedback.ts [--months 120] [--attacker FRA] [--defender ITA]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { applyPrimitiveBatch } from "../src/primitives/PrimitiveEngine";
import { computeWarScore } from "../src/simulation/war/warScore";
import { effectiveController } from "@shared/utils/regionControl";
import { ACTIVE_PERSONNEL_SHARE } from "@shared/defines/military";
import { type GameState } from "@shared/types/GameState";
import { type War } from "@shared/types/War";

function argValue(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  return argv[i + 1]!;
}

function parseMonths(): number {
  const parsed = Number.parseInt(argValue("months", "120"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("ru-RU") : "n/a";
}

interface SideSnapshot {
  manpower: number;
  active: number;
  casualties: number;
  population: number;
  frontRegions: number;
  heldRegions: number;
  ownedRegions: number;
}

/** Число контактных (фронтовых) регионов стороны — та же геометрия, что в WarTick. */
function frontRegionCount(game: GameState, side: Set<string>, other: Set<string>): number {
  const regionById = new Map(game.regions.map(r => [r.id, r]));
  let count = 0;
  for (const region of game.regions) {
    if (!side.has(effectiveController(region))) continue;
    const contact = region.landNeighboringRegionIds
      .map(id => regionById.get(id))
      .some(n => !!n && other.has(effectiveController(n)));
    if (contact) count += 1;
  }
  return count;
}

function snapshotSide(game: GameState, war: War, ids: string[], otherIds: string[]): SideSnapshot {
  const set = new Set(ids);
  const otherSet = new Set(otherIds);
  const countries = game.countries.filter(c => set.has(c.id));
  const held = game.regions.filter(r => set.has(effectiveController(r)));

  return {
    manpower: countries.reduce((s, c) => s + c.military.manpower, 0),
    active: countries.reduce((s, c) => s + c.military.activePersonnel, 0),
    casualties: ids.reduce((s, id) => s + (war.casualties[id] ?? 0), 0),
    population: held.reduce((s, r) => s + r.population, 0),
    frontRegions: frontRegionCount(game, set, otherSet),
    heldRegions: held.length,
    ownedRegions: game.regions.filter(r => set.has(r.ownerCountryId)).length,
  };
}

function printSide(label: string, s: SideSnapshot): void {
  console.log(
    `  ${label.padEnd(10)} manpower ${fmt(s.manpower).padStart(12)} | active ${fmt(s.active).padStart(11)} | ` +
    `потери ${fmt(s.casualties).padStart(12)} | население ${fmt(s.population).padStart(13)} | ` +
    `фронт ${String(s.frontRegions).padStart(3)} | контроль ${String(s.heldRegions).padStart(4)}/${s.ownedRegions}`
  );
}

function report(game: GameState, war: War, label: string): void {
  const attackers = snapshotSide(game, war, war.attackers, war.defenders);
  const defenders = snapshotSide(game, war, war.defenders, war.attackers);
  const activeWars = game.wars.filter(w => w.active).length;

  console.log(`\n--- ${label} (дата ${game.currentDate}) ---`);
  printSide("атакующие", attackers);
  printSide("оборона", defenders);
  // Инициаторы отдельно от коалиционных сумм: цена войны видна только по одной
  // стране — сумма по коалиции смешивает воюющих с непричастными.
  //
  // «потолок» = manpower × доля, то есть армия, которую пул позволяет держать.
  // Равенство армии потолку означает, что поле чисто производное и потери в нём
  // не живут (поведение до 2026-07-31). Разрыв сам по себе цену войны НЕ
  // доказывает: после правки армия отстаёт от растущего потолка и в мирное
  // время — цену показывает только сравнение с контрольным прогоном ниже.
  for (const [role, id] of [["атакующий", war.attackers[0]!], ["обороняющийся", war.defenders[0]!]] as const) {
    const c = game.countries.find(x => x.id === id)!;
    const ceiling = Math.floor(c.military.manpower * ACTIVE_PERSONNEL_SHARE);
    console.log(
      `  ${role} ${id}: manpower ${fmt(c.military.manpower)}, active ${fmt(c.military.activePersonnel)}` +
      ` (потолок ${fmt(ceiling)}${c.military.activePersonnel === ceiling ? ", армия = потолок" : ""})`
    );
  }

  console.log(
    `  флипы: →атакующим ${war.territoryFlips.toAttackers}, →обороне ${war.territoryFlips.toDefenders}` +
    ` | warScore ${computeWarScore(war).toFixed(1)}` +
    ` | война активна: ${war.active ? "да" : "НЕТ"} | активных войн в мире: ${activeWars}`
  );
}

function main(): void {
  const months = parseMonths();
  const attackerId = argValue("attacker", "FRA");
  const defenderId = argValue("defender", "ITA");
  const control = process.argv.includes("--control");

  const game = createGame("1946", "USA");

  const batch = applyPrimitiveBatch(
    game,
    [{ verb: "war", sourceCountryId: attackerId, target: { countryId: defenderId } }],
    "player"
  );
  if (batch.applied.length === 0) {
    console.error("примитив war отклонён:", JSON.stringify(batch.rejected, null, 2));
    process.exit(1);
  }

  const war = game.wars.find(w => w.active)!;
  console.log(
    `Война ${war.id}: атакующие [${war.attackers.join(", ")}] против [${war.defenders.join(", ")}]` +
    `, старт ${war.startDate}, горизонт ${months} мес.`
  );

  report(game, war, "месяц 0 (до первого тика)");

  const traceMonths = Number.parseInt(argValue("trace", "0"), 10);
  if (traceMonths > 0) {
    console.log(
      `\n=== помесячная трасса, ${attackerId} (атакующий) ===\n` +
      "  мес | manpower | active | manpower×доля | потери за мес | флипы за мес"
    );
  }

  const checkpoints = new Set([1, 6, 12, 24, 60, months].filter(m => m <= months));
  let casualtiesBefore = war.casualties[attackerId] ?? 0;
  let flipsBefore = war.territoryFlips.toAttackers + war.territoryFlips.toDefenders;

  for (let month = 1; month <= months; month++) {
    simulateMonth(game);

    if (month <= traceMonths) {
      const country = game.countries.find(c => c.id === attackerId)!;
      const casualties = (war.casualties[attackerId] ?? 0) - casualtiesBefore;
      const flips = war.territoryFlips.toAttackers + war.territoryFlips.toDefenders - flipsBefore;
      // «manpower×доля» — то, чему activePersonnel равнялся бы, если бы его
      // просто пересчитали из manpower. Совпадение при НЕНУЛЕВЫХ потерях месяца
      // и означает, что списание потерь до activePersonnel не доехало.
      console.log(
        `  ${String(month).padStart(3)} | ${fmt(country.military.manpower).padStart(9)} | ` +
        `${fmt(country.military.activePersonnel).padStart(9)} | ` +
        `${fmt(Math.floor(country.military.manpower * ACTIVE_PERSONNEL_SHARE)).padStart(9)} | ` +
        `${fmt(casualties).padStart(9)} | ${String(flips).padStart(3)}`
      );
    }
    casualtiesBefore = war.casualties[attackerId] ?? 0;
    flipsBefore = war.territoryFlips.toAttackers + war.territoryFlips.toDefenders;

    if (checkpoints.has(month)) report(game, war, `месяц ${month}`);
  }

  if (control) {
    // Тот же мир, тот же горизонт, БЕЗ примитива war. Единственный способ
    // назвать цену войны числом: абсолютный рост армии за 10 лет ничего не
    // говорит, пока не с чем сравнить.
    const peace = createGame("1946", "USA");
    for (let month = 0; month < months; month++) simulateMonth(peace);

    console.log(`\n=== цена войны: прогон с войной против того же мира без неё, ${months} мес. ===`);
    for (const id of [attackerId, defenderId]) {
      const atWar = game.countries.find(x => x.id === id)!.military;
      const atPeace = peace.countries.find(x => x.id === id)!.military;
      const ratio = (a: number, b: number) => (b > 0 ? `${((a / b - 1) * 100).toFixed(1)}%` : "n/a");
      console.log(
        `  ${id}: manpower ${fmt(atWar.manpower)} против ${fmt(atPeace.manpower)} (${ratio(atWar.manpower, atPeace.manpower)}), ` +
        `армия ${fmt(atWar.activePersonnel)} против ${fmt(atPeace.activePersonnel)} (${ratio(atWar.activePersonnel, atPeace.activePersonnel)})`
      );
    }
  }
}

main();
