/**
 * Замер здоровья МОДЕЛИ НЕДОВОЛЬСТВА на живом сценарии 1946.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `probeSimulationHealth.ts`. Тот печатает страновые агрегаты
 * (легитимность, коррупция, экспорт), а здесь предмет — распределение по 1399
 * РЕГИОНАМ и достижимость порогов примитивов. Аудит формул 2026-07-30
 * (`.agent/audits/formula-audit-2026-07-30.md`) выдвинул три заявления о
 * недовольстве, и каждое проверяется распределением, а не одним значением:
 *
 *   1. недовольство вырождается в одномерный датчик авторитарности (R = −0,89);
 *   2. порог восстания берут 2 региона из 1399, порог отделения — ни один;
 *   3. `regionWelfare` односторонняя (38 % регионов дают тождественный ноль)
 *      и ломается при оккупации.
 *
 * ЧТО ЗАМЕР ПОКАЗАЛ (2026-08-01, до правок). Все три подтвердились, два — с
 * уточнением методики: R = −0,889 считается ПО СТРАНАМ (по регионам −0,742), а
 * порог отделения читает недовольство группы-БОЛЬШИНСТВА, а не региона — по
 * правильной величине строжайший порог не брал ни один регион при максимуме по
 * миру 0,8190. Поэтому здесь печатаются ОБЕ единицы наблюдения и обе величины:
 * расхождение с числом аудита иначе не отличить от изменения самой модели.
 *
 * Запуск:  npx tsx scripts/probeDiscontentHealth.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import {
  regionDiscontent,
  regionWelfare,
  regionAuthority,
  regionWelfareReference,
  resolveIdeologyCoordinates,
  ideologyDistance,
  groupDiscontent,
  findImpactMemory,
} from "@shared/utils/discontent";
import {
  WELFARE_PARITY,
  SPLIT_MIN_GROUP_SHARE,
  SPLIT_MIN_REGIONS,
  COUNTRY_POLITICS_SCALE_MAX,
  PRIMITIVE_INTENSITY_POSITION,
  REGION_CRISIS_DISCONTENT_THRESHOLD,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
} from "@shared/defines/discontent";
import { splitDiscontentThreshold } from "../src/primitives/polityLifecycle";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 120;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function fmt(n: number, digits = 3): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "n/a";
}

/** Пирсон. Ноль дисперсии у любого ряда — корреляция не определена. */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return Number.NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return Number.NaN;
  return sxy / Math.sqrt(sxx * syy);
}

interface RegionSample {
  regionId: number;
  authorityId: string;
  discontent: number;
  welfare: number;
  welfareTermDead: boolean;
  authorityPolitical: number;
  authorityEconomic: number;
  distance: number;
  /** Сырое отношение «ВВП/душу региона : ВВП/душу страны», БЕЗ клампа. */
  ratio: number;
}

function sampleRegions(game: GameState): RegionSample[] {
  const samples: RegionSample[] = [];

  for (const region of game.regions) {
    if (!region.demographics || region.demographics.length === 0) continue;
    const discontent = regionDiscontent(game, region);
    if (discontent === undefined) continue;

    const authority = regionAuthority(game, region);
    const coords = authority
      ? resolveIdeologyCoordinates(authority.politics)
      : { economic: 0, political: 0 };
    const reference = regionWelfareReference(game, region);
    const welfare = regionWelfare(region, reference);

    // Доля-взвешенная геометрическая дистанция региона — «главный член» без
    // памяти и экономики.
    const groups = new Map(game.ethnicGroups.map(g => [g.id, g]));
    let distance = 0;
    let shareSum = 0;
    for (const entry of region.demographics) {
      const definition = groups.get(entry.groupId);
      if (!definition) continue;
      distance += entry.share * ideologyDistance(coords, definition.desiredIdeology);
      shareSum += entry.share;
    }
    if (shareSum > 0) distance /= shareSum;

    samples.push({
      regionId: region.id,
      authorityId: authority?.id ?? "—",
      discontent,
      welfare,
      welfareTermDead: welfare === WELFARE_PARITY,
      authorityPolitical: coords.political,
      authorityEconomic: coords.economic,
      distance,
      ratio:
        reference && reference.population > 0 && reference.economy.gdp > 0 && region.population > 0
          ? region.gdp / region.population / (reference.economy.gdp / reference.population)
          : Number.NaN,
    });
  }

  return samples;
}

