/**
 * Замер четырёх обходов мира, отложенных «до полной разметки Милстоуна 2».
 *
 * ЗАЧЕМ. Четыре пункта `docs/TODO.md` оценивались, когда демографией были
 * размечены 14 регионов из 1399, и каждый нёс формулу «сегодня дёшево, потому
 * что данных мало; перемерить при полной разметке». Разметка состоялась
 * 2026-07-29 — отсрочка истекла, а числа так и остались от старого мира.
 *
 * ЧТО МЕРЯЕТСЯ (всё — на игре, созданной ровно так, как её создаёт движок):
 *   1. `activeCrises`      — кризисная выборка промта. `MAX_PROMPT_CRISES`
 *                            ограничивает РЕНДЕР, а не выборку: разложение по
 *                            группам строится для каждого залатченного региона.
 *   2. `enumerateCells`    — разложение состояния для рантайм-сверки. Ячейка
 *                            `regionGdp:` добавила в него обход всех регионов,
 *                            а сверка строит разложение ДВАЖДЫ на примитив.
 *   3. `findStateViolations` — пост-инварианты, один проход на ответ модели.
 *   4. `generatePrompt`    — сборка промта целиком (включает пункт 1).
 * Плюс размер `primitiveTurnBudget` в сейве — он растёт как примитивы × группы.
 *
 * Запуск:  npx tsx scripts/benchWorldPasses.ts [--turns 3] [--repeats 5]
 */
import { GameService } from "../src/services/GameService";
import { LLMService } from "../src/services/LLMService";
import { activeCrises } from "../src/llm/crisisDigest";
import { enumerateCells } from "../src/primitives/reconciliation";
import { findStateViolations } from "../src/primitives/invariants";
import { type GameState } from "@shared/types/GameState";

interface Args {
  turns: number;
  repeats: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: number): number => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1 || i + 1 >= argv.length) return fallback;
    const parsed = Number.parseInt(argv[i + 1]!, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return { turns: get("turns", 3), repeats: get("repeats", 5) };
}

/** Медиана, а не среднее: холодный первый прогон не должен красить итог. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function measure(label: string, repeats: number, fn: () => unknown): number {
  const samples: number[] = [];
  for (let i = 0; i < repeats; i++) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  const med = median(samples);
  console.log(
    `  ${label.padEnd(22)} медиана ${med.toFixed(1).padStart(8)} мс   ` +
      `мин ${Math.min(...samples).toFixed(1)} / макс ${Math.max(...samples).toFixed(1)}`
  );
  return med;
}

function sizeOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf-8");
}

function describeWorld(game: GameState): void {
  const marked = game.regions.filter(r => (r.demographics?.length ?? 0) > 0).length;
  console.log(
    `мир: регионов ${game.regions.length} (с демографией ${marked}), ` +
      `стран ${game.countries.length}, залатчено кризисов ${game.regionCrisisLatch.length}`
  );
}

function main(): void {
  const args = parseArgs();
  const service = new GameService();
  // Игра создаётся сервисом (он же кладёт её в своё состояние), а не
  // `createGame` напрямую: тик мы дальше гоняем именно сервисом.
  service.createGame("1946", "USA", "ru");

  // Латч кризисов наполняется тиками, а не созданием игры: на нулевом ходу
  // выборка пуста, и замер по ней ничего не сказал бы о живой партии.
  for (let i = 0; i < args.turns; i++) {
    const game = service.getCurrentGame()!;
    game.llmRespondedThisTurn = true;
    service.advanceMonth();
  }

  const game = service.getCurrentGame()!;
  describeWorld(game);
  console.log(`повторов на замер: ${args.repeats}\n`);

  console.log("обходы мира:");
  measure("activeCrises", args.repeats, () => activeCrises(game));
  measure("enumerateCells", args.repeats, () => enumerateCells(game));
  measure("findStateViolations", args.repeats, () => findStateViolations(game));

  const llm = new LLMService(game);
  measure("generatePrompt", args.repeats, () => llm.generatePrompt());

  console.log("\nразмеры:");
  const budget = game.primitiveTurnBudget;
  const targetKeys = Object.keys(budget?.targetUses ?? {}).length;
  const impactKeys = Object.keys(budget?.impactAccrued ?? {}).length;
  console.log(`  primitiveTurnBudget    ${sizeOf(budget)} байт (ключей: targetUses ${targetKeys}, impactAccrued ${impactKeys})`);
  console.log(`  промт                  ${llm.generatePrompt().prompt.length} символов`);
  console.log(`  разложение состояния   ${enumerateCells(game).size} ячеек`);

  // Разбор сейва по верхним ключам. Бюджет сохранения назван в критериях
  // приёмки v1 (SAVE < ~3–5 МБ), но из чего он складывается — не мерил никто,
  // а без этого «сейв растёт» лечится наугад.
  const total = sizeOf(game);
  console.log(`\nсейв целиком: ${total} байт (${(total / 1024 / 1024).toFixed(2)} МБ)`);
  const parts = Object.entries(game as unknown as Record<string, unknown>)
    .map(([key, value]) => ({ key, bytes: sizeOf(value) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
  for (const { key, bytes } of parts) {
    const share = ((bytes / total) * 100).toFixed(1).padStart(5);
    console.log(`  ${key.padEnd(22)} ${String(bytes).padStart(9)} байт  ${share}%`);
  }

  // Отдельно — самая частая причина роста: геометрия регионов. Она в сейве не
  // нужна (карта грузится сценарием), и если это она, лечение структурное, а
  // не «почистить историю».
  const geometry = game.regions.reduce(
    (sum, r) => sum + sizeOf((r as unknown as Record<string, unknown>).geometry ?? null),
    0
  );
  const names = game.regions.reduce(
    (sum, r) => sum + sizeOf((r as unknown as Record<string, unknown>).names ?? null),
    0
  );
  const demographics = game.regions.reduce(
    (sum, r) => sum + sizeOf((r as unknown as Record<string, unknown>).demographics ?? null),
    0
  );
  console.log(
    `  из них в regions: геометрия ${geometry}, имена ${names}, демография ${demographics}`
  );
}

main();
