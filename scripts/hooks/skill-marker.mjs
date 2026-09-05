#!/usr/bin/env node
/**
 * skill-marker.mjs — PostToolUse-хук Claude Code (Geopolis).
 *
 * Отмечает, какие skill'ы вызывались в текущей сессии, чтобы guard.mjs мог
 * требовать «map-geometry-qa вызван раньше» перед правкой мастера геометрии
 * (T-2, 2026-08-30: сессия дважды правила world_1946.master.geojson за один
 * заход, ни разу не вызвав Skill(map-geometry-qa), хотя его собственное
 * описание триггерится ровно на такую правку — обнаружено не хуком, а
 * прямым вопросом пользователя).
 *
 * Состояние — ВНЕ репозитория (как в role-guard.mjs): запись внутрь
 * основного checkout заблокировал бы сам guard.mjs, а per-session файл в
 * репозитории не нужен git-истории.
 *
 * Fail-open, как остальные хуки: внутренняя ошибка не блокирует работу.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".claude", "geopolis-skills");

const statePath = (sessionId) =>
  path.join(STATE_DIR, `${String(sessionId).replace(/[^\w.-]/g, "_")}.json`);

function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return {};
  }
}

try {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    /* нет stdin — нечего отмечать */
  }
  if (!raw.trim()) process.exit(0);
  const evt = JSON.parse(raw);

  const tool = String(evt.tool_name ?? evt.tool ?? "");
  if (tool !== "Skill") process.exit(0);

  const input = evt.tool_input ?? evt.input ?? {};
  // Имя поля со skill'ом не задокументировано явно — пробуем варианты,
  // совпадающие с именами параметров самого инструмента Skill (skill/name).
  const skillName = String(input.skill ?? input.name ?? input.skill_name ?? "");
  if (!skillName) process.exit(0);

  const sessionId = evt.session_id ?? evt.sessionId ?? "default";
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const state = readState(sessionId);
  state.skills = state.skills ?? {};
  state.skills[skillName] = new Date().toISOString();
  fs.writeFileSync(statePath(sessionId), JSON.stringify(state, null, 2), "utf8");

  process.exit(0);
} catch {
  process.exit(0); // fail-open
}
