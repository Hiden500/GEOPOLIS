/**
 * Замер локальной LLM на РЕАЛЬНОМ промте хода Geopolis — не на синтетике.
 *
 * Промт берётся у `LLMService.generatePrompt()` на игре, созданной
 * `createGame("1946", ...)` с фиксированным сидом, а ответ проверяется ровно той
 * цепочкой, что стоит в `LLMService.processResponse()`:
 *   JSON.parse -> LLMResponseEnvelopeSchema -> LLMActionSchema (по каждому
 *   действию отдельно) -> LLMResponseValidator.validateActionApplicability
 *   -> parsePrimitives.
 * Совпадение с боевым путём — единственная причина верить измеренной доле
 * схема-валидных ответов; своя упрощённая проверка мерила бы другую величину.
 *
 * Скрипт НИЧЕГО не применяет к состоянию: `processResponse` мутирует игру и
 * инкрементирует `llmTurn`, поэтому здесь повторяется его цепочка ПРОВЕРОК, а
 * не он сам — иначе каждый прогон стартовал бы с другого состояния и промты
 * прогонов отличались бы друг от друга.
 *
 * Запуск (из server/):
 *   npx tsx scripts/benchLocalModels.ts --model <id> --runs 10 --mode schema
 */
import { writeFileSync } from "fs";
import { z } from "zod";
import { createGame } from "../src/game/CreateGame";
import { LLMService } from "../src/services/LLMService";
import { LLMResponseValidator } from "../src/llm/LLMResponseValidator";
import {
  LLMActionSchema,
  LLMResponseEnvelopeSchema,
  GeminiResponseSchema,
} from "../src/llm/actionSchemas";
import { parsePrimitives } from "../src/primitives/primitiveSchemas";
import { type GameState } from "@shared/types/GameState";

interface Args {
  model: string;
  runs: number;
  mode: "free" | "schema";
  base: string;
  player: string;
  maxTokens: number;
  out: string;
  retry: boolean;
  /** Гасит reasoning через chat_template_kwargs — цена хода падает в разы. */
  noThink: boolean;
  /**
   * Добавка к промту ОТДЕЛЬНЫМ сообщением — проверяет, сколько даёт стилевая
   * инструкция, не трогая `generatePrompt()`. Замер отвечает на вопрос
   * «дефект от размера модели или от отсутствия запрета в промте», и ответ
   * на него нужен ДО того, как править промт игры.
   */
  style: boolean;
}

/**
 * Запрещает ровно те дефекты, что замечены в выводе Qwen3.5-9B: цитирование
 * сырых чисел из промта, технические id в русской прозе, разрушение
 * погружения словами «симуляция»/«кампания».
 */
const STYLE_HINT = `Пиши "descriptions" как фрагмент исторической хроники 1946 года.
Запрещено: приводить точные числа и суммы из данных выше (пиши "крупнейшая экономика мира", а не "$118.69B");
вставлять в русский текст технические идентификаторы стран (пиши "США", а не "США (USA)");
упоминать симуляцию, кампанию, игру, ход или данные — внутри текста этого мира их не существует.
Опирайся на реальные события, лица и решения января 1946 года.`;

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback?: string): string => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1] as string;
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required --${name}`);
  };
  const mode = get("mode", "schema");
  if (mode !== "free" && mode !== "schema") throw new Error(`--mode must be free|schema`);
  return {
    model: get("model"),
    runs: Number(get("runs", "10")),
    mode,
    base: get("base", "http://localhost:1234/v1"),
    player: get("player", "USA"),
    maxTokens: Number(get("max-tokens", "4096")),
    out: get("out", ""),
    retry: !argv.includes("--no-retry"),
    noThink: argv.includes("--no-think"),
    style: argv.includes("--style"),
  };
}

/** Категории поломок — то, ЧЕМ именно ответ не прошёл, а не только факт провала. */
type BreakKind =
  | "invalid_json"
  | "envelope"
  | "action_schema"
  | "primitive_schema"
  | "truncated"
  | "empty_response"
  | "http_error";

interface RunResult {
  index: number;
  ok: boolean;
  breaks: { kind: BreakKind; detail: string }[];
  /** Семантика, НЕ схема: id существует, домен есть у страны и т.п. */
  applicabilityFailures: string[];
  promptTokens: number;
  completionTokens: number;
  ttftMs: number;
  totalMs: number;
  finishReason: string;
  reasoningChars: number;
  retriedOk?: boolean;
  descriptions?: string;
  rawHead?: string;
}

interface StreamOutcome {
  text: string;
  ttftMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  /**
   * Символы, ушедшие в `reasoning_content`. Qwen3.5/3.6 — гибридные reasoning-
   * модели, и размышление занимает БОЛЬШУЮ часть хода, но в ответ не попадает.
   * Без отдельного учёта оно неотличимо от медленной обработки промта.
   */
  reasoningChars: number;
}

/**
 * Один стриминговый запрос. Стрим нужен не ради UX, а ради TTFT: время до
 * первого токена — единственный способ отделить обработку промта (~8-10k
 * токенов, для нас дороже генерации) от собственно генерации.
 */
async function ask(
  args: Args,
  messages: { role: string; content: string }[],
  schema: Record<string, unknown> | null
): Promise<StreamOutcome> {
  const body: Record<string, unknown> = {
    model: args.model,
    messages,
    temperature: 0.7,
    max_tokens: args.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  // Замерено на LM Studio 0.4.20 + Qwen3.5-9B: из шести способов погасить
  // reasoning работает только этот. `chat_template_kwargs.enable_thinking`
  // ((документированный способ Qwen) и `/no_think` в тексте промта модель
  // игнорирует — размышление остаётся полным.
  if (args.noThink) body.reasoning_effort = "none";
  if (schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "geopolis_turn", strict: true, schema },
    };
  }

  const started = Date.now();
  const res = await fetch(`${args.base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";
  let ttftMs = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let finishReason = "";
  let reasoningChars = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      // TTFT считается по ПЕРВОМУ токену любого рода. Если считать его по
      // первому `content`, у reasoning-модели в TTFT попадает всё размышление,
      // и «обработка промта» показывает десятки секунд там, где промт
      // обработан за одну — метрика мерила бы не то, что названа.
      const reasoning = chunk.choices?.[0]?.delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (ttftMs === 0) ttftMs = Date.now() - started;
        reasoningChars += reasoning.length;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        if (ttftMs === 0) ttftMs = Date.now() - started;
        text += delta;
      }
      const reason = chunk.choices?.[0]?.finish_reason;
      if (typeof reason === "string" && reason) finishReason = reason;
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
        completionTokens = chunk.usage.completion_tokens ?? completionTokens;
      }
    }
  }

  return {
    text,
    ttftMs,
    totalMs: Date.now() - started,
    promptTokens,
    completionTokens,
    finishReason,
    reasoningChars,
  };
}

