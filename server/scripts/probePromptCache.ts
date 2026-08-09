/**
 * Срабатывает ли ПРЕФИКСНЫЙ КЭШ провайдера на нашем промте хода.
 *
 * ЗАЧЕМ. Неявный кэш Gemini включён по умолчанию и удешевляет ту часть входа,
 * которую провайдер узнал по совпадающему НАЧАЛУ запроса (docs/LLM_RULES.md).
 * Совпадает ли у нас это начало — вопрос не рассуждения, а замера: единственное
 * свидетельство кэша — поле `cachedContentTokenCount` в ответе, и оно приходит
 * только когда совпадение реально случилось.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ `probePromptPrefix.ts`. Тот считает совпадение начала
 * ОФЛАЙН, по тексту промтов, и отвечает на вопрос «может ли кэш сработать в
 * принципе». Этот ходит к живой модели и отвечает «сработал ли». Первый
 * бесплатен, второй тратит квоту — поэтому сначала запускают первый.
 *
 * ЧЕГО ОН НЕ ДЕЛАЕТ. Не судит качество ответа: сюда попадает только число
 * отклонённых примитивов, чтобы перестановка секций не прошла приёмку за счёт
 * подешевевшего, но испортившегося хода. Разбор самих отказов — `probeSchemaFailures.ts`.
 *
 * Запуск (из server/, ключ и провайдер — из окружения или server/.env):
 *   LLM_PROVIDER=gemini npx tsx scripts/probePromptCache.ts [--turns 6] [--player USA]
 */
// Первым: подхватывает server/.env до чтения любых переменных.
import "./loadEnv";
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { LLMService } from "../src/services/LLMService";
import { createLLMProvider, resolveProviderKind } from "../src/llm/providers/createProvider";
import { DEFAULT_MODEL } from "../src/llm/providers/GeminiProvider";
import { percentiles, type TokenUsage } from "../src/llm/tokenTelemetry";

function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

interface TurnRow {
  month: number;
  date: string;
  chars: number;
  prefixChars: number;
  usage: TokenUsage | undefined;
  applied: number;
  rejected: number;
  error?: string;
}

async function main(): Promise<void> {
  const turns = Number.parseInt(arg("turns", "6"), 10);
  const player = arg("player", "USA");

  // Кэш — свойство облачного провайдера. Прогон на локальном рантайме дал бы
  // пустую колонку и выглядел бы как «кэш не работает», хотя мерили не то.
  const kind = resolveProviderKind();
  if (kind !== "gemini") {
    throw new Error(
      `LLM_PROVIDER="${kind}" — префиксный кэш меряется только на gemini. ` +
      `Запусти с LLM_PROVIDER=gemini.`
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY не задан — замер ходит к живой модели.");
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  console.log(`модель: ${model}; ходов: ${turns}; игрок: ${player}\n`);

  const game = createGame("1946", player, "ru", 19460101);
  // Расход копится списком, а не одной переменной: из переменной, которую
  // пишет только колбэк провайдера, компилятор выводит `undefined` — он не
  // видит, что колбэк вообще вызывался.
  const usages: TokenUsage[] = [];
  const provider = createLLMProvider(usage => {
    usages.push(usage);
  });

  const rows: TurnRow[] = [];
  let previousPrompt: string | undefined;

  for (let month = 1; month <= turns; month++) {
    const service = new LLMService(game);
    // Промт снимается отдельным вызовом: `generatePrompt` чист по контракту
    // (состояние не меняет), а сам цикл собирает его внутри себя и наружу не
    // отдаёт. Нужен здесь ради длины и совпадения начала с предыдущим ходом.
    const { prompt } = service.generatePrompt();
    const prefixChars = previousPrompt ? commonPrefixLength(previousPrompt, prompt) : 0;
    previousPrompt = prompt;

    const usagesBefore = usages.length;
    let applied = 0;
    let rejected = 0;
    let error: string | undefined;
    try {
      const result = await service.runAutoCycle(p => provider.generateResponse(p));
      applied = result.receipt.primitives.applied.length;
      rejected = result.receipt.primitives.rejected.length;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const u = usages.length > usagesBefore ? usages[usages.length - 1] : undefined;
    rows.push({
      month, date: game.currentDate, chars: prompt.length, prefixChars,
      usage: u, applied, rejected, ...(error !== undefined ? { error } : {}),
    });

    console.log(
      `ход ${String(month).padStart(2)} ${game.currentDate}  ` +
      `знаков ${String(prompt.length).padStart(6)}  общий префикс ${String(prefixChars).padStart(6)}  ` +
      `вход ${String(u?.promptTokens ?? 0).padStart(6)}  ` +
      `из кэша ${u?.cachedTokens === undefined ? "     —" : String(u.cachedTokens).padStart(6)}  ` +
      `мысли ${String(u?.thoughtTokens ?? 0).padStart(5)}  ` +
      `принято ${applied}/отклонено ${rejected}` +
      (error ? `  ОШИБКА: ${error}` : "")
    );

    simulateMonth(game);
  }

  const withUsage = rows.filter(r => r.usage !== undefined);
  const promptTokens = withUsage.map(r => r.usage!.promptTokens);
  // Промах кэша — законный ноль в выборке, а не пропуск: иначе медиана
  // считалась бы только по удачным ходам и завышала бы выигрыш.
  const cachedTokens = withUsage.map(r => r.usage!.cachedTokens ?? 0);
  const totalPrompt = promptTokens.reduce((s, v) => s + v, 0);
  const totalCached = cachedTokens.reduce((s, v) => s + v, 0);

  const p = percentiles(promptTokens);
  const c = percentiles(cachedTokens);
  console.log(`\nходов с телеметрией: ${withUsage.length} из ${rows.length}`);
  console.log(`вход, токенов:    медиана ${p?.median ?? "—"}, min ${p?.min ?? "—"}, max ${p?.max ?? "—"}`);
  console.log(`из кэша, токенов: медиана ${c?.median ?? "—"}, min ${c?.min ?? "—"}, max ${c?.max ?? "—"}`);
  console.log(
    `доля кэша по сумме входа: ${totalPrompt > 0 ? ((totalCached / totalPrompt) * 100).toFixed(1) : "—"} %` +
    ` (${totalCached} из ${totalPrompt})`
  );
  const hits = cachedTokens.filter(v => v > 0).length;
  console.log(`ходов с попаданием в кэш: ${hits} из ${withUsage.length}`);
  const appliedAll = rows.reduce((s, r) => s + r.applied, 0);
  const rejectedAll = rows.reduce((s, r) => s + r.rejected, 0);
  console.log(
    `примитивы: принято ${appliedAll}, отклонено ${rejectedAll}` +
    (appliedAll + rejectedAll > 0
      ? ` (доля отказов ${((rejectedAll / (appliedAll + rejectedAll)) * 100).toFixed(1)} %)`
      : "")
  );
  const failed = rows.filter(r => r.error !== undefined).length;
  if (failed > 0) console.log(`ходов с ошибкой вызова: ${failed}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
