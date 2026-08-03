/**
 * Замер локальной LLM на РЕАЛЬНОМ промте хода Geopolis — не на синтетике.
 *
 * Промт берётся у `LLMService.generatePrompt()` на игре, созданной
 * `createGame("1946", ...)` с фиксированным сидом, а ответ проверяется ровно той
 * цепочкой, что стоит в `LLMService.processResponse()`:
 *   JSON.parse -> LLMResponseEnvelopeSchema -> parsePrimitives (по каждому
 *   примитиву отдельно).
 * Совпадение с боевым путём — единственная причина верить измеренной доле
 * схема-валидных ответов; своя упрощённая проверка мерила бы другую величину.
 *
 * Скрипт НИЧЕГО не применяет к состоянию: `processResponse` мутирует игру и
 * инкрементирует `llmTurn`, поэтому здесь повторяется его цепочка ПРОВЕРОК, а
 * не он сам — иначе каждый прогон стартовал бы с другого состояния и промты
 * прогонов отличались бы друг от друга.
 *
 * Запуск (из server/):
 *   npx tsx scripts/benchLocalModels.ts --model <id> --runs 10
 *
 * Оси замера независимы и сосуществуют, потому что вопрос «как просить JSON»
 * не сводится к одному переключателю (замер:
 * `.agent/runs/gemini-prompt-modes-2026-08-01/`):
 *   --mode      способ запроса формата: schema | schema-loose | json-object | free
 *   --hint      инструкция «только JSON» в конце промта: none | full | terse
 *   --reasoning значение reasoning_effort (не задано — параметр не отправляется)
 *
 * Умолчания (`--mode free --hint full`) повторяют боевую конфигурацию
 * провайдера. Сравнивать режимы по доле схема-валидных ответов БЕСПОЛЕЗНО:
 * markdown-забор снимает `stripCodeFence` до валидации, и все режимы выглядят
 * одинаково успешными. Различает их `fencedResponses` — доля ответов, пришедших
 * в заборе.
 */
// Первым: подхватывает server/.env до чтения любых переменных.
import "./loadEnv";
import { writeFileSync } from "fs";
import { z } from "zod";
import { createGame } from "../src/game/CreateGame";
import { LLMService } from "../src/services/LLMService";
import {
  LLMResponseEnvelopeSchema,
  ProviderResponseSchema,
} from "../src/llm/responseSchemas";
import { parsePrimitives } from "../src/primitives/primitiveSchemas";
import { type GameState } from "@shared/types/GameState";
import { localBaseUrl, localHeaders } from "../src/llm/providers/localEndpoint";
import { stripCodeFence } from "../src/llm/stripCodeFence";
import { JSON_ONLY_INSTRUCTION, withJsonOnlyInstruction } from "../src/llm/jsonOnlyInstruction";

/**
 * Способ, которым у модели просят структурный ответ. Режимы сосуществуют,
 * потому что сравнивать их можно только в один заход на одном промте: шлюз
 * `json_schema` со `strict: true` ПРИНИМАЕТ, но не обязан применять, и по
 * отправленному телу запроса о фактическом поведении сказать нечего.
 */
type Mode =
  /** `json_schema` + `strict: true` — как в боевом провайдере до этого замера. */
  | "schema"
  /** Та же схема, `strict: false` — стоит ли строгость чего-нибудь на этом шлюзе. */
  | "schema-loose"
  /** `json_object` — свободный JSON-режим OpenAI, без схемы. */
  | "json-object"
  /** Никакого `response_format`: формат держит только промт. */
  | "free";

const MODES: Mode[] = ["schema", "schema-loose", "json-object", "free"];

/** Инструкция «только JSON» в конце промта. `terse` — проверка чувствительности к формулировке. */
type Hint = "none" | "full" | "terse";
const HINTS: Hint[] = ["none", "full", "terse"];

/**
 * Короткая формулировка той же инструкции. Нужна не как вторая кандидатура на
 * умолчание, а как замер чувствительности: если результат от длины текста не
 * зависит, то дело в самом факте запрета, а не в удачных словах.
 */
const TERSE_HINT = `Return only the JSON object: no code fence, no text before or after it.`;