/** Пороги, читающие РЕГИОНАЛЬНОЕ недовольство (`spawn_incident`, кризисный факт). */
const REGION_THRESHOLDS: readonly { label: string; value: number }[] = [
  { label: "инцидент (протест)", value: SPAWN_INCIDENT_MIN_DISCONTENT },
  { label: "кризис региона", value: REGION_CRISIS_DISCONTENT_THRESHOLD },
  { label: "восстание", value: SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT },
];

/**
 * `split_country` читает НЕ региональное недовольство, а недовольство
 * группы-БОЛЬШИНСТВА (доля ≥ `SPLIT_MIN_GROUP_SHARE`), и порог интерполируется
 * хинтом внутри коридора (`splitDiscontentThreshold`). Мерить его региональным
 * недовольством — мерить не то: у доминанта оно выше среднего по региону.
 */
const SPLIT_THRESHOLDS: readonly { label: string; value: number }[] = (
  ["mild", "moderate", "severe"] as const
).map(intensity => ({
  label: `отделение (${intensity}, поз. ${PRIMITIVE_INTENSITY_POSITION[intensity]})`,
  value: splitDiscontentThreshold(intensity),
}));

function reportDistribution(samples: readonly RegionSample[], label: string): void {
  const values = samples.map(s => s.discontent).sort((a, b) => a - b);

  console.log(`\n=== ${label} ===`);
  console.log(`размеченных регионов: ${samples.length}`);
  console.log(
    `недовольство: min ${fmt(values[0] ?? Number.NaN)} | p10 ${fmt(quantile(values, 0.1))} | ` +
      `медиана ${fmt(quantile(values, 0.5))} | p90 ${fmt(quantile(values, 0.9))} | ` +
      `p99 ${fmt(quantile(values, 0.99))} | max ${fmt(values[values.length - 1] ?? Number.NaN)}`
  );

  for (const t of REGION_THRESHOLDS) {
    const count = values.filter(v => v >= t.value).length;
    console.log(`  ≥ ${fmt(t.value, 2)} (${t.label}): ${count} рег. (${pct(count, values.length)})`);
  }

  const politicalR = pearson(samples.map(s => s.authorityPolitical), samples.map(s => s.discontent));
  const economicR = pearson(samples.map(s => s.authorityEconomic), samples.map(s => s.discontent));
  const distanceR = pearson(samples.map(s => s.distance), samples.map(s => s.discontent));
  console.log(
    `корреляция ПО РЕГИОНАМ: политическая ось власти R = ${fmt(politicalR)} | ` +
      `экономическая ось R = ${fmt(economicR)} | геом. дистанция R = ${fmt(distanceR)}`
  );

  // Аудит 2026-07-30 считал корреляцию «политическая координата СТРАНЫ ↔
  // недовольство её регионов». Единица наблюдения там — страна, здесь — регион;
  // печатаем обе, иначе расхождение с −0,89 нельзя отличить от изменения модели.
  const byCountry = new Map<string, number[]>();
  for (const s of samples) {
    const list = byCountry.get(s.authorityId);
    if (list) list.push(s.discontent);
    else byCountry.set(s.authorityId, [s.discontent]);
  }
  const countryPolitical: number[] = [];
  const countryDiscontent: number[] = [];
  for (const [id, values] of byCountry) {
    const any = samples.find(s => s.authorityId === id)!;
    countryPolitical.push(any.authorityPolitical);
    countryDiscontent.push(values.reduce((a, b) => a + b, 0) / values.length);
  }
  console.log(
    `корреляция ПО СТРАНАМ (${byCountry.size} стран, среднее недовольство регионов): ` +
      `R = ${fmt(pearson(countryPolitical, countryDiscontent))}`
  );

  const welfare = samples.map(s => s.welfare).sort((a, b) => a - b);
  const saturatedTop = samples.filter(s => s.welfare >= 1).length;
  const saturatedBottom = samples.filter(s => s.welfare <= 0).length;
  const dead = samples.filter(s => s.welfareTermDead).length;
  console.log(
    `welfare: min ${fmt(welfare[0] ?? Number.NaN)} | медиана ${fmt(quantile(welfare, 0.5))} | ` +
      `max ${fmt(welfare[welfare.length - 1] ?? Number.NaN)} (паритет = ${fmt(WELFARE_PARITY, 2)})`
  );
  console.log(
    `  экономический член ровно ноль: ${dead} рег. (${pct(dead, samples.length)}); ` +
      `упёрлись в потолок ${saturatedTop}, в пол ${saturatedBottom}`
  );
  const relieved = samples.filter(s => s.welfare > WELFARE_PARITY).length;
  console.log(
    `  член работает ВНИЗ (регион богаче своей страны): ${relieved} рег. ` +
      `(${pct(relieved, samples.length)})`
  );

  // Сырое отношение — обоснование шкалы двусторонней меры: насколько далеко
  // регионы реально уходят вверх и вниз от среднего по своей стране.
  const ratios = samples.map(s => s.ratio).filter(Number.isFinite).sort((a, b) => a - b);
  console.log(
    `сырое отношение (без клампа): p1 ${fmt(quantile(ratios, 0.01))} | ` +
      `p10 ${fmt(quantile(ratios, 0.1))} | медиана ${fmt(quantile(ratios, 0.5))} | ` +
      `p90 ${fmt(quantile(ratios, 0.9))} | p99 ${fmt(quantile(ratios, 0.99))} | ` +
      `max ${fmt(ratios[ratios.length - 1] ?? Number.NaN)}`
  );
  const above = ratios.filter(r => r > 1).length;
  console.log(
    `  выше среднего по стране: ${above} рег. (${pct(above, ratios.length)}) — ` +
      `до 2026-08-01 ровно они клампились в 1 и давали мёртвый член`
  );
}

