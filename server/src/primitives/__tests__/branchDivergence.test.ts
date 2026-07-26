import { describe, it, expect } from "vitest";
import { applyPrimitiveBatch } from "../PrimitiveEngine";
import { type Primitive } from "../types";
import { discontentTick } from "../../simulation/politics/DiscontentTick";
import { regionDiscontent } from "@shared/utils/discontent";
import { type GameState } from "@shared/types/GameState";
import {
  createDiscontentTestGame,
  TEST_GROUP_TITULAR,
  TEST_REGION_NATIONAL,
  TEST_REGION_NEIGHBOUR,
} from "../../test-utils/discontentFixtures";

/**
 * Риск №2 рамки (docs/PRIMITIVES.md §5, критерий приёмки среза): «влияние →
 * косметика». Разные ответы игрока обязаны вести в РАЗЛИЧИМО разное будущее;
 * схлопывание веток — баг, а не мелочь.
 *
 * Реализовано параметризованным детерминированным тестом (таблица входов), а
 * не property-based фреймворком: fast-check в проект не вводится, а
 * детерминированный движок и так даёт воспроизводимый результат — случайные
 * входы добавили бы флейки, а не покрытие.
 *
 * Горизонт в 12 месяцев выбран потому, что именно на нём расходятся характеры
 * следов: `suppression` к этому сроку почти выдохся, `alienation` — почти нет.
 * На горизонте в 1 месяц repress и grant_autonomy выглядели бы «одинаково
 * хорошо».
 */

const HORIZON_MONTHS = 12;
/** Ветки считаются различимыми, если расходятся хотя бы на это. */
const DISTINGUISHABLE_DELTA = 0.02;

interface Branch {
  name: string;
  primitives: Primitive[];
}

const BRANCHES: Branch[] = [
  { name: "do_nothing", primitives: [] },
  {
    name: "repress",
    primitives: [{
      verb: "repress",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    }],
  },
  {
    name: "grant_autonomy",
    primitives: [{
      verb: "grant_autonomy",
      sourceCountryId: "SUN",
      target: { regionId: TEST_REGION_NATIONAL, groupId: TEST_GROUP_TITULAR },
    }],
  },
  {
    name: "enact_reform",
    primitives: [{
      verb: "enact_reform",
      sourceCountryId: "SUN",
      target: { countryId: "SUN" },
      params: { politicalDirection: "democratic" },
    }],
  },
];

interface BranchOutcome {
  target: number;
  neighbour: number;
  alienation: number;
  /** Политическая координата власти — постоянный след реформы. */
  politicalAxis: number;
}

function runBranch(branch: Branch, months: number): BranchOutcome {
  const state: GameState = createDiscontentTestGame();
  applyPrimitiveBatch(state, branch.primitives);
  for (let i = 0; i < months; i++) discontentTick(state);

  const find = (id: number) => state.regions.find(r => r.id === id)!;
  return {
    target: regionDiscontent(state, find(TEST_REGION_NATIONAL))!,
    neighbour: regionDiscontent(state, find(TEST_REGION_NEIGHBOUR))!,
    alienation:
      state.groupImpactMemory.find(
        m => m.regionId === TEST_REGION_NATIONAL && m.groupId === TEST_GROUP_TITULAR
      )?.alienation ?? 0,
    politicalAxis:
      state.countries.find(c => c.id === "SUN")!.politics.ideologyCoordinates!.political,
  };
}

/**
 * Расстояние между ветками по НАБОРУ наблюдаемых, а не по одному числу.
 * Одного скаляра мало: кривые «недовольство целевого региона» у разных
 * ответов могут пересечься в конкретный месяц, оставаясь при этом разными
 * состояниями мира (см. тест про пересечение ниже).
 */
function branchDistance(a: BranchOutcome, b: BranchOutcome): number {
  return Math.max(
    Math.abs(a.target - b.target),
    Math.abs(a.neighbour - b.neighbour),
    Math.abs(a.alienation - b.alienation),
    Math.abs(a.politicalAxis - b.politicalAxis),
  );
}

