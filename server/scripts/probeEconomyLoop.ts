/**
 * Замыкается ли петля «инвестиции → развитие → рост» на живом сценарии 1946.
 *
 * ЗАЧЕМ. `region.infrastructure` и `region.development` читают формула ВВП
 * (`aggregateCountryData.ts`), ставка роста (`EconomyTick.computeGrowthRate`),
 * добыча (`ResourceTick`) и бегство капитала — но не пишет НИ ОДИН тик. Вопрос,
 * на который отвечает скрипт: двигаются ли эти величины за партию и отличается
 * ли траектория страны, которая вкладывается в инфраструктуру, от страны,
 * которая не вкладывается. Если не отличается — вложение бессмысленно, а вместе
 * с ним и весь бюджетный экран.
 *
 * Запуск:  npx tsx scripts/probeEconomyLoop.ts [--months 120]
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";

function parseMonths(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--months");
  if (i === -1 || i + 1 >= argv.length) return 120;
  const parsed = Number.parseInt(argv[i + 1]!, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function snapshot(game: GameState, label: string): void {
  const infrastructure = game.regions.map(r => r.infrastructure);
  const development = game.regions.map(r => r.development);
  const urbanization = game.regions.map(r => r.urbanization);
  const worldGdp = game.countries.reduce((sum, c) => sum + c.economy.gdp, 0);

  console.log(`\n=== ${label} ===`);
  console.log(
    `infrastructure: ${fmt(Math.min(...infrastructure))}…${fmt(Math.max(...infrastructure))}, ` +
    `медиана ${fmt(median(infrastructure))}`
  );
  console.log(
    `development:    ${fmt(Math.min(...development))}…${fmt(Math.max(...development))}, ` +
    `медиана ${fmt(median(development))}`
  );
  console.log(
    `urbanization:   ${fmt(Math.min(...urbanization))}…${fmt(Math.max(...urbanization))}, ` +
    `медиана ${fmt(median(urbanization))}`
  );
  console.log(`мировой ВВП: ${(worldGdp / 1e12).toFixed(3)} трлн`);
}

/**
 * Опыт на осмысленность вложения: двум сопоставимым странам задан ОДИНАКОВЫЙ по
 * сумме бюджет, но разной структуры — одна держит долю инфраструктуры высокой
 * за счёт welfare, другая наоборот.
 *
 * Именно перераспределение, а не добавление расхода. Первая редакция опыта
 * просто дописывала вкладчику 5% ВВП поверх бюджета — и меряла не пользу
 * инфраструктуры, а цену дефицита: с появлением рецессии вкладчик разорялся
 * (×0,24 против ×1,08), хотя инфраструктура у него исправно росла. Сравнивать
 * надо выбор при равных средствах, иначе измеряется бюджетная дыра.
 */
function investmentExperiment(months: number): void {
  // ОДНА И ТА ЖЕ страна в двух независимых прогонах. Две разные страны
  // сравнивать нельзя: у них расходятся otherExpenses, importSpending и долг,
  // и измеряется эта разница, а не выбор бюджета. Первая редакция опыта на этом
  // и споткнулась — вкладчик «проигрывал» 80%, потому что просто был другой
  // страной с другим балансом.
  const run = (infrastructureShare: number, welfareShare: number) => {
    const game = createGame("1946", "USA");
    const withGdp = game.countries.filter(c => c.economy.gdp > 0);
    const sorted = [...withGdp].sort((a, b) => b.economy.gdp - a.economy.gdp);
    const subject = sorted[Math.floor(sorted.length / 2)]!;

    subject.economy.spendingShares = {
      military: 0.15,
      research: 0.05,
      education: 0.10,
      infrastructure: infrastructureShare,
      welfare: welfareShare,
    };

    const gdp0 = subject.economy.gdp;
    for (let month = 0; month < months; month++) simulateMonth(game);

    return {
      id: subject.id,
      growth: subject.economy.gdp / gdp0,
      infrastructure: median(
        game.regions.filter(r => r.ownerCountryId === subject.id).map(r => r.infrastructure)
      ),
      debtBurden: subject.economy.gdp > 0 ? subject.economy.debt / subject.economy.gdp : Number.NaN,
    };
  };

  // Суммы долей равны — различается только адрес трат.
  const investing = run(0.30, 0.05);
  const saving = run(0.02, 0.33);

  console.log(`\n=== опыт: одна страна (${investing.id}), 30% бюджета в инфраструктуру против 2% ===`);
  console.log(
    `вкладывает:   ВВП ×${fmt(investing.growth, 3)}, infrastructure ${fmt(investing.infrastructure)}, ` +
    `долг/ВВП ${fmt(investing.debtBurden, 2)}`
  );
  console.log(
    `не вкладывает: ВВП ×${fmt(saving.growth, 3)}, infrastructure ${fmt(saving.infrastructure)}, ` +
    `долг/ВВП ${fmt(saving.debtBurden, 2)}`
  );
  console.log(`разница по ВВП: ${fmt((investing.growth / saving.growth - 1) * 100, 2)}%`);
}

/** Сколько стран мира растёт, а сколько сжимается — цена двустороннего роста. */
function growthDistribution(months: number): void {
  const game = createGame("1946", "USA");
  const before = new Map(game.countries.map(c => [c.id, c.economy.gdp]));

  for (let month = 0; month < months; month++) simulateMonth(game);

  const ratios = game.countries
    .filter(c => (before.get(c.id) ?? 0) > 0)
    .map(c => c.economy.gdp / before.get(c.id)!);
  const shrinking = ratios.filter(r => r < 1).length;
  const collapsed = ratios.filter(r => r < 0.5).length;

  console.log(`\n=== распределение роста за ${months} месяцев ===`);
  console.log(
    `стран сжалось: ${shrinking} из ${ratios.length}, из них вдвое и сильнее: ${collapsed}`
  );
  console.log(
    `рост: минимум ×${fmt(Math.min(...ratios), 3)}, медиана ×${fmt(median(ratios), 3)}, ` +
    `максимум ×${fmt(Math.max(...ratios), 3)}`
  );
}

function main(): void {
  const months = parseMonths();
  const game = createGame("1946", "USA");

  snapshot(game, "старт (месяц 0)");
  for (let month = 0; month < months; month++) simulateMonth(game);
  snapshot(game, `через ${months} месяцев`);

  investmentExperiment(months);
  growthDistribution(months);
}

main();