/**
 * Достижимость порога ОТДЕЛЕНИЯ — по недовольству групп-большинств, той самой
 * величине, которую читает `separatistGroupOf`. Плюс главное: сколько СТРАН
 * реально может расколоться (нужно ≥ `SPLIT_MIN_REGIONS` регионов и хотя бы
 * один уходящий).
 */
function reportSplitReach(game: GameState, label: string): void {
  const regionsByOwner = new Map<string, Region[]>();
  for (const region of game.regions) {
    const list = regionsByOwner.get(region.ownerCountryId);
    if (list) list.push(region);
    else regionsByOwner.set(region.ownerCountryId, [region]);
  }

  const groups = new Map(game.ethnicGroups.map(g => [g.id, g]));
  /** Максимальное недовольство группы-большинства региона; NaN — большинства нет. */
  const majorityDiscontent = (region: Region): number => {
    const authority = regionAuthority(game, region);
    const coords = authority
      ? resolveIdeologyCoordinates(authority.politics)
      : { economic: 0, political: 0 };
    const welfare = regionWelfare(region, regionWelfareReference(game, region));
    let best = Number.NaN;
    for (const entry of region.demographics ?? []) {
      if (entry.share < SPLIT_MIN_GROUP_SHARE) continue;
      const definition = groups.get(entry.groupId);
      if (!definition) continue;
      const value = groupDiscontent(
        coords,
        definition.desiredIdeology,
        welfare,
        findImpactMemory(game.groupImpactMemory, region.id, entry.groupId)
      );
      if (!(best >= value)) best = value;
    }
    return best;
  };

  const withMajority = game.regions
    .filter(r => r.demographics && r.demographics.length > 0)
    .map(r => ({ region: r, discontent: majorityDiscontent(r) }))
    .filter(x => Number.isFinite(x.discontent));

  const sorted = withMajority.map(x => x.discontent).sort((a, b) => a - b);
  console.log(`\n--- отделение: недовольство групп-большинств (${label}) ---`);
  console.log(
    `регионов с группой-большинством: ${withMajority.length}; ` +
      `медиана ${fmt(quantile(sorted, 0.5))} | p99 ${fmt(quantile(sorted, 0.99))} | ` +
      `max ${fmt(sorted[sorted.length - 1] ?? Number.NaN)}`
  );

  for (const t of SPLIT_THRESHOLDS) {
    const seceding = withMajority.filter(x => x.discontent >= t.value);
    const countries = new Set(
      seceding
        .map(x => x.region.ownerCountryId)
        .filter(id => (regionsByOwner.get(id)?.length ?? 0) >= SPLIT_MIN_REGIONS)
    );
    console.log(
      `  ≥ ${fmt(t.value, 3)} (${t.label}): ${seceding.length} рег. → ` +
        `${countries.size} стран может расколоться`
    );
  }
}