/**
 * Цепочка проверок `processResponse` без мутации. `game` передаётся, потому что
 * применимость (страна существует, домен есть) знает о конкретной партии —
 * схема этого знать не может.
 */
function validate(
  raw: string,
  game: GameState
): { breaks: { kind: BreakKind; detail: string }[]; applicability: string[]; descriptions?: string } {
  const breaks: { kind: BreakKind; detail: string }[] = [];
  const applicability: string[] = [];

  if (raw.trim().length === 0) {
    return { breaks: [{ kind: "empty_response", detail: "empty" }], applicability };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      breaks: [{ kind: "invalid_json", detail: (e as Error).message.slice(0, 160) }],
      applicability,
    };
  }

  const envelope = LLMResponseEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    return {
      breaks: [
        { kind: "envelope", detail: envelope.error.issues[0]?.message ?? "invalid envelope" },
      ],
      applicability,
    };
  }

  const { descriptions, actions, primitives } = envelope.data;
  const validator = new LLMResponseValidator(game);

  actions.forEach((rawAction, i) => {
    const action = LLMActionSchema.safeParse(rawAction);
    if (!action.success) {
      breaks.push({
        kind: "action_schema",
        detail: `actions[${i}]: ${action.error.issues
          .map(issue => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
          .slice(0, 200)}`,
      });
      return;
    }
    const applicable = validator.validateActionApplicability(action.data);
    if (!applicable.valid) applicability.push(`actions[${i}]: ${applicable.error}`);
  });

  if (primitives !== undefined) {
    const { invalid } = parsePrimitives(primitives);
    for (const bad of invalid) {
      breaks.push({
        kind: "primitive_schema",
        detail: `primitives[${bad.index}]: ${bad.reason}`.slice(0, 200),
      });
    }
  }

  return { breaks, applicability, descriptions };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Фиксированный сид: сид уходит в разброс aiTraits, а тот — в промт. Без
  // фиксации каждый ЗАПУСК скрипта мерил бы слегка другой промт, и сравнение
  // двух моделей между запусками перестало бы быть сравнением.
  const game = createGame("1946", args.player, "ru", 19460101);
  const { prompt } = new LLMService(game).generatePrompt();

  const schema = args.mode === "schema" ? (z.toJSONSchema(GeminiResponseSchema) as Record<string, unknown>) : null;

  console.log(`model=${args.model} mode=${args.mode} runs=${args.runs} player=${args.player}`);
  console.log(`prompt chars=${prompt.length} (~${Math.round(prompt.length / 3.2)} tok est)`);

  const results: RunResult[] = [];

  for (let i = 0; i < args.runs; i++) {
    let outcome: StreamOutcome;
    try {
      outcome = await ask(
        args,
        args.style
          ? [
              { role: "user", content: prompt },
              { role: "user", content: STYLE_HINT },
            ]
          : [{ role: "user", content: prompt }],
        schema
      );
    } catch (e) {
      results.push({
        index: i,
        ok: false,
        breaks: [{ kind: "http_error", detail: (e as Error).message.slice(0, 300) }],
        applicabilityFailures: [],
        promptTokens: 0,
        completionTokens: 0,
        ttftMs: 0,
        totalMs: 0,
        finishReason: "error",
        reasoningChars: 0,
      });
      console.log(`  run ${i}: HTTP ERROR ${(e as Error).message.slice(0, 120)}`);
      continue;
    }

    const { breaks, applicability, descriptions } = validate(outcome.text, game);
    if (outcome.finishReason === "length") {
      breaks.push({ kind: "truncated", detail: "finish_reason=length" });
    }

    const result: RunResult = {
      index: i,
      ok: breaks.length === 0,
      breaks,
      applicabilityFailures: applicability,
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      ttftMs: outcome.ttftMs,
      totalMs: outcome.totalMs,
      finishReason: outcome.finishReason,
      reasoningChars: outcome.reasoningChars,
      ...(descriptions ? { descriptions: descriptions.slice(0, 1200) } : {}),
      ...(breaks.length > 0 ? { rawHead: outcome.text.slice(0, 600) } : {}),
    };

    // Один корректирующий ретрай — ровно то, что делал бы провайдер-слой:
    // модель получает свой ответ и причину отказа, а не переспрашивается вслепую.
    if (!result.ok && args.retry) {
      try {
        const retry = await ask(
          args,
          [
            { role: "user", content: prompt },
            { role: "assistant", content: outcome.text.slice(0, 8000) },
            {
              role: "user",
              content: `Your previous response was rejected: ${breaks
                .map(b => `${b.kind}: ${b.detail}`)
                .join(" | ")}. Return ONLY the corrected JSON object, nothing else.`,
            },
          ],
          schema
        );
        result.retriedOk = validate(retry.text, game).breaks.length === 0;
      } catch {
        result.retriedOk = false;
      }
    }

    results.push(result);
    const promptTps = result.ttftMs > 0 ? (result.promptTokens / (result.ttftMs / 1000)).toFixed(0) : "?";
    const genTps =
      result.totalMs > result.ttftMs
        ? (result.completionTokens / ((result.totalMs - result.ttftMs) / 1000)).toFixed(1)
        : "?";
    console.log(
      `  run ${i}: ${result.ok ? "OK " : "FAIL"} ` +
        `p=${result.promptTokens} c=${result.completionTokens} ` +
        `think=${result.reasoningChars}ch ` +
        `ttft=${result.ttftMs}ms total=${(result.totalMs / 1000).toFixed(1)}s ` +
        `peval=${promptTps}t/s gen=${genTps}t/s` +
        (result.ok ? "" : ` [${result.breaks.map(b => b.kind).join(",")}]`)
    );
  }

  const usable = results.filter(r => r.promptTokens > 0);
  const okCount = results.filter(r => r.ok).length;
  const afterRetry = results.filter(r => r.ok || r.retriedOk).length;
  const avg = (nums: number[]): number =>
    nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;

  const summary = {
    model: args.model,
    mode: args.mode,
    runs: args.runs,
    promptChars: prompt.length,
    promptTokens: usable[0]?.promptTokens ?? 0,
    schemaValidFirstTry: `${okCount}/${results.length}`,
    schemaValidAfterOneRetry: `${afterRetry}/${results.length}`,
    avgTtftMs: Math.round(avg(usable.map(r => r.ttftMs))),
    avgTotalSec: Number(avg(usable.map(r => r.totalMs / 1000)).toFixed(1)),
    avgPromptEvalTps: Math.round(avg(usable.filter(r => r.ttftMs > 0).map(r => r.promptTokens / (r.ttftMs / 1000)))),
    avgGenTps: Number(
      avg(
        usable
          .filter(r => r.totalMs > r.ttftMs)
          .map(r => r.completionTokens / ((r.totalMs - r.ttftMs) / 1000))
      ).toFixed(1)
    ),
    avgCompletionTokens: Math.round(avg(usable.map(r => r.completionTokens))),
    avgReasoningChars: Math.round(avg(usable.map(r => r.reasoningChars))),
    thinkingDisabled: args.noThink,
    breakKinds: results
      .flatMap(r => r.breaks.map(b => b.kind))
      .reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {}),
    applicabilityFailures: results.flatMap(r => r.applicabilityFailures),
  };

  console.log("\n" + JSON.stringify(summary, null, 2));

  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ summary, results }, null, 2), "utf8");
    console.log(`\nwritten: ${args.out}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
