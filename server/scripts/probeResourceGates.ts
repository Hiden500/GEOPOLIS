/**
 * Три заявления аудита формул о ресурсах и торговле — на живых данных 1946.
 *
 * ЗАЧЕМ. `.agent/audits/formula-audit-2026-07-30.md` (P2) утверждает:
 *   1. `build_extraction` — гарантированный no-op на всех 2055 записях;
 *   2. гейта сырья не существует (у `stockpile` нет ни одного потребителя);
 *   3. эмбарго уничтожает товар (списание идёт до применения штрафа).
 * Скрипт меряет каждое на реальном сценарии, а не на фикстуре: подобранная
 * фикстура доказывает, что функция считает, но не что её вход живой.
 *
 * Запуск:  npx tsx scripts/probeResourceGates.ts [--months 24]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { tradeTick } from "../src/simulation/trade/TradeTick";
import { economyTick } from "../src/simulation/economy/EconomyTick";
import { resourceTick } from "../src/simulation/resources/ResourceTick";
import { equipmentResourceCoverage } from "../src/simulation/military/MilitaryTick";
import {
  WAR_MATERIAL_RESOURCE_IDS,
  EQUIPMENT_RESOURCE_DEMAND_SCALE,
} from "@shared/defines/military";
import { buildExtraction } from "../src/commands/resources";
import { type GameState } from "@shared/types/GameState";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import { effectiveController } from "@shared/utils/regionControl";
import { MAX_EXTRACTION_LEVEL, EXTRACTION_BUILD_COST } from "@shared/defines/resources";
import { DOMESTIC_RESERVE_PER_CAPITA, EXPORT_RATE } from "@shared/defines/trade";
import { RESOURCE_IDS, RESOURCE_CATALOG } from "@shared/data/resources/resourceCatalog";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 24;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

/** Заявление 1: может ли build_extraction(+1) вообще что-то изменить. */
function probeBuildExtraction(game: GameState): void {
  console.log("\n=== 1. build_extraction — есть ли записи, где +1 даёт эффект ===");

  const levels = new Map<number, number>();
  let depositPairs = 0;
  let extractionEntries = 0;
  let depositWithoutEntry = 0;
  let belowMax = 0;
  const belowMaxSamples: string[] = [];

  for (const region of game.regions) {
    for (const [resource, richness] of Object.entries(region.deposits)) {
      if (!richness) continue;
      depositPairs++;
      const raw = region.extraction[resource as ResourceType];
      if (raw === undefined) depositWithoutEntry++;
      const level = raw ?? 0;
      levels.set(level, (levels.get(level) ?? 0) + 1);
      if (level < MAX_EXTRACTION_LEVEL) {
        belowMax++;
        if (belowMaxSamples.length < 5) {
          belowMaxSamples.push(`регион ${region.id} / ${resource}: уровень ${level}`);
        }
      }
    }
  }

  for (const region of game.regions) {
    extractionEntries += Object.values(region.extraction).filter(v => v !== undefined).length;
  }

  console.log(`регионов: ${game.regions.length}, записей extraction: ${extractionEntries}, ` +
    `пар (регион, ресурс) с депозитом: ${depositPairs}`);
  console.log(`распределение уровней добычи по парам с депозитом: ` +
    [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([l, n]) => `${l}→${n}`).join(", "));
  console.log(`депозит без записи extraction: ${depositWithoutEntry}`);
  console.log(`пар с уровнем НИЖЕ MAX_EXTRACTION_LEVEL=${MAX_EXTRACTION_LEVEL}: ${belowMax}`);
  belowMaxSamples.forEach(s => console.log(`  ${s}`));

  // Прямой прогон команды: сколько ПАР реально меняют состояние при delta=+1
  // (не «сколько теоретически могло бы»). Клон, чтобы не портить партию.
  const probe = structuredClone(game) as GameState;
  let changed = 0;
  let refusedNoTreasury = 0;
  let successNoChange = 0;
  for (const region of probe.regions) {
    const controller = effectiveController(region);
    const country = probe.countries.find(c => c.id === controller);
    if (!country) continue;
    for (const [resource, richness] of Object.entries(region.deposits)) {
      if (!richness) continue;
      const before = region.extraction[resource as ResourceType] ?? 0;
      const treasuryBefore = country.economy.treasury;
      country.economy.treasury = Number.MAX_SAFE_INTEGER; // отделяем «нет денег» от «нечего строить»
      const result = buildExtraction(probe, country.id, region.id, resource as ResourceType, 1);
      const after = region.extraction[resource as ResourceType] ?? 0;
      country.economy.treasury = treasuryBefore;
      if (after !== before) changed++;
      else if (result.success) successNoChange++;
      else refusedNoTreasury++;
    }
  }
  console.log(`прогон buildExtraction(+1) по всем парам (казна не ограничивает): ` +
    `изменили состояние ${changed}, вернули success без изменения ${successNoChange}, ` +
    `отказ ${refusedNoTreasury}`);

  const canAfford = game.countries.filter(c => c.economy.treasury >= EXTRACTION_BUILD_COST).length;
  console.log(`стран, чья казна покрывает EXTRACTION_BUILD_COST=${EXTRACTION_BUILD_COST.toExponential(1)}: ` +
    `${canAfford} из ${game.countries.length}`);
}

