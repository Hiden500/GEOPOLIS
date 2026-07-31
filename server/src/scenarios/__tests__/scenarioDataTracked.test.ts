import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Каждый файл данных сценария обязан быть под контролем версий.
 *
 * ЗАЧЕМ ЭТОТ ТЕСТ. `.gitignore` игнорирует `/server/data/scenarios/1946/*`
 * целиком и разрешает файлы поимённо — у директории нельзя отрицать файл
 * внутри без отрицания всех родительских директорий. Поэтому КАЖДЫЙ новый файл
 * данных по умолчанию невидим для git, и забытое отрицание не проявляется
 * никак: у автора файл на диске, тесты зелёные, а на свежем клоне слоя нет.
 *
 * Дефект уже случался — комментарий в `.gitignore` датирует его 2026-06-28
 * (регионы и имена), второй раз он повторился 2026-07-27 с `ideology_zones.json`.
 * Два случая одного класса — повод для проверки, а не для третьей записи в
 * комментарии.
 */
describe("данные сценария 1946 под контролем версий", () => {
  // Путь относительно cwd, а не корня репозитория: vitest запускается из
  // `server/`, и `git ls-files` разрешает аргумент от текущей директории.
  const scenarioRelative = "data/scenarios/1946";
  const scenarioDir = path.join(process.cwd(), scenarioRelative);

  it("каждый .json на диске отслеживается git", () => {
    const onDisk = fs
      .readdirSync(scenarioDir)
      .filter(name => name.endsWith(".json"))
      .sort();
    expect(onDisk.length).toBeGreaterThan(0);

    // `git ls-files` спрашивается один раз и по директории: перечислять
    // ожидаемые имена здесь значило бы завести второй список, который
    // разойдётся с первым — ровно та ошибка, от которой тест и защищает.
    const tracked = new Set(
      execFileSync("git", ["ls-files", scenarioRelative], { encoding: "utf-8" })
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => path.posix.basename(line))
    );

    const untracked = onDisk.filter(name => !tracked.has(name));
    expect(untracked).toEqual([]);
  });
});
