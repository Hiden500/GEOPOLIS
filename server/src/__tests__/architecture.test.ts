import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createGame } from "../game/CreateGame";
import { simulateMonth } from "../simulation/SimulationEngine";
import { LLMService } from "../services/LLMService";
import { LLMActionSchema } from "../llm/actionSchemas";
import { createTestCountry, createTestGameState } from "../test-utils/fixtures";
import { type GameState } from "@shared/types/GameState";

/**
 * Fitness-функции архитектурной конституции (docs/agent/MASTER_PROMPT.md,
 * реестр — docs/agent/ARCHITECTURE_GUARDRAILS.md). Один файл на весь набор
 * grep-тестов, как предписывает guardrails-документ.
 *
 * Правила 1/9/5/10 заведены планом 01_PERSISTENCE_STATE.md; правило 6 —
 * планом 02_LLM_CONTRACT.md (2026-07-10, actionSchemas.ts). Остальные
 * (2/3/4/7/8) требуют инфраструктуры, которой ещё нет (команды — план 03,
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

describe("Fitness-функция: правило 6 — LLM-контракт через Zod (docs/plans/02_LLM_CONTRACT.md)", () => {
  function gameWithUsaSun(): GameState {
    return createTestGameState({
      playerCountryId: "USA",
      countries: [createTestCountry({ id: "USA" }), createTestCountry({ id: "SUN" })],
    });
  }

  it("действие вне схемы отклоняется точечно с причиной; валидное соседнее действие в том же батче применяется", () => {
    const game = gameWithUsaSun();
    const service = new LLMService(game);

    const result = service.processResponse(JSON.stringify({
      descriptions: "x",
      actions: [
        { type: "nuke", sourceCountryId: "USA", targetCountryId: "SUN" },
        { type: "diplomacy", sourceCountryId: "USA", targetCountryId: "SUN", data: { relationChange: 5 } },
      ],
    }));

    expect(result.success).toBe(true);
    expect(result.appliedActions).toHaveLength(1);
    expect(result.rejectedActions).toHaveLength(1);
    expect(result.rejectedActions[0]!.reason).toBeTruthy();
  });

  it("за-каповое значение отклоняется точечно, с непустой причиной — не обваливает весь ответ", () => {
    const game = gameWithUsaSun();
    const service = new LLMService(game);

    const result = service.processResponse(JSON.stringify({
      descriptions: "x",
      actions: [{ type: "diplomacy", sourceCountryId: "USA", targetCountryId: "SUN", data: { relationChange: 500 } }],
    }));

    expect(result.success).toBe(true);
    expect(result.appliedActions).toHaveLength(0);
    expect(result.rejectedActions).toHaveLength(1);
    expect(result.rejectedActions[0]!.reason).toBeTruthy();
  });

  // "Сырые координаты в действии — отклоняются" (формулировка правила 6 в
  // ARCHITECTURE_GUARDRAILS.md) переформулирована под реальный контракт: ни
  // один из 10 текущих action-типов не является map-placement действием —
  // все strictly country-scoped (дипломатия/война/технологии/производство),
  // ни одно легитимно не может нести координату сейчас. Буквальная проверка
  // "regionId вместо lat/lng" станет осмысленной только с планом
  // 06_MAP_FEATURES.md. Два теста ниже — честная замена на сегодня: форма
  // контракта (регрессионный барьер против будущей ошибки "добавили
  // координату вместо regionId") + инертность лишних полей (Zod молча
  // отбрасывает нежданные ключи — «LLM не пишет произвольные числа в state
  // мимо капов» для нынешнего контракта).
  it("форма контракта: ни одна data-схема не содержит поле, похожее на координату (TODO: полноценная regionId-проверка — после плана 06)", () => {
    function collectPropertyNames(schema: unknown, out: Set<string>): void {
      if (schema === null || typeof schema !== "object") return;
      const obj = schema as Record<string, unknown>;
      if (obj.properties && typeof obj.properties === "object") {
        for (const [key, value] of Object.entries(obj.properties as Record<string, unknown>)) {
          out.add(key);
          collectPropertyNames(value, out);
        }
      }
      if (Array.isArray(obj.anyOf)) for (const branch of obj.anyOf) collectPropertyNames(branch, out);
      if (Array.isArray(obj.oneOf)) for (const branch of obj.oneOf) collectPropertyNames(branch, out);
      if (obj.items) collectPropertyNames(obj.items, out);
    }

    const propertyNames = new Set<string>();
    collectPropertyNames(z.toJSONSchema(LLMActionSchema), propertyNames);

    const coordinateLikeNames = ["lat", "lng", "latitude", "longitude", "coordinates", "x", "y"];
    const found = coordinateLikeNames.filter(name => propertyNames.has(name));
    expect(found).toEqual([]);
  });

  it("инертность лишних полей: посторонний lat/lng в data молча отбрасывается, не просачивается в применённое действие", () => {
    const game = gameWithUsaSun();
    const service = new LLMService(game);

    const result = service.processResponse(JSON.stringify({
      descriptions: "x",
      actions: [{
        type: "diplomacy",
        sourceCountryId: "USA",
        targetCountryId: "SUN",
        data: { relationChange: 5, lat: 55.7, lng: 37.6 },
      }],
    }));

    expect(result.appliedActions).toHaveLength(1);
    const applied = result.appliedActions[0]!;
    expect(applied.type === "diplomacy" && (applied.data as Record<string, unknown>)["lat"]).toBeUndefined();
    expect(applied.type === "diplomacy" && (applied.data as Record<string, unknown>)["lng"]).toBeUndefined();
    expect(game.countries.find(c => c.id === "USA")!.diplomacy.relations["SUN"]).toBe(5);
  });
});

describe("Fitness-функция: правило 2 — мутации через команды (docs/plans/03_MODIFIERS_COMMANDS.md)", () => {
  // Три внешних инициатора мутации, которые критерий приёмки плана 03 прямо
  // называет: AiBehaviorTick (ИИ), LLMService (LLM-действия), роут игрока
  // budget.ts. Внутренние детерминированные тики (DiplomacyTick, WarTick и
  // т.п.) вне периметра — они продолжают вызывать сервисы напрямую, это не
  // "внешний инициатор" в терминах критерия.
  const TARGET_FILES = [
    "server/src/simulation/ai/AiBehaviorTick.ts",
    "server/src/services/LLMService.ts",
    "server/src/routes/budget.ts",
  ];

  // .economy./.diplomacy./.politics./.military. путь, за которым следует
  // оператор присваивания (=, +=, -=, *=) — не ==/===/=>. Та же
  // "грубая проверка grep'ом" философия, что и у правила 4/5 в этом файле.
  const DIRECT_MUTATION_PATTERN = /\.(economy|diplomacy|politics|military)\.[\w[\]'".]*\s*(=[^=]|[-+*]=)/g;

  it("AiBehaviorTick/LLMService/budget.ts не пишут в .economy./.diplomacy./.politics./.military. напрямую — только через server/src/commands/", () => {
    const violations: string[] = [];

    for (const relPath of TARGET_FILES) {
      const absPath = path.join(REPO_ROOT, ...relPath.split("/"));
      const content = fs.readFileSync(absPath, "utf-8");
      const matches = content.match(DIRECT_MUTATION_PATTERN) ?? [];
      for (const match of matches) {
        violations.push(`${relPath}: "${match.trim()}"`);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("Fitness-функция: правило 4 — баланс в defines, не в коде (docs/plans/03_MODIFIERS_COMMANDS.md, Шаг 3)", () => {
  // Структурные литералы, не требующие имени: 0/1 — нейтральные элементы
  // (identity для +/*, флаги), 100 — сама 0-100 шкала (проценты/страховка),
  // не тюнингуемое число баланса. Всё остальное в арифметике/сравнении вне
  // `const NAME = ...` — подозрение на неименованную баланс-константу.
  const STRUCTURAL_LITERALS = new Set(["0", "1", "100"]);

  function stripComments(content: string): string {
    return content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      // Шаблонные строки (например, форматирование дат) часто содержат
      // цифры, не имеющие отношения к балансу — не арифметика.
      .replace(/`[^`]*`/g, "``");
  }

  function isConstDeclarationLine(line: string): boolean {
    return /^\s*(export\s+)?const\s+[A-Za-z_][\w]*\s*[:=]/.test(line);
  }

  // Число сразу после оператора арифметики/сравнения/присваивания или перед
  // ним — "грубая проверка grep'ом" (тот же принцип, что правило 5 в этом
  // файле), не полноценный парсер.
  const NUMBER_IN_EXPRESSION = /(?:[*/+<>-]=?|\breturn\s)\s*(-?\d+\.\d+|-?\d{2,})(?![\w.])/g;

  it("в server/src/simulation/**/*.ts (кроме *.test.ts) нет числовых литералов баланса вне const NAME = ...", () => {
    const violations: string[] = [];
    const dir = path.join(REPO_ROOT, "server", "src", "simulation");

    for (const file of collectFiles(dir, [".ts"])) {
      if (file.endsWith(".test.ts")) continue;

      const relPath = relRepo(file);
      const rawContent = fs.readFileSync(file, "utf-8");
      const content = stripComments(rawContent);
      const lines = content.split("\n");

      lines.forEach((line, i) => {
        if (isConstDeclarationLine(line)) return;

        for (const match of line.matchAll(NUMBER_IN_EXPRESSION)) {
          const num = match[1]!;
          if (STRUCTURAL_LITERALS.has(num)) continue;
          violations.push(`${relPath}:${i + 1}: "${line.trim()}" (число ${num})`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
