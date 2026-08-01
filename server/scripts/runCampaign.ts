/**
 * Прогон партии с ПОМЕСЯЧНОЙ выгрузкой состояния мира в CSV.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ probe-скриптов. Те печатают срезы в консоль и отвечают на
 * один вопрос каждый. Здесь другое: снять всю траекторию целиком и положить её
 * в файл, который открывается в Excel/LibreOffice и строит график за два клика.
 * Вопрос задаётся ПОСЛЕ прогона, а не до него.
 *
 * ФОРМАТ — CSV, а не JSON, и это осознанно:
 *   - один месяц = одна строка, колонки фиксированы. Такой файл читает и
 *     табличный редактор, и pandas, и sqlite без единой строки кода;
 *   - JSON пришлось бы разбирать, а JSONL — сводить вручную;
 *   - размер линеен и предсказуем: 180 месяцев × ~40 колонок ≈ 60 КБ.
 * Разделитель — запятая, десятичная точка, даты ISO. Кодировка UTF-8 с BOM,
 * иначе Excel на Windows покажет кириллицу иероглифами.
 *
 * ДВА УРОВНЯ ПОДРОБНОСТИ:
 *   - `world` — по одной строке на месяц: агрегаты мира;
 *   - `countries` — по строке на страну на месяц (157 × 180 = 28 260 строк,
 *     ~4 МБ). Нужен для «а что было конкретно с Францией».
 * Оба файла пишутся всегда: снять их заново стоит минуты прогона, а решить
 * задним числом, что нужен второй, — обычное дело.
 *
 * Запуск:
 *   npx tsx scripts/runCampaign.ts [--years 15] [--player USA] [--out ../.tmp/campaign]
 *   npx tsx scripts/runCampaign.ts --war ROU:YUG     // начать войну на первом тике
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { applyPrimitiveBatch } from "../src/primitives/PrimitiveEngine";
import { type Primitive } from "../src/primitives/types";
import { effectiveController } from "@shared/utils/regionControl";
import { type GameState } from "@shared/types/GameState";

function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/** CSV-экранирование: поля с запятой или кавычкой берутся в кавычки. */
function csvCell(value: string | number): string {
  const s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",") + "\n";
}

const WORLD_COLUMNS = [
  "month", "date",
  "worldGdp", "worldPopulation",
  "medianCountryGdp", "medianBudgetBalanceShare", "countriesInDebt",
  "medianExportShare", "medianInfrastructure",
  "medianLegitimacy", "medianCorruption", "medianStability",
  "activeWars", "totalFlips", "totalCasualties",
  "rivalPairs", "allyRecords",
  "worldActivePersonnel", "medianTechProgress",
] as const;

function worldRow(game: GameState, month: number): (string | number)[] {
  const solvent = game.countries.filter(c => c.economy.gdp > 0);
  const wars = game.wars.filter(w => w.active !== false);

  let rivalPairs = 0;
  let allyRecords = 0;
  const seenRivals = new Set<string>();
  for (const c of game.countries) {
    for (const r of c.diplomacy.rivals ?? []) seenRivals.add([c.id, r].sort().join("-"));
    allyRecords += c.diplomacy.allies?.length ?? 0;
  }
  rivalPairs = seenRivals.size;

  const flips = game.wars.reduce(
    (sum, w) => sum + w.territoryFlips.toAttackers + w.territoryFlips.toDefenders, 0);
  const casualties = game.wars.reduce(
    (sum, w) => sum + Object.values(w.casualties ?? {}).reduce((a, b) => a + b, 0), 0);

  return [
    month,
    game.currentDate,
    Math.round(game.countries.reduce((s, c) => s + c.economy.gdp, 0)),
    game.regions.reduce((s, r) => s + r.population, 0),
    round(median(solvent.map(c => c.economy.gdp)), 0),
    round(median(solvent.map(c => c.economy.budgetBalance / c.economy.gdp)), 6),
    solvent.filter(c => c.economy.debt > 0).length,
    round(median(solvent.map(c => c.economy.exportIncome / c.economy.gdp)), 6),
    round(median(game.regions.map(r => r.infrastructure)), 4),
    round(median(game.countries.map(c => c.politics.legitimacy)), 2),
    round(median(game.countries.map(c => c.politics.corruption)), 2),
    round(median(game.countries.map(c => c.politics.stability)), 2),
    wars.length,
    flips,
    casualties,
    rivalPairs,
    allyRecords,
    game.countries.reduce((s, c) => s + c.military.activePersonnel, 0),
    round(median(game.countries.map(c =>
      Object.values(c.technology.domains).reduce((a, b) => a + b, 0))), 1),
  ];
}

