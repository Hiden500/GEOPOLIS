#!/usr/bin/env node
/**
 * Отчёт о расходе токенов по журналу `logs/token-usage.jsonl`.
 *
 * Зачем отдельный скрипт, а не ручка API: журнал живёт дольше партии и
 * читается между запусками игры — это инструмент разбора, а не игровой
 * функционал. Зависимостей не добавляет (stdlib Node), как и остальные
 * скрипты репозитория.
 *
 * Запуск из корня:
 *   node scripts/token-usage-report.mjs
 *   node scripts/token-usage-report.mjs --log path/to/other.jsonl
 *
 * Разбивка по назначению вызова обязательна, а не косметична: мировой цикл и
 * перевод приказа игрока отличаются по размеру на порядок, и общий перцентиль
 * по ним обоим не описывает ни один из них.
 */
import fs from "fs";
import path from "path";

const DEFAULT_LOG = path.join("logs", "token-usage.jsonl");

function parseArgs(argv) {
  const logIndex = argv.indexOf("--log");
  return { log: logIndex >= 0 ? argv[logIndex + 1] : process.env.TOKEN_USAGE_LOG || DEFAULT_LOG };
}

/** «Ближайший ранг»: бюджет назначается по случившемуся вызову, а не по
 *  интерполяции между двумя, которых не было. */
function percentile(sorted, p) {
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

function describe(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

const { log } = parseArgs(process.argv.slice(2));

let raw;
try {
  raw = fs.readFileSync(log, "utf-8");
} catch {
  console.log(`Журнала нет: ${log}`);
  console.log("Он появится после первого автоматического вызова модели (ручной цикл его не пишет).");
  process.exit(0);
}

const entries = [];
let broken = 0;
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed.totalTokens === "number") entries.push(parsed);
    else broken += 1;
  } catch {
    broken += 1;
  }
}

if (entries.length === 0) {
  console.log(`Журнал ${log} пуст (битых строк: ${broken}).`);
  process.exit(0);
}

const byPurpose = new Map();
for (const e of entries) {
  const key = `${e.purpose ?? "?"} · ${e.model ?? "?"}`;
  if (!byPurpose.has(key)) byPurpose.set(key, []);
  byPurpose.get(key).push(e);
}

const fmt = n => String(n).padStart(7);
console.log(`Журнал: ${log}`);
console.log(`Вызовов: ${entries.length}${broken ? `, битых строк: ${broken}` : ""}`);
console.log(`Период: ${entries[0].at} … ${entries[entries.length - 1].at}`);
console.log();

for (const [key, group] of [...byPurpose].sort((a, b) => b[1].length - a[1].length)) {
  const total = describe(group.map(e => e.totalTokens));
  const prompt = describe(group.map(e => e.promptTokens));
  console.log(`${key} — вызовов ${total.count}`);
  console.log("              min   median      p90      p99      max");
  console.log(
    `  всего  ${fmt(total.min)}  ${fmt(total.median)} ${fmt(total.p90)} ${fmt(total.p99)} ${fmt(total.max)}`
  );
  console.log(
    `  промт  ${fmt(prompt.min)}  ${fmt(prompt.median)} ${fmt(prompt.p90)} ${fmt(prompt.p99)} ${fmt(prompt.max)}`
  );
  const thoughts = group.filter(e => typeof e.thoughtTokens === "number").map(e => e.thoughtTokens);
  if (thoughts.length > 0) {
    const t = describe(thoughts);
    console.log(
      `  мысли  ${fmt(t.min)}  ${fmt(t.median)} ${fmt(t.p90)} ${fmt(t.p99)} ${fmt(t.max)}`
    );
  }
  console.log();
}

// Бюджет промта назван в docs/CONCEPT.md §7; отчёт сопоставляет с ним факт, а
// не пересказывает число.
const PROMPT_BUDGET = 10_000;
const worldCycle = entries.filter(e => e.purpose === "world-cycle");
if (worldCycle.length > 0) {
  const over = worldCycle.filter(e => e.promptTokens > PROMPT_BUDGET).length;
  const p = describe(worldCycle.map(e => e.promptTokens));
  console.log(
    `Промт мирового цикла против бюджета ${PROMPT_BUDGET}: медиана ${p.median}, p99 ${p.p99}, ` +
      `превышений ${over} из ${worldCycle.length}`
  );
}
