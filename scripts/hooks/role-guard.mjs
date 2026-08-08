#!/usr/bin/env node
/**
 * role-guard.mjs — удержание роли оркестратора (Claude Code, Geopolis).
 *
 * Роль, записанная только в тексте, к середине сессии проигрывает свежему
 * контексту и исчезает при сжатии. Хук держит её двумя механизмами:
 *
 *   UserPromptSubmit — назначение/снятие роли командой `!роль <имя>` и
 *     реинъекция якоря роли в контекст КАЖДЫЙ ход. Claude Code добавляет
 *     вывод именно этого события (и SessionStart) в контекст модели, поэтому
 *     роль перечитывается заново на каждом ходу и переживает сжатие.
 *   PreToolUse — пока роль активна, правки кода и данных заблокированы:
 *     оркестратор изучает, проектирует, выдаёт задания и принимает работу,
 *     но не исполняет её сам. Разрешены только `.agent/**` и `docs/**` —
 *     планы, реестры и профильные документы это его собственный выход.
 *
 * Состояние роли лежит ВНЕ репозитория (~/.claude/geopolis-roles/<session>.json):
 * оно session-local, в git ему делать нечего, а запись внутрь основного
 * checkout заблокировал бы guard.mjs. Ключ — session_id, поэтому параллельные
 * сессии держат разные роли одновременно.
 *
 * Fail-open, как guard.mjs: внутренняя ошибка хука НЕ блокирует работу.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const STATE_DIR = path.join(os.homedir(), ".claude", "geopolis-roles");

const norm = (p) => path.resolve(String(p)).replace(/\\/g, "/").toLowerCase();

/** Корень основного checkout: родитель общего .git (как в guard.mjs). */
function mainRootOf(cwd) {
  try {
    const commonDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    return norm(path.dirname(commonDir));
  } catch {
    return "";
  }
}

/**
 * Каталог с уставами. Ищется от cwd вверх, чтобы сессия в linked worktree
 * читала уставы своего дерева, а не основного checkout.
 */
function rolesDirFrom(cwd) {
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, ".agent", "roles");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

const knownRoles = (rolesDir) =>
  rolesDir
    ? fs
        .readdirSync(rolesDir)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => f.slice(0, -3))
        .sort()
    : [];

const statePath = (sessionId) =>
  path.join(STATE_DIR, `${String(sessionId).replace(/[^\w.-]/g, "_")}.json`);

function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return null;
  }
}

/** Секция устава по заголовку, без самого заголовка. */
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** Сколько заданий в реестре роли ждёт исполнения и аудита. */
function ledgerStats(rolesDir, role) {
  if (!rolesDir) return null;
  const file = path.join(path.dirname(rolesDir), "orchestration", `${role}.md`);
  const text = readText(file);
  if (!text) return null;
  const count = (re) => (text.match(re) ?? []).length;
  return {
    issued: count(/^Статус:\s*выдано\s*$/gim),
    audit: count(/^Статус:\s*на аудите\s*$/gim),
    returned: count(/^Статус:\s*возвращено\s*$/gim),
  };
}

