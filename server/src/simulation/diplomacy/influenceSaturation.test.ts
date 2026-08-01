import { describe, it, expect } from "vitest";
import { createGame } from "../../game/CreateGame";
import { simulateMonth } from "../../simulation/SimulationEngine";
import { calculateBaseInfluence } from "./DiplomacyTick";
import {
  SPHERE_INFLUENCE_ENTER_THRESHOLD,
  INFLUENCE_SCALE_MAX,
  INFLUENCE_PROXIMITY_REACH,
  INFLUENCE_MILITARY_REACH,
  INFLUENCE_ECONOMIC_REACH,
} from "@shared/defines/diplomacy";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";

/**
 * НАСЫЩАЕТСЯ ЛИ ВЛИЯНИЕ — НА ЖИВОМ МИРЕ, А НЕ НА ФИКСТУРЕ.
 *
 * Дефект, ради которого написан файл (`.agent/audits/formula-audit-2026-07-30.md`,
 * P2): `calculateBaseInfluence` входила в отношение сил ЛИНЕЙНО и срезалась
 * `min(100, …)`, поэтому играющая за державу сторона получала ~150 стран из 157
 * в сферу влияния за десять месяцев, не сделав ни одного хода. Замер до правки
 * (`server/scripts/probeInfluence.ts`): USA — 144 страны из 156 (92,3%) к 10-му
 * месяцу, SUN — 129 (82,7%); приращение сферы РОСЛО: +7, +10, +22, +103 к
 * месяцам 1, 3, 6, 10.
 *
 * ПОЧЕМУ ЭТОГО НЕ ВИДЕЛИ 1276 ЗЕЛЁНЫХ ТЕСТОВ. Единственные два теста функции
 * (`DiplomacyTick.test.ts`) проверяли ПОРЯДОК («сильный влияет больше слабого»)
 * и СРЕЗ («не больше сотни») на подобранной паре. Оба были правдой. Не
 * проверялось то, что видно только на распределении живого мира: срез брал не
 * край, а три четверти мира, и «влияние» переставало различать страны.
 *
 * ПОЭТОМУ ЗДЕСЬ ПРОВЕРЯЮТСЯ СВОЙСТВА, А НЕ ЧИСЛА. Ни один порог ниже не
 * записан константой «из головы»: границы берутся ИЗ САМОГО СЦЕНАРИЯ (наибольшая
 * авторская сфера мира) или из шкалы. Обновление данных 1946 сдвинет границы
 * вместе с миром, а не оставит тест сторожить вчерашний снимок.
 *
 * НЕГАТИВНЫЙ КОНТРОЛЬ выполнен 2026-07-31: на временно восстановленной старой
 * формуле падают ВСЕ шесть проверок этого файла —
 * `144 > 44` и `129 > 44` (сфера шире наибольшей авторской у USA и SUN),
 * `9 > 7` (приращение разгоняется), `100 < 100` дважды (медиана доминирования
 * равна краю шкалы; край достижим) и 112 лишних связей влияния после первого
 * тика. Тест, не проверенный на способность падать, покрытием не считается.
 */

/** Десять игровых лет — тот же горизонт, что у соседних живых тестов. */
const HORIZON = 120;

function player(game: GameState): Country {
  return game.countries.find(c => c.id === game.playerCountryId)!;
}

function sphereSize(game: GameState): number {
  return player(game).diplomacy.sphereOfInfluence.length;
}

/**
 * Наибольшая сфера, НАРИСОВАННАЯ АВТОРОМ в стартовых данных: у скольких стран
 * самый широкий источник влияния держит связь выше порога вхождения в сферу.
 *
 * Это и есть честная граница для механики: мир января 1946 знает свой предел
 * проецирования силы (Британская империя), и симуляция не имеет права выдавать
 * игроку сферу шире той, какой в этом мире не было ни у кого.
 */
function largestAuthoredSphere(game: GameState): number {
  let largest = 0;
  for (const country of game.countries) {
    const held = Object.values(country.diplomacy.influence ?? {}).filter(
      value => value > SPHERE_INFLUENCE_ENTER_THRESHOLD
    ).length;
    largest = Math.max(largest, held);
  }
  return largest;
}

/** Множество направленных связей влияния мира — "SRC>DST". */
function influenceLinks(game: GameState): Set<string> {
  const links = new Set<string>();
  for (const country of game.countries) {
    for (const [targetId, value] of Object.entries(country.diplomacy.influence ?? {})) {
      if (value > 0) links.add(`${country.id}>${targetId}`);
    }
  }
  return links;
}

interface Campaign {
  /** Границы, снятые СО СТАРТА партии, до первого тика. */
  authoredBound: number;
  worldSize: number;
  /** Помесячный ряд размеров сферы игрока: индекс 0 — старт, далее по месяцам. */
  series: number[];
}

/**
 * Десятилетняя партия прогоняется ОДИН раз на весь файл: полный `simulateMonth`
 * — это вся симуляция мира, и повторять её на каждое утверждение значило бы
 * платить минутами за одни и те же числа.
 */