/** Заявление 2: у stockpile нет потребителя — обнуление ничего не меняет. */
function probeStockpileGate(months: number): void {
  console.log("\n=== 2. Гейт сырья — влияет ли запас хоть на что-нибудь ===");

  const baseline = createGame("1946", "USA");
  for (let i = 0; i < months; i++) simulateMonth(baseline);

  // Контрфакт: та же партия, но запас страны обнуляется КАЖДЫЙ тик (страна
  // без единого грамма сырья). Если гейт существует, производство/ВВП/армия
  // обязаны разойтись с baseline.
  const starved = createGame("1946", "USA");
  for (let i = 0; i < months; i++) {
    simulateMonth(starved);
    for (const country of starved.countries) {
      for (const resourceId of RESOURCE_IDS) country.stockpile[resourceId] = 0;
    }
  }

  const cmp = (label: string, pick: (g: GameState) => number) => {
    const a = pick(baseline);
    const b = pick(starved);
    const delta = a === 0 ? Number.NaN : (b - a) / a;
    console.log(`  ${label}: baseline ${fmt(a, 1)}, мир без запасов ${fmt(b, 1)}, ` +
      `расхождение ${Number.isFinite(delta) ? fmt(delta * 100, 2) + "%" : "n/a"}`);
  };

  const totalGdp = (g: GameState) => g.countries.reduce((s, c) => s + c.economy.gdp, 0);
  const totalArmy = (g: GameState) => g.countries.reduce((s, c) => s + c.military.activePersonnel, 0);
  const totalEquip = (g: GameState) =>
    g.countries.reduce((s, c) => s + Object.values(c.military.equipment).reduce((x, y) => x + (y as number), 0), 0);
  const totalPop = (g: GameState) => g.countries.reduce((s, c) => s + c.population, 0);

  console.log(`через ${months} месяцев (страна лишена ВСЕГО сырья каждый тик):`);
  cmp("мировой ВВП", totalGdp);
  cmp("активная армия", totalArmy);
  cmp("снаряжение", totalEquip);
  cmp("население", totalPop);

  // Что вообще накапливается: отношение запаса к внутреннему резерву.
  const ratios: number[] = [];
  let aboveReserve = 0;
  let belowReserve = 0;
  for (const country of baseline.countries) {
    const reserve = country.population * DOMESTIC_RESERVE_PER_CAPITA;
    if (reserve <= 0) continue;
    for (const resourceId of RESOURCE_IDS) {
      const stock = country.stockpile[resourceId] ?? 0;
      ratios.push(stock / reserve);
      if (stock >= reserve) aboveReserve++;
      else belowReserve++;
    }
  }
  console.log(`пар (страна, ресурс) через ${months} мес: выше резерва ${aboveReserve}, ` +
    `ниже ${belowReserve}; медиана stock/резерв ${fmt(median(ratios))}`);
}

