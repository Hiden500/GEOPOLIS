/**
 * На чём именно модель проваливает СХЕМУ примитива.
 *
 * ЗАЧЕМ. Квитанция хранит код и позицию, но не текст причины — он уходит в
 * промт следующего хода и там же вычищается. Поэтому «18 отказов схемы за
 * прогон» не отличить от «модель шлёт числовые поля» без отдельного замера:
 * ответ разбирается тем же `parsePrimitives`, что и в бою, и печатается СЫРАЯ
 * причина вместе с тем, что модель прислала.
 *
 * ЧТО ИМ НАЙДЕНО (2026-08-02, `gemini-3.6-flash-high`): все отказы схемы —
 * ОДНА ошибка формы, `target` строкой вместо объекта
 * (`"target":"GBR"` вместо `{"countryId":"GBR"}`), и она БУРСТОВАЯ: модель либо
 * держит форму весь ход, либо теряет её на всех примитивах хода сразу.
 *
 * Запуск (из server/, через scripts/llm-run.ps1):
 *   npx tsx scripts/probeSchemaFailures.ts [--turns 6]
 */
import "./loadEnv";
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { LLMService } from "../src/services/LLMService";
import { createLLMProvider } from "../src/llm/providers/createProvider";
import { parsePrimitives } from "../src/primitives/primitiveSchemas";
import { LLMResponseEnvelopeSchema } from "../src/llm/responseSchemas";
import { stripCodeFence } from "../src/llm/stripCodeFence";

function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const turns = Number.parseInt(arg("turns", "3"), 10);
  const game = createGame("1946", arg("player", "USA"), "ru", 19460101);
  const provider = createLLMProvider();

  for (let turn = 1; turn <= turns; turn++) {
    const service = new LLMService(game);
    const { prompt } = service.generatePrompt();
    const raw = await provider.generateResponse(prompt);

    // Битый JSON — законный исход хода, а не сбой замера: в бою его ловит
    // `processResponse` и отвечает отказом. Замер, падающий на нём, теряет все
    // последующие ходы (поймано живым прогоном 2026-08-02, ход 14 из 18).
    let payload: unknown;
    try {
      payload = JSON.parse(stripCodeFence(raw));
    } catch (e) {
      console.log(`\n=== ход ${turn} (${game.currentDate}): БИТЫЙ JSON — ${(e as Error).message} ===`);
      service.processResponse(raw);
      simulateMonth(game);
      continue;
    }

    const parsed = LLMResponseEnvelopeSchema.safeParse(payload);
    if (!parsed.success) {
      console.log(`ход ${turn}: конверт не прошёл — ${parsed.error.issues[0]?.message}`);
      service.processResponse(raw);
      simulateMonth(game);
      continue;
    }
    const { invalid, primitives } = parsePrimitives(parsed.data.primitives ?? []);
    console.log(
      `\n=== ход ${turn} (${game.currentDate}): валидных ${primitives.length}, битых ${invalid.length}` +
      `${parsed.data.actions?.length ? `, actions[] прислано: ${parsed.data.actions.length}` : ""} ===`
    );
    for (const bad of invalid) {
      const source = (parsed.data.primitives ?? [])[bad.index];
      console.log(`  [${bad.index}] verb=${bad.verb ?? "?"}`);
      console.log(`      причина: ${bad.reason}`);
      console.log(`      прислано: ${JSON.stringify(source)}`);
    }

    service.processResponse(raw);
    simulateMonth(game);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