function runCampaign(countryId: string): Campaign {
  const game = createGame("1946", countryId);
  const campaign: Campaign = {
    authoredBound: largestAuthoredSphere(game),
    worldSize: game.countries.length - 1,
    series: [sphereSize(game)],
  };
  for (let month = 1; month <= HORIZON; month++) {
    simulateMonth(game);
    campaign.series.push(sphereSize(game));
  }
  return campaign;
}

const campaigns = new Map<string, Campaign>();
function campaign(countryId: string): Campaign {
  const cached = campaigns.get(countryId);
  if (cached) return cached;
  const fresh = runCampaign(countryId);
  campaigns.set(countryId, fresh);
  return fresh;
}

/** Десять игровых лет полной симуляции мира — секунды, а не миллисекунды. */
const CAMPAIGN_TIMEOUT_MS = 120_000;

describe("насыщение влияния на живом сценарии 1946", () => {
  it.each(["USA", "SUN"])(
    "за 10 лет сфера игрока (%s) не превосходит наибольшую авторскую сферу мира",
    playerId => {
      const { authoredBound, worldSize, series } = campaign(playerId);

      // Граница обязана быть живой: ноль означал бы, что сравнивать не с чем и
      // утверждение пустое, а величина порядка мира — что оно ничего не
      // запрещает.
      expect(authoredBound).toBeGreaterThan(0);
      expect(authoredBound).toBeLessThan(worldSize / 2);

      expect(series[HORIZON]).toBeLessThanOrEqual(authoredBound);
    },
    CAMPAIGN_TIMEOUT_MS
  );

  it(
    "приращение сферы не разгоняется: ни один месяц не даёт больше первого",
    () => {
      // Первый месяц особый по построению: тик впервые превращает авторское
      // влияние в ярлыки сферы. Насыщение означает, что дальше механике добавить
      // нечем — прирост может только убывать. Разгон (замер до правки: +7 → +103)
      // — прямая противоположность.
      const { series } = campaign("USA");
      const steps = series.slice(1).map((value, index) => value - series[index]!);
      const first = steps[0]!;

      expect(first).toBeGreaterThan(0); // механика жива, а не выключена
      for (let index = 1; index < steps.length; index++) {
        expect(steps[index]!).toBeLessThanOrEqual(first);
      }
    },
    CAMPAIGN_TIMEOUT_MS
  );

  it("доминирование РАЗЛИЧАЕТ страны, а не упирается в потолок у большинства", () => {
    // Тот самый недостающий класс проверки из аудита: вход перехода обязан
    // различать мир. До правки медиана доминирования равнялась максимуму шкалы
    // (100,00 при максимуме 100,00) — «влияние» было константой для трёх
    // четвертей мира.
    const game = createGame("1946", "SUN");
    const me = player(game);
    const dom = game.countries
      .filter(c => c.id !== me.id)
      .map(c => calculateBaseInfluence(me, c))
      .sort((a, b) => a - b);

    const median = dom[Math.floor(dom.length / 2)]!;
    const max = dom[dom.length - 1]!;

    expect(median).toBeLessThan(max);
    expect(median).toBeLessThan(INFLUENCE_SCALE_MAX / 2);

    // И главное следствие: одним размером сферу не купить — держава не
    // доминирует над большей частью мира по построению формулы.
    const dominated = dom.filter(value => value > SPHERE_INFLUENCE_ENTER_THRESHOLD).length;
    expect(dominated).toBeLessThan(dom.length / 2);
  });

  it("потолок шкалы недостижим при любом конечном перевесе", () => {
    // Сумма пределов равна краю шкалы РОВНО. Меньше — верх шкалы мёртв, больше
    // — `Math.min` снова обрезка, то есть возвращается исходный дефект.
    expect(
      INFLUENCE_PROXIMITY_REACH + INFLUENCE_MILITARY_REACH + INFLUENCE_ECONOMIC_REACH
    ).toBe(INFLUENCE_SCALE_MAX);

    const game = createGame("1946", "USA");
    const byGdp = [...game.countries].sort((a, b) => b.economy.gdp - a.economy.gdp);
    const biggest = byGdp[0]!;
    const smallest = byGdp[byGdp.length - 1]!;

    // Крайняя пара мира — и всё равно строго ниже края шкалы: насыщение, а не
    // обрезка. До правки здесь стояла ровно сотня.
    expect(calculateBaseInfluence(biggest, smallest)).toBeLessThan(INFLUENCE_SCALE_MAX);
  });

  it("первый тик не заводит связей влияния, которых не было в сценарии", () => {
    // Требование к калибровке: стартовое состояние сценария механика сохраняет,
    // а не переписывает. До правки первый же тик добавлял 112 связей у USA и
    // 131 у SUN — авторская разметка тонула в машинно-порождённой.
    const game = createGame("1946", "USA");
    const authored = influenceLinks(game);
    expect(authored.size).toBeGreaterThan(0);

    simulateMonth(game);

    const added = [...influenceLinks(game)].filter(link => !authored.has(link));
    expect(added).toEqual([]);
  });
});
