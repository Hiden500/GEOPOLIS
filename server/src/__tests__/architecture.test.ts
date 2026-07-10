import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";

/**
 * Fitness-функции архитектурной конституции (docs/agent/MASTER_PROMPT.md,
 * реестр — docs/agent/ARCHITECTURE_GUARDRAILS.md). Один файл на весь набор
 * grep-тестов, как предписывает guardrails-документ.
 *
 * Первые три правила — единственные, для которых уже есть инфраструктура
 * (правило 1/9/5 закрывает план 01_PERSISTENCE_STATE.md; правило 10 не
 * зависит ни от одного плана, дешёвое, добавлено сразу). Остальные (2/3/4/
 * 6/7/8) требуют инфраструктуры, которой ещё нет (команды — план 03,
 * реестры контента — планы 05/06) — заводятся вместе с ней, не заранее.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/src/__tests__/ -> server/src -> server -> корень репозитория.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", "coverage", ".turbo", ".cache", "__pycache__",
]);

function collectFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      out.push(fullPath);
    }
  }
  return out;
}

function relRepo(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

describe("Fitness-функция: правило 1 — GameState = plain JSON (+ правило 9, производное не хранится)", () => {
  it("createGame(): JSON round-trip эквивалентен исходному состоянию", () => {
    const game = createGame("1946", "USA", "ru", 1);
    expect(JSON.parse(JSON.stringify(game))).toEqual(game);
  });

  it("после 12 месяцев simulateMonth: JSON round-trip по-прежнему эквивалентен", () => {
    const game = createGame("1946", "USA", "ru", 1);
    for (let i = 0; i < 12; i++) simulateMonth(game);
    expect(JSON.parse(JSON.stringify(game))).toEqual(game);
  });
});

describe("Fitness-функция: правило 5 — детерминизм", () => {
  const FORBIDDEN_PATTERNS: { name: string; regex: RegExp }[] = [
    { name: "Math.random(", regex: /Math\.random\(/ },
    { name: "Date.now(", regex: /Date\.now\(/ },
    { name: "new Date(", regex: /new Date\(/ },
  ];

  // Белый список — файл (repo-relative, forward slashes) -> причины (комментарий с
  // датой). Пополняется только с обоснованием (docs/agent/ARCHITECTURE_GUARDRAILS.md
  // §"Процесс архитектурных изменений", п.3) и пересматривается раз в квартал.
  const WHITELIST: Record<string, string> = {
    "server/src/services/MapFeatureService.ts":
      "removeExpiredFeatures(): сравнение с expiresAt через wall-clock. Ничего не " +
      "блокирует — expiresAt нигде не выставляется в проде (только в тестах), ни один " +
      "Map Feature пока не имеет срока жизни. docs/plans/01_PERSISTENCE_STATE.md, 2026-07-10.",
  };

  it("нет Math.random/Date.now/new Date в simulation/**, services/** (кроме белого списка; *.test.ts исключены — легитимный wall-clock замер в тестах, не геймплейный недетерминизм)", () => {
    const targets = [
      path.join(REPO_ROOT, "server", "src", "simulation"),
      path.join(REPO_ROOT, "server", "src", "services"),
    ];

    const violations: string[] = [];

    for (const dir of targets) {
      for (const file of collectFiles(dir, [".ts"])) {
        if (file.endsWith(".test.ts")) continue;

        const relPath = relRepo(file);
        const content = fs.readFileSync(file, "utf-8");

        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.regex.test(content) && !WHITELIST[relPath]) {
            violations.push(`${relPath}: содержит "${pattern.name}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // Same-seed тест (два прогона simulateMonth с одним seed → идентичное состояние)
  // — критерий приёмки docs/plans/01_PERSISTENCE_STATE.md, живёт в
  // server/src/game/__tests__/CreateGame.test.ts (не дублируется здесь — полный
  // 128-страновой прогон дважды по 12 месяцев не бесплатен, гонять его в двух
  // местах не даёт новой информации).
});

describe("Fitness-функция: правило 10 — слои не текут", () => {
  function extractImportSpecifiers(content: string): string[] {
    const specifiers: string[] = [];
    const importRegex = /(?:import|export)[^'";]*from\s+["']([^"']+)["']/g;
    const requireRegex = /require\(\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content))) specifiers.push(match[1]!);
    while ((match = requireRegex.exec(content))) specifiers.push(match[1]!);
    return specifiers;
  }

  function findCrossLayerImports(sourceDir: string, forbiddenDirs: string[]): string[] {
    const violations: string[] = [];
    const forbiddenAbs = forbiddenDirs.map(d => path.join(REPO_ROOT, d));

    for (const file of collectFiles(sourceDir, [".ts", ".tsx"])) {
      const content = fs.readFileSync(file, "utf-8");
      for (const specifier of extractImportSpecifiers(content)) {
        if (!specifier.startsWith(".")) continue; // алиасы (@shared/...) не ведут за пределы своего workspace
        const resolved = path.resolve(path.dirname(file), specifier);
        for (const forbidden of forbiddenAbs) {
          if (resolved === forbidden || resolved.startsWith(forbidden + path.sep)) {
            violations.push(`${relRepo(file)} импортирует "${specifier}" (→ ${relRepo(forbidden)})`);
          }
        }
      }
    }
    return violations;
  }

  it("shared/src/** не импортирует из server/ или client/", () => {
    const violations = findCrossLayerImports(
      path.join(REPO_ROOT, "shared", "src"),
      ["server", "client"]
    );
    expect(violations).toEqual([]);
  });

  it("client/src/** не импортирует из server/src", () => {
    const violations = findCrossLayerImports(
      path.join(REPO_ROOT, "client", "src"),
      ["server/src"]
    );
    expect(violations).toEqual([]);
  });
});
