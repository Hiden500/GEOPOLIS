/**
 * Прогон партии С НАСТОЯЩИМ РЕЖИССЁРОМ (локальная модель через LM Studio).
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ `runCampaign.ts`. Тот гоняет только детерминированную
 * симуляцию: экономику, политику, войну — всё, что движок считает сам. Здесь
 * каждый ход дополнительно вызывается модель, её ответ валидируется и
 * применяется к миру. Это единственный способ увидеть партию такой, какой её
 * увидит игрок: без режиссёра мир не объявляет войн, не заключает союзов и
 * вообще не принимает решений (Правило D удалено 2026-07-31).
 *
 * ЧТО НУЖНО ЗАПУСТИТЬ ЗАРАНЕЕ. LM Studio, вкладка Developer → Start Server,
 * модель загружена. Скрипт проверяет доступность ДО начала партии и падает с
 * понятным сообщением, а не на сороковом ходу.
 *
 * ЦЕНА ВРЕМЕНИ. Один ход — один вызов модели. На локальной 9B это порядка
 * 20–60 секунд, то есть 15 лет (180 ходов) — от часа до трёх. Поэтому:
 *   - CSV пишется ПОСЛЕ КАЖДОГО хода, не в конце: прогон можно прервать в
 *     любой момент и данные останутся;
 *   - рядом пишется `llm.jsonl` — по строке на ход с промтом, ответом и
 *     диагностикой. Именно он отвечает на вопрос «почему модель так решила»,
 *     и без него длинный прогон бесполезен: числа есть, объяснения нет;
 *   - `--years 2` для пробы. Сначала убедиться, что цикл работает, потом
 *     ставить длинный прогон.
 *
 * Запуск:
 *   npx tsx scripts/runCampaignWithLLM.ts [--years 15] [--player USA] [--out ../.tmp/llm-campaign]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { LLMService } from "../src/services/LLMService";
import { createLLMProvider } from "../src/llm/providers/createProvider";
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

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvLine(cells: (string | number)[]): string {
  return cells
    .map(v => {
      const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",") + "\n";
}

const COLUMNS = [
  "month", "date",
  "worldGdp", "worldPopulation", "countriesInDebt",
  "medianLegitimacy", "medianStability", "medianInfrastructure",
  "activeWars", "totalFlips", "rivalPairs", "allyRecords",
  "llmActionsApplied", "llmActionsRejected", "llmSeconds",
] as const;

interface TurnStats {
  applied: number;
  rejected: number;
  seconds: number;
}

function row(game: GameState, month: number, turn: TurnStats): (string | number)[] {
  const solvent = game.countries.filter(c => c.economy.gdp > 0);
  const rivals = new Set<string>();
  let allies = 0;
  for (const c of game.countries) {
    for (const r of c.diplomacy.rivals ?? []) rivals.add([c.id, r].sort().join("-"));
    allies += c.diplomacy.allies?.length ?? 0;
  }

  return [
    month, game.currentDate,
    Math.round(game.countries.reduce((s, c) => s + c.economy.gdp, 0)),
    game.regions.reduce((s, r) => s + r.population, 0),
    solvent.filter(c => c.economy.debt > 0).length,
    round(median(game.countries.map(c => c.politics.legitimacy)), 2),
    round(median(game.countries.map(c => c.politics.stability)), 2),
    round(median(game.regions.map(r => r.infrastructure)), 4),
    game.wars.filter(w => w.active !== false).length,
    game.wars.reduce((s, w) => s + w.territoryFlips.toAttackers + w.territoryFlips.toDefenders, 0),
    rivals.size,
    allies,
    turn.applied, turn.rejected, round(turn.seconds, 1),
  ];
}

/** Проверка ДО партии: сервер модели поднят и отвечает. */
async function ensureProviderReachable(): Promise<void> {
  const baseUrl = (process.env.LOCAL_LLM_BASE_URL || "http://localhost:1234/v1").replace(/\/+$/, "");
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map(m => m.id).filter(Boolean);
    console.log(`сервер модели отвечает: ${baseUrl}`);
    console.log(`загружено моделей: ${ids.length}${ids.length ? ` (${ids.join(", ")})` : ""}`);
    if (ids.length === 0) {
      throw new Error("сервер отвечает, но ни одна модель не загружена");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Локальная модель недоступна по ${baseUrl}: ${reason}\n` +
      `Запусти LM Studio → вкладка Developer → Start Server и загрузи модель.\n` +
      `Другой адрес задаётся переменной LOCAL_LLM_BASE_URL.`
    );
  }
}

async function main(): Promise<void> {
  const years = Number.parseInt(arg("years", "15"), 10);
  const months = years * 12;
  const player = arg("player", "USA");
  const outDir = path.resolve(arg("out", path.join("..", ".tmp", "llm-campaign")));

  await ensureProviderReachable();

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "world.csv");
  const logPath = path.join(outDir, "llm.jsonl");
  const csv = fs.createWriteStream(csvPath, { encoding: "utf8" });
  const log = fs.createWriteStream(logPath, { encoding: "utf8" });
  csv.write("﻿" + csvLine([...COLUMNS]));

  const game = createGame("1946", player);
  const provider = createLLMProvider();

  console.log(`\nпартия: ${player}, ${years} лет (${months} ходов)\n`);
  const started = Date.now();

  csv.write(csvLine(row(game, 0, { applied: 0, rejected: 0, seconds: 0 })));

  for (let month = 1; month <= months; month++) {
    const service = new LLMService(game);
    const turnStarted = Date.now();
    let applied = 0;
    let rejected = 0;
    let error: string | undefined;

    try {
      const result = await service.runAutoCycle(prompt => provider.generateResponse(prompt));
      // Квитанция — единственный источник «что на самом деле произошло»:
      // сам факт ответа модели ничего не значит, движок мог всё отклонить.
      const receipt = result.receipt;
      applied = receipt.actions.applied.length + receipt.primitives.applied.length;
      rejected = receipt.actions.rejected.length + receipt.primitives.rejected.length;
      log.write(JSON.stringify({
        month, date: game.currentDate, applied, rejected,
        success: result.success,
        narrativeCanonized: result.narrativeCanonized,
        title: result.title ?? null,
        receipt,
      }) + "\n");
    } catch (e) {
      // Сбой одного хода не должен ронять партию: движок продолжает считать
      // детерминированную часть, а причина остаётся в журнале.
      error = e instanceof Error ? e.message : String(e);
      log.write(JSON.stringify({ month, date: game.currentDate, error }) + "\n");
    }

    simulateMonth(game);

    const seconds = (Date.now() - turnStarted) / 1000;
    csv.write(csvLine(row(game, month, { applied, rejected, seconds })));

    const mark = error ? `ОШИБКА: ${error.slice(0, 60)}` : `+${applied} действий, −${rejected}`;
    console.log(`  ход ${String(month).padStart(3)} (${game.currentDate}) ${seconds.toFixed(1)}с — ${mark}`);
  }

  csv.end();
  log.end();

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\nготово за ${minutes} мин`);
  console.log(`  ${csvPath}`);
  console.log(`  ${logPath}`);
}

main().catch(error => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
