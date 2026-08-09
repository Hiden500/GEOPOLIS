/**
 * Какой ОБЩИЙ ПРЕФИКС имеют промты соседних ходов.
 *
 * ЗАЧЕМ. Неявный кэш провайдера (Gemini, «implicit caching») срабатывает на
 * совпадающем НАЧАЛЕ запроса и только если это начало длиннее минимума
 * (документация — docs/LLM_RULES.md). Поэтому вопрос «окупится ли перестановка
 * секций» сводится к двум числам, которые считаются БЕЗ обращения к модели:
 * сколько знаков у промтов соседних ходов совпадает с начала сегодня и сколько
 * совпадало бы, если неизменные секции стояли первыми.
 *
 * Замер офлайновый намеренно: он не тратит квоту и повторяется кем угодно.
 * Живой кэш им не доказывается — его доказывает `cachedContentTokenCount` в
 * ответе (см. tokenTelemetry.ts).
 *
 * Запуск (из server/):
 *   npx tsx scripts/probePromptPrefix.ts [--turns 6] [--player USA]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { LLMService } from "../src/services/LLMService";

function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

/** Длина совпадающего начала двух строк, в знаках. */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Длина совпадающего КОНЦА двух строк, в знаках. */
function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

function main(): void {
  const turns = Number.parseInt(arg("turns", "6"), 10);
  const player = arg("player", "USA");
  const game = createGame("1946", player, "ru", 19460101);

  const prompts: { date: string; text: string }[] = [];
  for (let turn = 0; turn < turns; turn++) {
    prompts.push({ date: game.currentDate, text: new LLMService(game).generatePrompt().prompt });
    simulateMonth(game);
  }

  console.log(`ходов: ${prompts.length}, игрок: ${player}, сценарий 1946\n`);
  console.log("ход      дата        знаков   общий префикс с пред.   общий суффикс с пред.");
  for (let i = 0; i < prompts.length; i++) {
    const cur = prompts[i]!;
    const prev = i > 0 ? prompts[i - 1]! : undefined;
    const pre = prev ? commonPrefixLength(prev.text, cur.text) : 0;
    const suf = prev ? commonSuffixLength(prev.text, cur.text) : 0;
    console.log(
      `${String(i + 1).padStart(3)}   ${cur.date}   ${String(cur.text.length).padStart(7)}   ` +
      `${prev ? String(pre).padStart(21) : "—".padStart(21)}   ${prev ? String(suf).padStart(21) : "—".padStart(21)}`
    );
  }

  // Префикс, общий для ВСЕХ снятых ходов: кэш живёт дольше одного хода, и
  // окупается именно то, что совпадает у всех запросов подряд.
  let allPrefix = prompts[0]!.text;
  let allSuffix = prompts[0]!.text;
  for (const p of prompts.slice(1)) {
    allPrefix = allPrefix.slice(0, commonPrefixLength(allPrefix, p.text));
    allSuffix = allSuffix.slice(allSuffix.length - commonSuffixLength(allSuffix, p.text));
  }

  const first = prompts[0]!.text;
  const instructionsAt = first.indexOf("\n## Instructions");
  console.log(
    `\nобщий префикс всех ходов: ${allPrefix.length} знаков` +
    ` (${((allPrefix.length / first.length) * 100).toFixed(1)} % промта)`
  );
  console.log(`общий суффикс всех ходов: ${allSuffix.length} знаков` +
    ` (${((allSuffix.length / first.length) * 100).toFixed(1)} % промта)`);
  console.log(`длина промта первого хода: ${first.length} знаков`);
  console.log(
    `хвост от "## Instructions" до конца: ${instructionsAt >= 0 ? first.length - instructionsAt : "секция не найдена"} знаков`
  );
  console.log(`\nпервые 120 знаков промта:\n${JSON.stringify(first.slice(0, 120))}`);
  console.log(`\nобщий префикс целиком:\n${JSON.stringify(allPrefix)}`);

  // Насколько неизменен САМ хвост инструкций — то есть сколько знаков стало бы
  // общим префиксом, если бы этот блок стоял первым.
  const tails = prompts.map(p => p.text.slice(p.text.indexOf("\n## Instructions")));
  let tailPrefix = tails[0]!;
  for (const t of tails.slice(1)) tailPrefix = tailPrefix.slice(0, commonPrefixLength(tailPrefix, t));
  console.log(
    `\nблок "## Instructions"…конец: ${tails[0]!.length} знаков, из них общих с начала блока: ${tailPrefix.length}`
  );
  console.log(
    `первое расхождение внутри блока:\n${JSON.stringify(tails[0]!.slice(Math.max(0, tailPrefix.length - 60), tailPrefix.length + 60))}`
  );
}

main();
