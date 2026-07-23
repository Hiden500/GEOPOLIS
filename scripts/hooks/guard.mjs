#!/usr/bin/env node
/**
 * guard.mjs — общий PreToolUse-хук Claude Code и Codex (Geopolis).
 *
 * Блокирует (exit 2 + причина в stderr):
 *   1. Правки файлов в ОСНОВНОМ checkout (вне .claude/worktrees/ и ~/.codex/
 *      worktrees/) — enforcement worktree-протокола из AGENTS.md;
 *   2. Ручные правки генерируемых данных (server/data/scenarios/**,
 *      scripts/map/out/**) — данные меняются пайплайном (scripts/map/AGENTS.md);
 *   3. Разрушительные команды в Bash/PowerShell: git push --force,
 *      git reset --hard, git clean -f, rm -rf.
 *
 * Протокол (одинаков у Claude Code и Codex hooks): JSON события на stdin,
 * exit 0 = разрешить, exit 2 = заблокировать (stderr виден агенту).
 * Fail-open: внутренняя ошибка хука НЕ блокирует работу (exit 0), чтобы
 * сломанный guard не парализовал агентов.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const deny = (reason) => {
  process.stderr.write(`[guard] ЗАБЛОКИРОВАНО: ${reason}\n`);
  process.exit(2);
};

try {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    /* нет stdin — нечего проверять */
  }
  if (!raw.trim()) process.exit(0);
  const evt = JSON.parse(raw);

  // Поля обоих инструментов (Codex клонирует формат Claude).
  const tool = String(evt.tool_name ?? evt.tool ?? "");
  const input = evt.tool_input ?? evt.input ?? {};
  const cwd = String(evt.cwd ?? process.cwd());

  const norm = (p) => path.resolve(String(p)).replace(/\\/g, "/").toLowerCase();
  const isWorktreePath = (p) =>
    p.includes("/.claude/worktrees/") ||
    p.includes("/.codex/worktrees/") ||
    p.includes("/.codex/visualizations/");

  // Корень основного checkout: родитель общего .git (у linked worktree
  // git-common-dir указывает в основной репозиторий).
  let mainRoot = "";
  try {
    const commonDir = execSync(
      "git rev-parse --path-format=absolute --git-common-dir",
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    mainRoot = norm(path.dirname(commonDir));
  } catch {
    /* вне git — правила пути не применяем */
  }

  const fileTools = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit", "apply_patch"]);
  const target = input.file_path ?? input.path ?? input.notebook_path ?? "";

  if (fileTools.has(tool) && target) {
    const t = norm(target);
    if (mainRoot && t.startsWith(mainRoot + "/") && !isWorktreePath(t)) {
      deny(
        `правка в основном checkout (${target}). Задачи выполняются в отдельном worktree — см. AGENTS.md «Worktree и параллельная работа».`
      );
    }
    if (/\/server\/data\/scenarios\//.test(t) || /\/scripts\/map\/out\//.test(t)) {
      deny(
        `ручная правка генерируемых данных (${target}). Меняй скрипты/конфиги пайплайна и регенерируй — см. scripts/map/AGENTS.md.`
      );
    }
  }

  if (tool === "Bash" || tool === "PowerShell" || tool === "shell") {
    const cmd = String(input.command ?? input.cmd ?? "");
    const rules = [
      [/git\s+push\s+[^\n]*(--force(?!-with-lease)|\s-f\b)/, "git push --force запрещён (AGENTS.md: destructive git — только пользователь)"],
      [/git\s+reset\s+--hard/, "git reset --hard запрещён без явного разрешения пользователя"],
      [/git\s+clean\s+-[a-z]*f/, "git clean -f запрещён без явного разрешения пользователя"],
      [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, "rm -rf запрещён — используй точечное удаление или git rm"],
    ];
    for (const [re, msg] of rules) if (re.test(cmd)) deny(msg);
    // Правка генерируемых данных через shell-редиректы.
    if (/(>|>>)\s*"?[^"\n]*(server\/data\/scenarios|scripts\/map\/out)\//.test(cmd.replace(/\\/g, "/"))) {
      deny("shell-запись в генерируемые данные — меняй пайплайн, не выход");
    }
  }

  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