interface Args {
  model: string;
  runs: number;
  mode: Mode;
  hint: Hint;
  /** Значение `reasoning_effort`; пустая строка — параметр не отправляется вовсе. */
  reasoning: string;
  base: string;
  player: string;
  maxTokens: number;
  out: string;
  retry: boolean;
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
  // Умолчания повторяют БОЕВУЮ конфигурацию `LocalOpenAIProvider`
  // (`LOCAL_LLM_RESPONSE_FORMAT=prompt`): запуск без флагов должен мерить то,
  // чем ходит игра, иначе замер по умолчанию описывает режим, которого в игре нет.
  const mode = get("mode", "free") as Mode;
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join("|")}`);
  const hint = get("hint", "full") as Hint;
  if (!HINTS.includes(hint)) throw new Error(`--hint must be one of ${HINTS.join("|")}`);
  // `--no-think` оставлен как псевдоним: на него ссылаются прошлые прогоны в
  // `.agent/runs/`, и переименование сделало бы их команды невоспроизводимыми.
  const reasoning = argv.includes("--no-think") ? "none" : get("reasoning", "");
  return {
    model: get("model"),
    runs: Number(get("runs", "10")),
    mode,
    hint,
    reasoning,
    // Дефолт — из LOCAL_LLM_BASE_URL, а не из литерала: иначе замер молча
    // ходил бы не на тот эндпоинт, что боевой провайдер.
    base: get("base", localBaseUrl()),
    player: get("player", "USA"),
    maxTokens: Number(get("max-tokens", "4096")),
    out: get("out", ""),
    retry: !argv.includes("--no-retry"),
    style: argv.includes("--style"),
  };
}

/** Промт хода плюс выбранная инструкция о формате — одним куском, как его увидит модель. */
function promptWithHint(prompt: string, hint: Hint): string {
  if (hint === "none") return prompt;
  if (hint === "full") return withJsonOnlyInstruction(prompt);
  return `${prompt.replace(/\s+$/, "")}\n\n${TERSE_HINT}\n`;
}

/** Категории поломок — то, ЧЕМ именно ответ не прошёл, а не только факт провала. */
type BreakKind =
  | "invalid_json"
  | "envelope"
  /** Ответ пришёл с массивом `actions` — каналом, которого больше нет. */
  | "legacy_actions"
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
  title?: string;
  rawHead?: string;
  /**
   * СЫРАЯ форма ответа — до `stripCodeFence`. Без неё режимы неразличимы:
   * забор снимается ДО валидации, поэтому `schemaValidFirstTry` показывает
   * 10/10 и там, где модель каждый раз оборачивает ответ в ```` ```json ````.
   * Именно эту привычку и должен был давить `response_format`, значит мерить
   * его пользу надо здесь, а не по доле принятых ответов.
   */
  rawShape: RawShape;
}

interface RawShape {
  /** Ответ пришёл в markdown-заборе (его снял `stripCodeFence`). */
  fenced: boolean;
  /** После снятия забора текст всё ещё не голый JSON-объект: есть проза вокруг. */
  strayText: boolean;
  /** Первые знаки сырого ответа — чтобы «забор» не приходилось принимать на слово. */
  head: string;
}