const COUNTRY_COLUMNS = [
  "month", "date", "countryId", "tier",
  "gdp", "population", "treasury", "debt", "budgetBalance",
  "exportIncome", "importSpending",
  "legitimacy", "corruption", "stability", "governmentSupport",
  "activePersonnel", "manpower",
  "regionsControlled", "rivals", "allies", "atWar",
] as const;

function countryRows(game: GameState, month: number): (string | number)[][] {
  const controlled = new Map<string, number>();
  for (const region of game.regions) {
    const id = effectiveController(region);
    controlled.set(id, (controlled.get(id) ?? 0) + 1);
  }
  const atWar = new Set<string>();
  for (const war of game.wars.filter(w => w.active !== false)) {
    for (const id of [...war.attackers, ...war.defenders]) atWar.add(id);
  }

  return game.countries.map(c => [
    month, game.currentDate, c.id, c.tier ?? "",
    Math.round(c.economy.gdp), c.population,
    Math.round(c.economy.treasury), Math.round(c.economy.debt),
    Math.round(c.economy.budgetBalance),
    Math.round(c.economy.exportIncome), Math.round(c.economy.importSpending),
    round(c.politics.legitimacy, 2), round(c.politics.corruption, 2),
    round(c.politics.stability, 2), round(c.politics.governmentSupport, 2),
    c.military.activePersonnel, c.military.manpower,
    controlled.get(c.id) ?? 0,
    c.diplomacy.rivals?.length ?? 0, c.diplomacy.allies?.length ?? 0,
    atWar.has(c.id) ? 1 : 0,
  ]);
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function main(): void {
  const years = Number.parseInt(arg("years", "15"), 10);
  const months = years * 12;
  const player = arg("player", "USA");
  const outDir = path.resolve(arg("out", path.join("..", ".tmp", "campaign")));
  const war = arg("war", "");

  fs.mkdirSync(outDir, { recursive: true });
  const worldPath = path.join(outDir, "world.csv");
  const countriesPath = path.join(outDir, "countries.csv");

  // BOM — иначе Excel на Windows читает UTF-8 как cp1251 и портит кириллицу.
  const BOM = "﻿";
  const worldOut = fs.createWriteStream(worldPath, { encoding: "utf8" });
  const countriesOut = fs.createWriteStream(countriesPath, { encoding: "utf8" });
  worldOut.write(BOM + csvLine([...WORLD_COLUMNS]));
  countriesOut.write(BOM + csvLine([...COUNTRY_COLUMNS]));

  const game = createGame("1946", player);

  if (war) {
    const [attacker, defender] = war.split(":");
    if (!attacker || !defender) throw new Error(`--war ждёт формат ATT:DEF, получено "${war}"`);
    applyPrimitiveBatch(game, [
      { verb: "war", sourceCountryId: attacker, target: { countryId: defender } },
    ] as Primitive[]);
    console.log(`война объявлена: ${attacker} → ${defender}`);
  }

  const started = Date.now();
  for (let month = 0; month <= months; month++) {
    worldOut.write(csvLine(worldRow(game, month)));
    for (const row of countryRows(game, month)) countriesOut.write(csvLine(row));
    if (month < months) simulateMonth(game);
    if (month % 24 === 0) {
      console.log(`  месяц ${String(month).padStart(3)} (${game.currentDate})`);
    }
  }

  worldOut.end();
  countriesOut.end();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nготово за ${seconds} с — ${months} месяцев (${years} лет)`);
  console.log(`  ${worldPath}`);
  console.log(`  ${countriesPath}`);
}

main();