function emitContext(text, systemMessage) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: text,
    },
    suppressOutput: true,
  };
  if (systemMessage) payload.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function handlePrompt(evt) {
  const sessionId = evt.session_id ?? evt.sessionId ?? "default";
  const cwd = String(evt.cwd ?? process.cwd());
  const rolesDir = rolesDirFrom(cwd);
  const prompt = String(evt.prompt ?? "");
  const roles = knownRoles(rolesDir);

  // Границу слова (`\b`) здесь использовать нельзя: в JS она определена через
  // латинский `\w`, и после кириллического «роль» не срабатывает. Команда —
  // это весь промт целиком, чтобы `!роль` в середине текста не переключал роль.
  const cmd = prompt.match(/^\s*!\s*(?:роль|role)(?:\s+(\S+))?\s*$/iu);
  if (cmd) {
    const arg = (cmd[1] ?? "").toLowerCase();
    fs.mkdirSync(STATE_DIR, { recursive: true });

    if (!arg || arg === "?") {
      const current = readState(sessionId);
      emitContext(
        `Роли Geopolis. Активная: ${current ? current.role : "нет"}.\n` +
          `Доступные: ${roles.join(", ") || "уставы не найдены"}.\n` +
          `Назначить: \`!роль <имя>\`. Снять: \`!роль -\`.`,
        `Роль: ${current ? current.role : "не назначена"}`
      );
    }

    if (arg === "-" || arg === "off" || arg === "снять") {
      try {
        fs.unlinkSync(statePath(sessionId));
      } catch {
        /* роли и не было */
      }
      emitContext(
        "Роль снята. Сессия работает как обычный исполнитель: правки файлов " +
          "снова разрешены (в пределах guard.mjs и worktree-протокола).",
        "Роль снята"
      );
    }

    if (!roles.includes(arg)) {
      emitContext(
        `Роли «${arg}» нет. Доступные: ${roles.join(", ") || "—"}.\n` +
          `Устав добавляется файлом \`.agent/roles/<имя>.md\`.`,
        `Неизвестная роль: ${arg}`
      );
    }

    fs.writeFileSync(
      statePath(sessionId),
      JSON.stringify({ role: arg, cwd }, null, 2),
      "utf8"
    );
    const charter = readText(path.join(rolesDir, `${arg}.md`));
    emitContext(
      `РОЛЬ НАЗНАЧЕНА: ${arg}. Дальше ты работаешь по этому уставу; ` +
        `правки кода и данных заблокированы хуком до \`!роль -\`.\n\n${charter}`,
      `Роль: ${arg}`
    );
  }

  const state = readState(sessionId);
  if (!state) process.exit(0);

  const charter = readText(path.join(rolesDir, `${state.role}.md`));
  const anchor = section(charter, "## Якорь");
  if (!anchor) process.exit(0);

  const stats = ledgerStats(rolesDir, state.role);
  const ledger = stats
    ? `Реестр .agent/orchestration/${state.role}.md: выдано ${stats.issued}, ` +
      `на аудите ${stats.audit}, возвращено ${stats.returned}.`
    : `Реестр .agent/orchestration/${state.role}.md не заведён — создай при первом задании.`;

  emitContext(`[РОЛЬ: ${state.role}]\n${anchor}\n${ledger}`);
}

function handleTool(evt) {
  const sessionId = evt.session_id ?? evt.sessionId ?? "default";
  const state = readState(sessionId);
  if (!state) process.exit(0);

  const role = state.role;
  const tool = String(evt.tool_name ?? evt.tool ?? "");
  const input = evt.tool_input ?? evt.input ?? {};
  const cwd = String(evt.cwd ?? process.cwd());

  const deny = (reason) => {
    process.stderr.write(`[роль: ${role}] ЗАБЛОКИРОВАНО: ${reason}\n`);
    process.exit(2);
  };

  const fileTools = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit", "apply_patch"]);
  const target = input.file_path ?? input.path ?? input.notebook_path ?? "";
  if (fileTools.has(tool) && target) {
    const t = norm(target);
    const mainRoot = mainRootOf(cwd);
    const insideRepo = mainRoot && t.startsWith(mainRoot + "/");
    const allowed = /\/\.agent\//.test(t) || /\/docs\//.test(t);
    if (insideRepo && !allowed) {
      deny(
        `правка ${target}. Оркестратор не исполняет: выдай задание исполнителю ` +
          `(отдельная сессия/worktree) и прими его после аудита. Свой выход пиши ` +
          `в .agent/plans, .agent/orchestration и docs. Нужно править руками — ` +
          `сначала сними роль: \`!роль -\`.`
      );
    }
  }

  if (tool === "Bash" || tool === "PowerShell" || tool === "shell") {
    const command = String(input.command ?? input.cmd ?? "");
    if (role !== "integrator" && /\bgit\s+(merge|rebase|cherry-pick)\b/.test(command)) {
      deny(
        "интеграцию веток ведёт роль integrator. Доменный оркестратор сдаёт " +
          "готовую ветку в очередь .agent/orchestration/integrator.md."
      );
    }
  }

  process.exit(0);
}

try {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    /* нет stdin — нечего проверять */
  }
  if (!raw.trim()) process.exit(0);
  const evt = JSON.parse(raw);
  const event = String(evt.hook_event_name ?? evt.hookEventName ?? "");

  if (event === "UserPromptSubmit") handlePrompt(evt);
  else handleTool(evt);
  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
