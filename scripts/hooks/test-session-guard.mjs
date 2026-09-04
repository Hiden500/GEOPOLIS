#!/usr/bin/env node
/**
 * test-session-guard.mjs — живой тест хука выживания после сжатия.
 *
 * Запуск: node scripts/hooks/test-session-guard.mjs
 *
 * Хук нельзя проверить чтением: он общается с Claude Code через stdin/stdout.
 * Тест подаёт настоящие события и смотрит наблюдаемое поведение.
 *
 * Негативный контроль встроен и обязателен: хук, который вставляет якорь на
 * КАЖДОМ старте, засоряет каждую сессию и делает якорь фоном, который перестают
 * читать. Поэтому проверка «на обычном старте молчит» здесь такая же
 * первоклассная, как «после сжатия говорит». Тест, не умеющий падать, покрытием
 * не считается.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "session-guard.mjs");
const REPO = path.resolve(HERE, "..", "..");
const SESSION = "test-session-guard-session";
const STATE = path.join(
  os.homedir(),
  ".claude",
  "geopolis-handoffs",
  `${SESSION}.md`
);

let failed = 0;
const check = (ok, name, detail = "") => {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

function run(event) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: SESSION, cwd: REPO, ...event }),
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const parse = (out) => {
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
};
const contextOf = (res) =>
  parse(res.stdout)?.hookSpecificOutput?.additionalContext ?? "";

const cleanup = () => {
  try {
    fs.unlinkSync(STATE);
  } catch {
    /* уже нет */
  }
};

cleanup();

console.log("session-guard: SessionStart без среза");
{
  const res = run({ hook_event_name: "SessionStart", source: "compact" });
  const ctx = contextOf(res);
  check(res.code === 0, "не блокирует старт");
  check(ctx.includes("ЯКОРЬ СЕССИИ"), "якорь возвращён и без среза");
  check(ctx.includes("среза перед сжатием нет"), "отсутствие среза названо явно");
}

console.log("session-guard: PreCompact снимает срез");
{
  const res = run({ hook_event_name: "PreCompact", trigger: "auto" });
  check(res.code === 0, "сжатие не блокируется");
  check(fs.existsSync(STATE), "файл среза создан");
  const body = fs.existsSync(STATE) ? fs.readFileSync(STATE, "utf8") : "";
  check(body.includes("Срез перед сжатием"), "срез содержит заголовок");
  check(/Ветка: `/.test(body), "срез называет ветку");
  check(
    body.includes("Команды проверок и их ПОСЛЕДНИЙ результат"),
    "срез напоминает, что обязано пережить сжатие"
  );
}

console.log("session-guard: SessionStart после сжатия");
{
  const res = run({ hook_event_name: "SessionStart", source: "compact" });
  const ctx = contextOf(res);
  check(res.code === 0, "не блокирует старт");
  check(ctx.includes("ЯКОРЬ СЕССИИ"), "якорь возвращён");
  check(ctx.includes("СЖАТИЯ КОНТЕКСТА"), "причина старта названа");
  check(ctx.includes("run_public_evals.py"), "контракт проверок в якоре");
  check(ctx.includes("npx tsc --noEmit"), "команды typecheck в якоре");
  check(ctx.includes("session-handoff"), "handoff затребован");
  check(ctx.includes("Срез перед сжатием"), "срез подклеен к якорю");
  check(
    ctx.includes("не измерено") || ctx.includes("UNKNOWN"),
    "якорь запрещает выдавать досжатые числа за измеренные"
  );
}

console.log("session-guard: SessionStart при возобновлении");
{
  const res = run({ hook_event_name: "SessionStart", source: "resume" });
  const ctx = contextOf(res);
  check(ctx.includes("ЯКОРЬ СЕССИИ"), "якорь возвращён и на resume");
  check(
    !ctx.includes("После сжатия контекста AGENTS.md требует"),
    "handoff не требуется без сжатия"
  );
}

console.log("session-guard: НЕГАТИВНЫЙ КОНТРОЛЬ — обычный старт");
{
  for (const source of ["startup", "clear", "fork"]) {
    const res = run({ hook_event_name: "SessionStart", source });
    check(res.code === 0, `${source}: не блокирует`);
    check(
      contextOf(res) === "",
      `${source}: якорь НЕ вставляется`,
      `получено: ${res.stdout.slice(0, 80)}`
    );
  }
}

console.log("session-guard: НЕГАТИВНЫЙ КОНТРОЛЬ — fail-open");
{
  const res = spawnSync(process.execPath, [HOOK], {
    input: "не json вовсе",
    encoding: "utf8",
  });
  check(res.status === 0, "битый вход не роняет сессию");

  const empty = spawnSync(process.execPath, [HOOK], { input: "", encoding: "utf8" });
  check(empty.status === 0, "пустой вход не роняет сессию");

  const other = run({ hook_event_name: "PreToolUse", tool_name: "Write" });
  check(other.code === 0, "чужое событие пропускается");
  check(other.stdout === "", "на чужое событие хук молчит");
}

cleanup();

console.log(failed === 0 ? "\nPASS: session-guard" : `\nFAIL: ${failed} проверок`);
process.exit(failed === 0 ? 0 : 1);