describe("ветки не схлопываются: три ответа игрока → разное состояние", () => {
  const outcomes = new Map<string, BranchOutcome>(
    BRANCHES.map(b => [b.name, runBranch(b, HORIZON_MONTHS)])
  );

  const answers = ["repress", "grant_autonomy", "enact_reform"] as const;
  const pairs = answers.flatMap((a, i) => answers.slice(i + 1).map(b => [a, b] as const));

  it.each(pairs)("%s и %s дают различимо разное недовольство через 12 ходов", (a, b) => {
    const left = outcomes.get(a)!;
    const right = outcomes.get(b)!;
    expect(Math.abs(left.target - right.target)).toBeGreaterThan(DISTINGUISHABLE_DELTA);
  });

  it.each(answers)("%s отличим и от бездействия — выбор игрока не косметика", (answer) => {
    const chosen = outcomes.get(answer)!;
    const idle = outcomes.get("do_nothing")!;
    expect(Math.abs(chosen.target - idle.target)).toBeGreaterThan(DISTINGUISHABLE_DELTA);
  });

  it("repress через год ХУЖЕ бездействия: подавил — загнал вглубь", () => {
    expect(outcomes.get("repress")!.target).toBeGreaterThan(outcomes.get("do_nothing")!.target);
    expect(outcomes.get("repress")!.alienation).toBeGreaterThan(0);
  });

  it("grant_autonomy снижает недовольство в регионе, но поднимает у соседа", () => {
    const idle = outcomes.get("do_nothing")!;
    const autonomy = outcomes.get("grant_autonomy")!;
    expect(autonomy.target).toBeLessThan(idle.target);
    expect(autonomy.neighbour).toBeGreaterThan(idle.neighbour);
  });

  it("enact_reform снижает недовольство и в регионе, и у соседа — сдвиг координат общий", () => {
    const idle = outcomes.get("do_nothing")!;
    const reform = outcomes.get("enact_reform")!;
    expect(reform.target).toBeLessThan(idle.target);
    expect(reform.neighbour).toBeLessThan(idle.neighbour);
    // Реформа не оставляет следа в памяти воздействий — она меняет саму
    // геометрию, а не накладывает временную заплату.
    expect(reform.alienation).toBe(0);
  });

  it("состояния веток не схлопываются и на горизонте в 36 месяцев", () => {
    const long = new Map(BRANCHES.map(b => [b.name, runBranch(b, 36)]));
    for (const [a, b] of pairs) {
      expect(branchDistance(long.get(a)!, long.get(b)!)).toBeGreaterThan(DISTINGUISHABLE_DELTA);
    }
  });

  /**
   * НАБЛЮДЕНИЕ калибровки, а не требование: уступка затухает
   * (`CONCESSION_DECAY_RATE`), реформа постоянна — поэтому кривые недовольства
   * целевого региона у `grant_autonomy` и `enact_reform` СБЛИЖАЮТСЯ, и к 36-му
   * месяцу зазор между ними меньше порога различимости.
   *
   * Сближение и пересечение — разные события, и раньше тест их путал: условие
   * `|зазор| < 0.02` он печатал как «кривые пересеклись», хотя оно доказывает
   * только близость. Смена знака происходит позже — по замеру на текущей
   * калибровке между 38-м и 39-м месяцами (месяц 36: −0.0027; 38: −0.0004;
   * 39: +0.0007). Ниже печатается и величина зазора, и его знак, чтобы будущая
   * калибровка видела оба числа, а не гадала по одному.
   *
   * Ни близость, ни пересечение тест НЕ утверждает, и это осознанно. Точка
   * пересечения — производная от плейсхолдерных коэффициентов (`docs/TODO.md`,
   * «Калибровка коридоров магнитуды»): любая калибровка её сдвинет, и жёсткое
   * `expect(...).toBeLessThan(DISTINGUISHABLE_DELTA)` упало бы, хотя ничего не
   * сломалось. Обратное требование — «ветки не должны пересекаться» — ещё хуже:
   * две кривые с разными постоянными времени обязаны пересечься, а запрет на
   * это означал бы, что один ответ игрока монотонно лучше другого, то есть
   * рельсы вместо выбора.
   *
   * Обязательным остаётся то, что от калибровки не зависит: постоянный след
   * реформы и различимость состояний мира по НАБОРУ наблюдаемых даже в момент
   * сближения по одному скаляру.
   */
  it("сближение по одному скаляру не делает состояния мира одинаковыми", () => {
    const autonomy = runBranch(BRANCHES.find(b => b.name === "grant_autonomy")!, 36);
    const reform = runBranch(BRANCHES.find(b => b.name === "enact_reform")!, 36);

    const signedGap = autonomy.target - reform.target;
    const scalarGap = Math.abs(signedGap);
    // eslint-disable-next-line no-console
    console.info(
      `[калибровка] 36-й месяц: discontent(grant_autonomy) − discontent(enact_reform) = ` +
      `${signedGap.toFixed(7)}; |зазор| ${scalarGap.toFixed(4)} ` +
      `(порог различимости ${DISTINGUISHABLE_DELTA}: ` +
      `${scalarGap < DISTINGUISHABLE_DELTA ? "кривые сблизились ниже порога" : "ещё не сблизились"}; ` +
      `знак ${signedGap < 0 ? "«уступка ниже реформы»" : "«уступка выше реформы»"} — ` +
      `пересечение там, где он меняется, а не там, где зазор мал)`
    );

    // Постоянный след реформы — то, чего уступка не даёт ни при какой калибровке.
    expect(reform.politicalAxis).toBeGreaterThan(autonomy.politicalAxis);
    // И по набору наблюдаемых ветки остаются различимыми в тот же момент.
    expect(branchDistance(autonomy, reform)).toBeGreaterThan(DISTINGUISHABLE_DELTA);
  });
});