/** Заявление 3: эмбарго списывает груз со склада и не даёт за него дохода. */
function probeEmbargoDestruction(): void {
  console.log("\n=== 3. Эмбарго — исчезает ли непроданный товар ===");

  const game = createGame("1946", "USA");
  for (let i = 0; i < 12; i++) simulateMonth(game);

  // Экспортёр с наибольшим излишком — на нём эффект виден крупнее всего.
  const currentYear = Number(game.currentDate.split("-")[0]);
  const activeResources = RESOURCE_IDS.filter(r => RESOURCE_CATALOG[r].eraIntroduced <= currentYear);
  const surplusOf = (countryId: string): number => {
    const country = game.countries.find(c => c.id === countryId)!;
    const reserve = country.population * DOMESTIC_RESERVE_PER_CAPITA;
    return activeResources.reduce((sum, r) => sum + Math.max(0, (country.stockpile[r] ?? 0) - reserve), 0);
  };
  const victim = [...game.countries].sort((a, b) => surplusOf(b.id) - surplusOf(a.id))[0]!;

  const runOnce = (embargoes: number) => {
    const probe = structuredClone(game) as GameState;
    const target = probe.countries.find(c => c.id === victim.id)!;
    const embargoers = probe.countries.filter(c => c.id !== target.id).slice(0, embargoes);
    for (const e of embargoers) e.diplomacy.sanctions[target.id] = ["trade_embargo"];

    const before = activeResources.map(r => target.stockpile[r] ?? 0);
    tradeTick(probe, target);
    const after = activeResources.map(r => target.stockpile[r] ?? 0);
    const removed = before.reduce((s, v, i) => s + Math.max(0, v - after[i]!), 0);
    return { removed, income: target.economy.exportIncome };
  };

  const free = runOnce(0);
  const blocked = runOnce(5);
  console.log(`страна с наибольшим излишком: ${victim.id}, ` +
    `излишек ${fmt(surplusOf(victim.id), 0)} ед., EXPORT_RATE=${EXPORT_RATE}`);
  console.log(`  без эмбарго:  списано со склада ${fmt(free.removed, 0)} ед., ` +
    `exportIncome ${fmt(free.income, 0)}`);
  console.log(`  5 эмбарго:    списано со склада ${fmt(blocked.removed, 0)} ед., ` +
    `exportIncome ${fmt(blocked.income, 0)}`);
  console.log(`  груз, ушедший в никуда за ОДИН тик: ${fmt(blocked.removed, 0)} ед.`);

  // Тот же вопрос в масштабе мира: сколько ресурса исчезает за год блокады.
  const blockade = structuredClone(game) as GameState;
  const target = blockade.countries.find(c => c.id === victim.id)!;
  for (const e of blockade.countries.filter(c => c.id !== target.id).slice(0, 5)) {
    e.diplomacy.sanctions[target.id] = ["trade_embargo"];
  }
  const startStock = activeResources.reduce((s, r) => s + (target.stockpile[r] ?? 0), 0);
  let incomeSum = 0;
  for (let i = 0; i < 12; i++) {
    simulateMonth(blockade);
    incomeSum += target.economy.exportIncome;
  }
  const endStock = activeResources.reduce((s, r) => s + (target.stockpile[r] ?? 0), 0);
  console.log(`  12 месяцев полной блокады ${victim.id}: запас ${fmt(startStock, 0)} → ${fmt(endStock, 0)}, ` +
    `суммарный exportIncome ${fmt(incomeSum, 0)}`);
}