/**
 * Кандидаты во ВТОРОЙ вход недовольства: чтобы вылечить одномерность, вход
 * обязан (а) различать страны и (б) НЕ быть переодетой политической осью. Второе
 * проверяется корреляцией с самой осью — вход, повторяющий её, ничего не лечит.
 */
function reportSecondAxisCandidates(game: GameState): void {
  // Сначала — сами ЖЕЛАНИЯ групп: если одномерна геометрия на входе, никакой
  // вес в формуле её не развернёт.
  const desires = game.ethnicGroups.map(g => g.desiredIdeology);
  const pol = desires.map(d => d.political).sort((a, b) => a - b);
  const eco = desires.map(d => d.economic).sort((a, b) => a - b);
  const positivePolitical = desires.filter(d => d.political > 0).length;
  const nearZeroEconomic = desires.filter(d => Math.abs(d.economic) < 0.1).length;
  console.log(`\n--- желания групп (${desires.length} групп каталога) ---`);
  console.log(
    `desiredIdeology.political: ${fmt(pol[0] ?? Number.NaN)}…${fmt(pol[pol.length - 1] ?? Number.NaN)} ` +
      `(медиана ${fmt(quantile(pol, 0.5))}); > 0 у ${positivePolitical} групп ` +
      `(${pct(positivePolitical, desires.length)})`
  );
  console.log(
    `desiredIdeology.economic: ${fmt(eco[0] ?? Number.NaN)}…${fmt(eco[eco.length - 1] ?? Number.NaN)} ` +
      `(медиана ${fmt(quantile(eco, 0.5))}, среднее ` +
      `${fmt(eco.reduce((a, b) => a + b, 0) / Math.max(1, eco.length))}); ` +
      `|economic| < 0.1 у ${nearZeroEconomic} групп (${pct(nearZeroEconomic, desires.length)})`
  );

  const countries = game.countries.filter(c => c.economy.gdp > 0);
  const political = countries.map(c => resolveIdeologyCoordinates(c.politics).political);

  const candidates: readonly { label: string; values: number[] }[] = [
    { label: "politics.legitimacy", values: countries.map(c => c.politics.legitimacy) },
    { label: "politics.corruption", values: countries.map(c => c.politics.corruption) },
    { label: "politics.stability", values: countries.map(c => c.politics.stability) },
    {
      label: "politics.governmentSupport",
      values: countries.map(c => c.politics.governmentSupport),
    },
  ];

  console.log(`\n--- кандидаты во второй вход (${countries.length} стран) ---`);
  for (const c of candidates) {
    const sorted = [...c.values].sort((a, b) => a - b);
    console.log(
      `${c.label}: ${fmt(sorted[0] ?? Number.NaN, 1)}…${fmt(sorted[sorted.length - 1] ?? Number.NaN, 1)} ` +
        `(медиана ${fmt(quantile(sorted, 0.5), 1)}) | R с политической осью = ${fmt(pearson(political, c.values))}`
    );
  }

  const stability = game.regions.map(r => r.stability).sort((a, b) => a - b);
  console.log(
    `region.stability (по регионам): ${fmt(stability[0] ?? Number.NaN)}…` +
      `${fmt(stability[stability.length - 1] ?? Number.NaN)} (медиана ${fmt(quantile(stability, 0.5))})`
  );
}

/**
 * Свип веса кандидата ПЕРЕД тем, как ставить константу: частично коллинеарный
 * вход (легитимность коррелирует с политической осью на +0,52) может не снизить
 * |R|, а поднять его. Здесь считается, ЧТО СТАЛО БЫ с корреляцией и с
 * достижимостью порогов при каждом весе, — формула воспроизводится локально
 * ровно для выбора числа, итог потом проверяется настоящим прогоном.
 */