function describeRaw(raw: string): RawShape {
  const stripped = stripCodeFence(raw);
  const trimmed = stripped.trim();
  return {
    fenced: stripped !== raw,
    strayText: !(trimmed.startsWith("{") && trimmed.endsWith("}")),
    head: raw.slice(0, 40),
  };
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
  // игнорирует — размышление остаётся полным. Пустая строка означает «параметр
  // не отправлять»: «не задан» и «задан как none» — разные запросы, и их
  // различие само по себе предмет замера.
  if (args.reasoning) body.reasoning_effort = args.reasoning;
  if (args.mode === "schema" || args.mode === "schema-loose") {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "geopolis_turn", strict: args.mode === "schema", schema },
    };
  } else if (args.mode === "json-object") {
    body.response_format = { type: "json_object" };
  }

  const started = Date.now();
  // Заголовки — общие с провайдером (`localEndpoint.ts`): здесь стоял свой
  // `Content-Type` без `Authorization`, и против шлюза с ключом замер падал
  // 401 ещё до первого токена.
  const res = await fetch(`${args.base}/chat/completions`, {
    method: "POST",
    headers: localHeaders(),
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
): {
  breaks: { kind: BreakKind; detail: string }[];
  applicability: string[];
  descriptions?: string;
  title?: string;
} {
  const breaks: { kind: BreakKind; detail: string }[] = [];
  const applicability: string[] = [];

  if (raw.trim().length === 0) {
    return { breaks: [{ kind: "empty_response", detail: "empty" }], applicability };
  }

  let parsed: unknown;
  try {
    // Тот же снос забора, что в `LLMService.processResponse`: замер обязан
    // мерить БОЕВОЙ путь, иначе он покажет провалы, которых у игрока нет.
    parsed = JSON.parse(stripCodeFence(raw));
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

  const { descriptions, title, actions, primitives } = envelope.data;

  // Канала `actions` не существует с 2026-08-02. Модель, приславшая массив по
  // памяти о старом контракте, получает отказ — и замер обязан это ВИДЕТЬ:
  // ответ формально валиден, но просит движок о несуществующем.
  if (actions !== undefined && actions.length > 0) {
    breaks.push({
      kind: "legacy_actions",
      detail: `actions[]: ${actions.length} entries in a channel that no longer exists`,
    });
  }

  if (primitives !== undefined) {
    const { invalid } = parsePrimitives(primitives);
    for (const bad of invalid) {
      breaks.push({
        kind: "primitive_schema",
        detail: `primitives[${bad.index}]: ${bad.reason}`.slice(0, 200),
      });
    }
  }

  return { breaks, applicability, descriptions, ...(title ? { title } : {}) };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Фиксированный сид: сид уходит в разброс aiTraits, а тот — в промт. Без
  // фиксации каждый ЗАПУСК скрипта мерил бы слегка другой промт, и сравнение
  // двух моделей между запусками перестало бы быть сравнением.
  const game = createGame("1946", args.player, "ru", 19460101);
  // `generatePrompt()` не переписан: инструкция о формате дописывается снаружи
  // отдельным куском, поэтому «промт хода» во всех режимах остаётся один и тот
  // же и режимы сравнимы между собой.
  const { prompt: turnPrompt } = new LLMService(game).generatePrompt();
  const prompt = promptWithHint(turnPrompt, args.hint);

  const schema =
    args.mode === "schema" || args.mode === "schema-loose"
      ? (z.toJSONSchema(ProviderResponseSchema) as Record<string, unknown>)
      : null;

  console.log(
    `model=${args.model} mode=${args.mode} hint=${args.hint} ` +
      `reasoning=${args.reasoning || "(unset)"} runs=${args.runs} player=${args.player}`
  );
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
        rawShape: { fenced: false, strayText: true, head: "" },
      });
      console.log(`  run ${i}: HTTP ERROR ${(e as Error).message.slice(0, 120)}`);
      continue;
    }

    const { breaks, applicability, descriptions, title } = validate(outcome.text, game);
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
      rawShape: describeRaw(outcome.text),
      // Нарратив пишется ЦЕЛИКОМ, не первыми 1200 знаками: обрезанный текст
      // годится для «поле присутствует», но не для чтения глазами, а качество
      // прозы — половина того, ради чего режимы сравниваются.
      ...(descriptions ? { descriptions } : {}),
      ...(title ? { title } : {}),
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
    hint: args.hint,
    // Текст инструкции — в самом прогоне: без него файл через месяц не
    // отличить от прогона с другой формулировкой, а формулировка тут переменная.
    hintText: args.hint === "none" ? null : args.hint === "full" ? JSON_ONLY_INSTRUCTION : TERSE_HINT,
    reasoning: args.reasoning || null,
    runs: args.runs,
    promptChars: prompt.length,
    promptTokens: usable[0]?.promptTokens ?? 0,
    schemaValidFirstTry: `${okCount}/${results.length}`,
    schemaValidAfterOneRetry: `${afterRetry}/${results.length}`,
    // Доля ответов в markdown-заборе — ЕДИНСТВЕННАЯ метрика, по которой видно
    // разницу между способами запроса формата: после `stripCodeFence` забор
    // на схема-валидность уже не влияет, и все режимы выглядят одинаково.
    fencedResponses: `${usable.filter(r => r.rawShape.fenced).length}/${usable.length}`,
    strayTextResponses: `${usable.filter(r => r.rawShape.strayText).length}/${usable.length}`,
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
