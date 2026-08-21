#!/usr/bin/env node
/**
 * test-role-guard.mjs — живой тест хука ролей.
 *
 * Запуск: node scripts/hooks/test-role-guard.mjs
 *
 * Хук нельзя проверить чтением: он общается с Claude Code через stdin/stdout и
 * код возврата. Тест подаёт настоящие события и проверяет наблюдаемое поведение
 * (exit 2 = блокировка, exit 0 = пропуск, additionalContext = инъекция).
 *
 * Негативный контроль встроен: те же вызовы БЕЗ активной роли обязаны
 * проходить. Тест, который не умеет падать, покрытием не считается — поэтому
 * каждая блокирующая проверка имеет пару-разрешение.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "role-guard.mjs");
const REPO = path.resolve(HERE, "..", "..");
const SESSION = "test-role-guard-session";
const STATE = path.join(
  os.homedir(),
  ".claude",
  "geopolis-roles",
  `${SESSION}.json`
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
  return {
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

const prompt = (text) => run({ hook_event_name: "UserPromptSubmit", prompt: text });
const edit = (file, extra = {}) =>
  run({
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: file },
    ...extra,
  });
const bash = (command) =>
  run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

const context = (res) => {
  try {
    return JSON.parse(res.stdout).hookSpecificOutput?.additionalContext ?? "";
  } catch {
    return "";
  }
};

const CODE_FILE = path.join(REPO, "client", "src", "App.tsx");
const LEDGER_FILE = path.join(REPO, ".agent", "orchestration", "geometry.md");

try {
  fs.rmSync(STATE, { force: true });

  console.log("Негативный контроль — без роли хук не вмешивается:");
  check(edit(CODE_FILE).code === 0, "правка кода разрешена");
  check(bash("git merge main").code === 0, "git merge разрешён");
  check(bash("gh pr merge 1 --merge").code === 0, "gh pr merge разрешён");
  check(prompt("обычный вопрос").stdout.trim() === "", "инъекции в контекст нет");

  console.log("Назначение роли:");
  const assigned = prompt("!роль geometry");
  check(assigned.code === 0, "команда принята");
  check(fs.existsSync(STATE), "состояние сессии записано");
  check(
    context(assigned).includes("РОЛЬ НАЗНАЧЕНА: geometry"),
    "устав отдан модели"
  );
  check(
    context(assigned).includes("Полигоны не правишь"),
    "в контекст попал текст устава, а не только имя роли"
  );

  console.log("Роль активна — блокировки:");
  const denied = edit(CODE_FILE);
  check(denied.code === 2, "правка кода заблокирована", `exit ${denied.code}`);
  check(
    denied.stderr.includes("Оркестратор не исполняет"),
    "причина названа ролью, а не общим запретом"
  );
  check(bash("git merge claude/foo").code === 2, "git merge заблокирован доменной роли");
  check(
    bash("gh pr merge 12 --squash").code === 2,
    "gh pr merge заблокирован доменной роли"
  );

  console.log("Роль активна — что остаётся разрешённым:");
  check(edit(LEDGER_FILE).code === 0, "реестр .agent/orchestration пишется");
  check(edit(path.join(REPO, "docs", "MAP_FEATURES.md")).code === 0, "docs/ пишется");
  check(
    edit(path.join(os.tmpdir(), "scratch.txt")).code === 0,
    "файл вне репозитория пишется"
  );
  check(bash("npm test").code === 0, "проверки запускаются");

  console.log("Раздача — исполнитель работает, оркестратор нет:");
  const executor = { agent_id: "sub-42", agent_type: "general-purpose" };
  check(edit(CODE_FILE, executor).code === 0, "субагент-исполнитель правит код");
  check(edit(CODE_FILE).code === 2, "главный поток роли — по-прежнему нет");

  console.log("Якорь на каждом ходу:");
  const anchored = context(prompt("что дальше?"));
  check(anchored.includes("[РОЛЬ: geometry]"), "роль напоминается");
  check(anchored.includes("Ты оркестратор геометрии"), "секция «Якорь» подставлена");
  check(anchored.includes(".agent/orchestration/geometry.md"), "состояние реестра показано");
  check(anchored.length < 1200, "якорь компактный", `${anchored.length} символов`);

  console.log("Роль integrator:");
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ role: "integrator", cwd: REPO }), "utf8");
  check(bash("git merge claude/foo").code === 0, "интегратору merge разрешён");
  check(bash("gh pr merge 12 --squash").code === 0, "интегратору gh pr merge разрешён");
  check(edit(CODE_FILE).code === 2, "правка кода всё равно заблокирована");

  console.log("Снятие роли:");
  const off = prompt("!роль -");
  check(!fs.existsSync(STATE), "состояние удалено");
  check(context(off).includes("Роль снята"), "модель уведомлена");
  check(edit(CODE_FILE).code === 0, "правки снова разрешены");

  console.log("Неизвестная роль:");
  const unknown = prompt("!роль нет-такой");
  check(!fs.existsSync(STATE), "состояние не записано");
  check(context(unknown).includes("Доступные"), "показан список ролей");
} finally {
  fs.rmSync(STATE, { force: true });
}

console.log(failed === 0 ? "\nrole-guard: все проверки прошли" : `\nrole-guard: ${failed} провалено`);
process.exit(failed === 0 ? 0 : 1);
