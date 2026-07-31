/**
 * Кто в мире мог бы начать войну — замер на живом сценарии 1946.
 *
 * ЗАЧЕМ. Правило D (автоматическое объявление войны ИИ) удалено 2026-07-31:
 * замер показал, что у него ноль кандидатов, потому что ВСЕ соперничества мира
 * возникают с участием великой державы, а правило смотрело только пары, где обе
 * стороны non-major. Скрипт остаётся как доказательная база того решения и как
 * инструмент для любого следующего: прежде чем вводить механику, которая
 * срабатывает на парах соперников, стоит посмотреть, какие пары мир вообще
 * порождает.
 *
 * Печатается распределение соперничеств по тирам и состояние армий. Войн без
 * LLM и игрока быть не должно — строка «активных войн» служит проверкой того,
 * что удаление правила действительно закрыло автоматический путь.
 *
 * Запуск:  npx tsx scripts/probeWarReach.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 120;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function analyse(game: GameState, label: string): void {
  const tierOf = new Map(game.countries.map(c => [c.id, c.tier ?? "?"]));
  const pairs = new Set<string>();
  const relations: number[] = [];

  for (const country of game.countries) {
    for (const rivalId of country.diplomacy.rivals ?? []) {
      pairs.add([country.id, rivalId].sort().join("-"));
      const relation = country.diplomacy.relations[rivalId];
      if (typeof relation === "number") relations.push(relation);
    }
  }

  // Разрез по тирам — тот самый, который показал, что кандидатов нет: пара
  // «обе стороны non-major» в мире 1946 просто не возникает.
  const byTier = new Map<string, number>();
  let withoutMajor = 0;
  for (const pair of pairs) {
    const [a, b] = pair.split("-");
    const tiers = [tierOf.get(a!) ?? "?", tierOf.get(b!) ?? "?"];
    if (!tiers.includes("major")) withoutMajor++;
    byTier.set(tiers.sort().join(" + "), (byTier.get(tiers.sort().join(" + ")) ?? 0) + 1);
  }

  const active = game.countries.map(c => c.military.activePersonnel);
  const wars = game.wars?.filter(war => war.active !== false).length ?? 0;

  console.log(`\n=== ${label} ===`);
  console.log(`пар-соперников: ${pairs.size}, из них БЕЗ великой державы: ${withoutMajor}`);
  for (const [combo, count] of [...byTier].sort()) {
    console.log(`    ${combo}: ${count}`);
  }
  if (relations.length > 0) {
    console.log(
      `отношения внутри пар: ${fmt(Math.min(...relations))}…${fmt(Math.max(...relations))}, ` +
      `медиана ${fmt(median(relations))}`
    );
  }
  console.log(
    `activePersonnel: нулевых стран ${active.filter(v => v === 0).length} из ${active.length}, ` +
    `медиана ${fmt(median(active), 0)}`
  );
  console.log(`активных войн: ${wars}`);
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  analyse(game, "старт (месяц 0)");

  const checkpoints = [12, 60, months].filter((m, i, all) => m <= months && all.indexOf(m) === i);
  let simulated = 0;
  for (const checkpoint of checkpoints) {
    for (; simulated < checkpoint; simulated++) simulateMonth(game);
    analyse(game, `через ${checkpoint} месяцев`);
  }
}

main();