/**
 * Раздел 4 (добавлен вместе с гейтом сырья, вариант А, 2026-08-02).
 *
 * 4а. Мирное покрытие: гейт откалиброван так, чтобы НЕ душить мир 1946 по
 * умолчанию — медианное покрытие и доля стран с покрытием < 1 снимаются на
 * живом прогоне. Покрытие меряется РЕПЛИКОЙ момента гейта: на клоне партии
 * прогоняются те же под-тики в том же порядке, что перед militaryTick в
 * SimulationEngine (economy → resource → trade), и берётся ровно та формула,
 * что в тике, — состояние склада ПОСЛЕ simulateMonth уже съедено
 * производством и занизило бы ответ.
 *
 * 4б. Блокада: 5 эмбарго против страны с наибольшим militarySpending
 * (крупнейший производитель техники — эффект виден крупнее всего). Канал
 * НАЗВАН в выводе: эмбарго в торговой модели режет экспортный доход (импорт
 * сознательно не гейтится — TradeTick.test.ts фиксирует это отдельным
 * тестом), поэтому в производство блокада бьёт через
 * доход → militarySpending, а не через физический голод склада.
 */
function measureCoverage(game: GameState): number[] {
  const probe = structuredClone(game) as GameState;
  const coverages: number[] = [];
  for (const country of probe.countries) {
    economyTick(country, probe.regions);
    resourceTick(country, probe.regions, probe.modifiers);
    tradeTick(probe, country);
    if (country.economy.militarySpending <= 0) continue;
    const demand = country.economy.militarySpending / EQUIPMENT_RESOURCE_DEMAND_SCALE;
    const available = WAR_MATERIAL_RESOURCE_IDS
      .reduce((s, r) => s + Math.max(0, country.stockpile[r] ?? 0), 0);
    coverages.push(equipmentResourceCoverage(available, demand));
  }
  return coverages;
}

function probeGateCoverage(months: number): void {
  console.log("\n=== 4. Гейт сырья (вариант А) — мирное покрытие и блокада ===");

  const game = createGame("1946", "USA");
  const samples = [1, 12, 36, 60, 120].filter(m => m <= months);
  let done = 0;
  for (const sample of samples) {
    while (done < sample) {
      simulateMonth(game);
      done++;
    }
    const coverages = measureCoverage(game);
    const below = coverages.filter(c => c < 1).length;
    console.log(`  месяц ${sample}: медианное покрытие ${fmt(median(coverages))}, ` +
      `стран с покрытием <1: ${below} из ${coverages.length} (${fmt((below / coverages.length) * 100, 1)}%)`);
  }

  // 4б. Блокада: жертва — страна с наибольшим militarySpending.
  const base = createGame("1946", "USA");
  for (let i = 0; i < 12; i++) simulateMonth(base);
  const victim = [...base.countries].sort(
    (a, b) => b.economy.militarySpending - a.economy.militarySpending
  )[0]!;

  const equipOf = (g: GameState, id: string): number => {
    const c = g.countries.find(x => x.id === id)!;
    return Object.values(c.military.equipment).reduce((s, v) => s + (v as number), 0);
  };

  const run = (embargoes: number): { gained: number; ms: number } => {
    const probe = structuredClone(base) as GameState;
    const target = probe.countries.find(c => c.id === victim.id)!;
    for (const e of probe.countries.filter(c => c.id !== target.id).slice(0, embargoes)) {
      e.diplomacy.sanctions[target.id] = ["trade_embargo"];
    }
    const before = equipOf(probe, victim.id);
    for (let i = 0; i < 24; i++) simulateMonth(probe);
    return { gained: equipOf(probe, victim.id) - before, ms: target.economy.militarySpending };
  };

  const free = run(0);
  const blocked = run(5);
  const delta = free.gained === 0 ? Number.NaN : (blocked.gained - free.gained) / free.gained;
  console.log(`  блокада (жертва ${victim.id}, 24 мес): произведено техники без эмбарго ` +
    `${fmt(free.gained, 1)}, под 5 эмбарго ${fmt(blocked.gained, 1)} ` +
    `(${Number.isFinite(delta) ? fmt(delta * 100, 2) + "%" : "n/a"}); ` +
    `militarySpending в конце: ${fmt(free.ms, 0)} → ${fmt(blocked.ms, 0)}`);
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");
  probeBuildExtraction(game);
  probeStockpileGate(months);
  probeEmbargoDestruction();
  probeGateCoverage(months);
}

main();