function reportLegitimacySweep(game: GameState, samples: readonly RegionSample[]): void {
  const legitimacyOf = new Map<string, number>(
    game.countries.map(c => [c.id, c.politics.legitimacy])
  );
  const neutral = COUNTRY_POLITICS_SCALE_MAX / 2;

  console.log(`\n--- свип веса легитимности (нейтраль ${fmt(neutral, 1)}) ---`);
  console.log(`вес   R(полит. ось)  R(по странам)  медиана  max    ≥восст.  ≥кризис`);

  for (const weight of [0, 0.1, 0.15, 0.2, 0.3, 0.4]) {
    const shifted = samples.map(s => {
      const legitimacy = legitimacyOf.get(s.authorityId) ?? neutral;
      const term = weight * ((neutral - legitimacy) / neutral);
      return { ...s, discontent: Math.max(0, Math.min(1, s.discontent + term)) };
    });

    const values = shifted.map(s => s.discontent).sort((a, b) => a - b);
    const byCountry = new Map<string, number[]>();
    for (const s of shifted) {
      const list = byCountry.get(s.authorityId);
      if (list) list.push(s.discontent);
      else byCountry.set(s.authorityId, [s.discontent]);
    }
    const cPol: number[] = [];
    const cDis: number[] = [];
    for (const [id, list] of byCountry) {
      cPol.push(shifted.find(s => s.authorityId === id)!.authorityPolitical);
      cDis.push(list.reduce((a, b) => a + b, 0) / list.length);
    }

    console.log(
      `${fmt(weight, 2)}  ${fmt(pearson(shifted.map(s => s.authorityPolitical), shifted.map(s => s.discontent)))}` +
        `         ${fmt(pearson(cPol, cDis))}         ${fmt(quantile(values, 0.5))}    ` +
        `${fmt(values[values.length - 1] ?? Number.NaN)}  ` +
        `${values.filter(v => v >= SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT).length}` +
        `        ${values.filter(v => v >= REGION_CRISIS_DISCONTENT_THRESHOLD).length}`
    );
  }
}

/** Почему член благосостояния мёртв: структура данных, а не случайность. */
function reportWelfareCauses(game: GameState): void {
  const regionsByOwner = new Map<string, Region[]>();
  for (const region of game.regions) {
    const list = regionsByOwner.get(region.ownerCountryId);
    if (list) list.push(region);
    else regionsByOwner.set(region.ownerCountryId, [region]);
  }

  const marked = game.regions.filter(r => r.demographics && r.demographics.length > 0);
  const singleRegion = marked.filter(r => (regionsByOwner.get(r.ownerCountryId)?.length ?? 0) === 1);
  const occupied = marked.filter(r => r.occupiedBy !== undefined);

  console.log(`\n--- причины мёртвого члена благосостояния ---`);
  console.log(
    `размеченных регионов в странах из ОДНОГО региона: ${singleRegion.length} ` +
      `(регион ≡ страна, отношение тождественно 1)`
  );
  console.log(`оккупированных размеченных регионов: ${occupied.length}`);
  console.log(
    `стран из одного региона всего: ` +
      `${[...regionsByOwner.values()].filter(list => list.length === 1).length} из ${regionsByOwner.size}`
  );
}

/**
 * Достижимость порога ЗА ПАРТИЮ, а не в один момент: недовольство статично по
 * построению (§4.1 — выводится, не хранится), но экономика под ним дышит, и
 * регион может подняться над порогом к десятому году.
 */
function reportReach(peak: Map<number, number>, months: number): void {
  const values = [...peak.values()];
  console.log(`\n=== пик за ${months} месяцев (регион засчитан, если брал порог ХОТЯ БЫ раз) ===`);
  for (const t of REGION_THRESHOLDS) {
    const count = values.filter(v => v >= t.value).length;
    console.log(`  ≥ ${fmt(t.value, 2)} (${t.label}): ${count} рег. (${pct(count, values.length)})`);
  }
  const sorted = [...values].sort((a, b) => b - a);
  console.log(`  топ-5 пиков: ${sorted.slice(0, 5).map(v => fmt(v)).join(", ")}`);
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  const start = sampleRegions(game);
  reportDistribution(start, "старт (месяц 0)");
  reportWelfareCauses(game);
  reportSecondAxisCandidates(game);
  reportLegitimacySweep(game, start);
  reportSplitReach(game, "месяц 0");

  const peak = new Map<number, number>();
  const record = (samples: readonly RegionSample[]): void => {
    for (const s of samples) {
      peak.set(s.regionId, Math.max(peak.get(s.regionId) ?? 0, s.discontent));
    }
  };
  record(start);

  for (let m = 0; m < months; m++) {
    simulateMonth(game);
    record(sampleRegions(game));
  }

  reportDistribution(sampleRegions(game), `через ${months} месяцев`);
  reportWelfareCauses(game);
  reportSecondAxisCandidates(game);
  reportSplitReach(game, `месяц ${months}`);
  reportReach(peak, months);
}

main();
