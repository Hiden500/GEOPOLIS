/**
 * Замер четырёх воздействий, переехавших из старого канала `actions` в алфавит
 * примитивов (2026-08-02): `guarantee`, `research_shift`, `production_shift`,
 * `build_extraction`.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ПРОБНИК. Фикстура доказывает, что функция считает; что вход
 * ЖИВОЙ — только прогон на реальных данных (корневой `AGENTS.md`). Тесты
 * заводят домены исследований и опускают уровень мощностей руками, потому что
 * иначе предпосылки не выполняются, — и ровно это «иначе» здесь и измеряется:
 * сколько приказов проходит на поставляемом сценарии 1946 и какими кодами
 * отклоняются остальные.
 *
 * ЧТО ЭТО НЕ ЗАМЕНЯЕТ. Годовой прогон `runCampaignWithLLM` с живой моделью:
 * там проверяется, что МОДЕЛЬ выдаёт валидные примитивы. Здесь модель не
 * участвует вовсе — приказы строит скрипт, — поэтому замер отвечает на другой
 * вопрос: пускает ли их МИР и понятна ли причина отказа.
 *
 * Запуск (из server/):
 *   npx tsx scripts/probeMigratedVerbs.ts [--player USA] [--sample 40]
 */
import { createGame } from "../src/game/CreateGame";
import { applyPrimitiveBatch } from "../src/primitives/PrimitiveEngine";
import { rejectionPromptText } from "../src/primitives/rejections";
import { type Primitive } from "../src/primitives/types";
import { effectiveController } from "@shared/utils/regionControl";
import { type GameState } from "@shared/types/GameState";
import { type ResourceType } from "@shared/types/resources/ResourcesType";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";

function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1]! : fallback;
}

interface Outcome {
  applied: number;
  /** Код отказа → сколько раз и один пример текста для промта. */
  rejections: Map<string, { count: number; sample: string }>;
}

function emptyOutcome(): Outcome {
  return { applied: 0, rejections: new Map() };
}

/**
 * Каждый приказ применяется на СВЕЖЕЙ копии мира.
 *
 * Иначе замер мерил бы не предпосылки, а капы хода: второй приказ по той же
 * цели законно отклоняется `targetTurnCapReached`, и распределение кодов
 * рассказывало бы про бюджет месяца вместо состояния мира.
 */
function probe(base: GameState, primitives: Primitive[]): Outcome {
  const outcome = emptyOutcome();
  for (const primitive of primitives) {
    const state = structuredClone(base);
    const result = applyPrimitiveBatch(state, [primitive]);
    if (result.applied.length > 0) {
      outcome.applied++;
      continue;
    }
    const rejection = result.rejected[0]!.rejection;
    const entry = outcome.rejections.get(rejection.code);
    if (entry) entry.count++;
    else outcome.rejections.set(rejection.code, { count: 1, sample: rejectionPromptText(rejection) });
  }
  return outcome;
}

function report(title: string, total: number, outcome: Outcome): void {
  console.log(`\n## ${title} — попыток ${total}, применено ${outcome.applied}`);
  const sorted = [...outcome.rejections.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [code, { count, sample }] of sorted) {
    console.log(`  ${String(count).padStart(4)}  ${code}`);
    console.log(`        пример: ${sample}`);
  }
  if (sorted.length === 0) console.log("  (отказов нет)");
}

function main(): void {
  const player = arg("player", "USA");
  const sample = Number.parseInt(arg("sample", "40"), 10);
  const game = createGame("1946", player, "ru", 19460101);

  console.log(`сценарий 1946: ${game.countries.length} стран, ${game.regions.length} регионов`);
  console.log(`выборка: ${sample} стран / ${sample} регионов на глагол`);

  // Страны берутся детерминированно (сортировка по id), а не случайно: замер
  // должен быть воспроизводим между запусками и между ветками.
  const countries = [...game.countries].sort((a, b) => a.id.localeCompare(b.id)).slice(0, sample);

  // --- guarantee: пара «страна → следующая по списку» ---
  const guarantees: Primitive[] = countries.map((c, i) => ({
    verb: "guarantee",
    sourceCountryId: c.id,
    target: { countryId: countries[(i + 1) % countries.length]!.id },
  }));
  report("guarantee", guarantees.length, probe(game, guarantees));

  // --- research_shift: ПЕРВЫЙ РЕАЛЬНЫЙ домен каждой страны ---
  const researchShifts: Primitive[] = countries.flatMap(c => {
    const domain = Object.keys(c.technology.domains)[0];
    return domain
      ? [{
          verb: "research_shift" as const,
          sourceCountryId: c.id,
          target: { countryId: c.id },
          params: { domain, intensity: "severe" as const },
        }]
      : [];
  });
  report("research_shift (домен из данных страны)", researchShifts.length, probe(game, researchShifts));

  // Контрольная серия: домен, которого у страны нет. Отказ обязан быть кодом,
  // а не молчанием, — это и есть закрытый пункт «английские строки».
  const bogusDomains: Primitive[] = countries.map(c => ({
    verb: "research_shift",
    sourceCountryId: c.id,
    target: { countryId: c.id },
    params: { domain: "psionics" },
  }));
  report("research_shift (несуществующий домен)", bogusDomains.length, probe(game, bogusDomains));

  const productionShifts: Primitive[] = countries.map(c => ({
    verb: "production_shift",
    sourceCountryId: c.id,
    target: { countryId: c.id },
    params: { equipmentType: "tanks", intensity: "severe" },
  }));
  report("production_shift", productionShifts.length, probe(game, productionShifts));

  // --- build_extraction: реальные пары (регион, ресурс) с залежью ---
  const withDeposits = game.regions
    .filter(r => Object.keys(r.deposits ?? {}).length > 0)
    .sort((a, b) => a.id - b.id);
  const extractions: Primitive[] = withDeposits.slice(0, sample).flatMap(region => {
    const resource = Object.keys(region.deposits)[0] as ResourceType | undefined;
    const controller = effectiveController(region);
    return resource
      ? [{
          verb: "build_extraction" as const,
          sourceCountryId: controller,
          target: { regionId: region.id },
          params: { resource },
        }]
      : [];
  });
  report("build_extraction (контролёр строит на своей залежи)", extractions.length, probe(game, extractions));

  // Сколько пар (регион, ресурс) вообще стоят НИЖЕ потолка — прямой подсчёт,
  // а не оценка: от него зависит, живое ли это действие на сегодняшних данных.
  let pairs = 0;
  let belowMax = 0;
  for (const region of game.regions) {
    for (const resource of Object.keys(region.deposits ?? {})) {
      pairs++;
      if ((region.extraction?.[resource as ResourceType] ?? 0) < 10) belowMax++;
    }
  }
  console.log(
    `\nпар (регион, ресурс) с залежью: ${pairs}, из них ниже потолка мощностей: ${belowMax}`
  );

  const dismantles: Primitive[] = withDeposits.slice(0, sample).flatMap(region => {
    const resource = Object.keys(region.deposits)[0] as ResourceType | undefined;
    return resource
      ? [{
          verb: "build_extraction" as const,
          sourceCountryId: effectiveController(region),
          target: { regionId: region.id },
          params: { resource, direction: "dismantle" as const },
        }]
      : [];
  });
  report("build_extraction (снос)", dismantles.length, probe(game, dismantles));

  const sampleCountry = countries[0]!;
  console.log(
    `\nпример источника: ${sampleCountry.id} (${getText(sampleCountry.name, LLM_LOCALE)}), ` +
    `доменов ${Object.keys(sampleCountry.technology.domains).length}`
  );
}

main();
