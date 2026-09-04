#!/usr/bin/env node
/**
 * session-guard.mjs — переживание сжатия контекста (Claude Code, Geopolis).
 *
 * `AGENTS.md` требует `session-handoff` после сжатия контекста. Это правило
 * записано только текстом — и гибнет ровно в тот момент, когда должно
 * сработать: сводка сжатия теряет нюансы и отрицательные инструкции. Замер по
 * 8 сессиям: сессия `a45886e9` стартовала уже после исчерпания контекста и шла
 * дальше 58 промтов, ни разу не вызвав handoff.
 *
 * Тот же приём, что в `role-guard.mjs`, применённый к состоянию сессии:
 *
 *   PreCompact    — ПЕРЕД сжатием снять срез (ветка, дерево, изменённые файлы)
 *                   и положить его вне репозитория. Сжатие не блокируется.
 *   SessionStart  — при старте с `source` = compact | resume вернуть якорь в
 *                   контекст: контракт проверок, срез и требование handoff.
 *                   Claude Code добавляет вывод SessionStart в контекст модели.
 *
 * Состояние — `~/.claude/geopolis-handoffs/<session>.md`, как и роли: оно
 * session-local, в git ему делать нечего, а запись внутрь основного checkout
 * заблокировал бы `guard.mjs`.
 *
 * Fail-open, как guard.mjs и role-guard.mjs: внутренняя ошибка хука НЕ
 * блокирует работу и не роняет сессию.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const STATE_DIR = path.join(os.homedir(), ".claude", "geopolis-handoffs");

const statePath = (sessionId) =>
  path.join(STATE_DIR, `${String(sessionId).replace(/[^\w.-]/g, "_")}.md`);

/** Короткий git-запрос; пустая строка вместо исключения. */
function git(cwd, args) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** Контракт проверок — единственное место, где он продублирован намеренно:
 *  якорь должен нести его сам, иначе после сжатия он неизвестен. */
const VERIFY_CONTRACT = [
  "client: npx tsc --noEmit -p tsconfig.app.json | npm test | npm run lint",
  "server: npx tsc --noEmit -p tsconfig.json | npm test",
  "данные: python scripts/map/validate_region_economy_1946.py (+ его тест)",
  "агент-конфиг и docs: python .agent/evals/public/run_public_evals.py",
].join("\n  ");

function handlePreCompact(evt) {
  const sessionId = evt.session_id ?? evt.sessionId ?? "default";
  const cwd = String(evt.cwd ?? process.cwd());

  const branch = git(cwd, "rev-parse --abbrev-ref HEAD") || "(вне git)";
  const root = git(cwd, "rev-parse --show-toplevel") || cwd;
  const status = git(cwd, "status --porcelain");
  const changed = status ? status.split("\n").slice(0, 40) : [];
  const commits = git(cwd, "log --oneline -5");

  const body = [
    `# Срез перед сжатием контекста`,
    ``,
    `Снят автоматически хуком \`session-guard.mjs\`. Триггер: ${evt.trigger ?? evt.matcher ?? "auto"}.`,
    ``,
    `- Ветка: \`${branch}\``,
    `- Дерево: \`${root}\``,
    `- Изменённых файлов: ${changed.length}${status ? "" : " (рабочее дерево чисто)"}`,
    ``,
    changed.length ? "## Изменённые файлы\n\n```\n" + changed.join("\n") + "\n```" : "",
    ``,
    commits ? "## Последние коммиты\n\n```\n" + commits + "\n```" : "",
    ``,
    `## Что сжатие обязано было сохранить`,
    ``,
    `Команды проверок и их ПОСЛЕДНИЙ результат, baseline-failures, критерии`,
    `приёмки. Если после сжатия их в контексте нет — не додумывай: перезапусти`,
    `нужные проверки прежде, чем что-либо утверждать.`,
    ``,
  ].join("\n");

  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(sessionId), body, "utf8");
  } catch {
    /* fail-open: срез не критичен для работы */
  }

  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      systemMessage: `session-guard: срез перед сжатием снят (ветка ${branch}, изменённых файлов ${changed.length})`,
    })
  );
  process.exit(0);
}

function handleSessionStart(evt) {
  const source = String(evt.source ?? evt.matcher ?? "");
  // Обычный старт якоря не требует: инструкции ещё свежие.
  if (source !== "compact" && source !== "resume") process.exit(0);

  const sessionId = evt.session_id ?? evt.sessionId ?? "default";
  const cwd = String(evt.cwd ?? process.cwd());

  let snapshot = "";
  try {
    snapshot = fs.readFileSync(statePath(sessionId), "utf8");
  } catch {
    /* среза нет — якорь всё равно нужен */
  }

  const branch = git(cwd, "rev-parse --abbrev-ref HEAD") || "(вне git)";
  const isCompact = source === "compact";

  const anchor = [
    `[ЯКОРЬ СЕССИИ: старт после ${isCompact ? "СЖАТИЯ КОНТЕКСТА" : "возобновления"}]`,
    ``,
    `Сводка сжатия теряет нюансы и отрицательные инструкции. Считай, что всё,`,
    `чего нет в тексте ниже, ты НЕ проверял в этой сессии.`,
    ``,
    `Ветка сейчас: ${branch}`,
    ``,
    `Контракт проверок (Geopolis, AGENTS.md «Проверка»):`,
    `  ${VERIFY_CONTRACT}`,
    ``,
    `Не называй проверку успешной без запуска и просмотра вывода. Число,`,
    `названное до сжатия, в этой сессии не измерено — перемеряй или пометь UNKNOWN.`,
    ``,
    isCompact
      ? `После сжатия контекста AGENTS.md требует скилл \`session-handoff\`. Выполни его прежде, чем продолжать задачу.`
      : `Сессия возобновлена: сверь состояние дерева и последний результат проверок, прежде чем продолжать.`,
    snapshot ? `\n--- срез, снятый перед сжатием ---\n${snapshot}` : `\n(среза перед сжатием нет — он снимается хуком PreCompact)`,
  ].join("\n");

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: anchor,
      },
      suppressOutput: true,
      systemMessage: `session-guard: якорь возвращён (${source})`,
    })
  );
  process.exit(0);
}

try {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    /* нет stdin — нечего делать */
  }
  if (!raw.trim()) process.exit(0);
  const evt = JSON.parse(raw);
  const event = String(evt.hook_event_name ?? evt.hookEventName ?? "");

  if (event === "PreCompact") handlePreCompact(evt);
  else if (event === "SessionStart") handleSessionStart(evt);
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
