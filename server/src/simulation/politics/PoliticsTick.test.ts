import { describe, it, expect } from "vitest";
import { politicsTick } from "./PoliticsTick";
import { createTestCountry } from "../../test-utils/fixtures";
import { createGame } from "../../game/CreateGame";
import { type PowerStructure } from "@shared/types/politics/Government";

function makeCountry(overrides: {
    unemployment?: number;
    budgetBalance?: number;
    gdp?: number;
    inflation?: number;
    educationSpending?: number;
    welfareSpending?: number;
    taxRevenue?: number;
    stability?: number;
    governmentSupport?: number;
    legitimacy?: number;
    corruption?: number;
    ideology?: string;
    political?: number;
    powerStructure?: PowerStructure;
} = {}) {
    const c = createTestCountry();
    c.economy.unemployment = overrides.unemployment ?? 10;
    c.economy.budgetBalance = overrides.budgetBalance ?? 0;
    c.economy.gdp = overrides.gdp ?? 1000;
    c.economy.inflation = overrides.inflation ?? 5;
    c.economy.educationSpending = overrides.educationSpending ?? 100;
    c.economy.welfareSpending = overrides.welfareSpending ?? 100;
    // Зануляем побочные источники дохода — иначе они раздувают знаменатель
    // в corruptionEquilibrium и ломают предсказуемость тестов.
    c.economy.taxRevenue = overrides.taxRevenue ?? 1000;
    c.economy.exportIncome = 0;
    c.economy.stateEnterpriseIncome = 0;
    c.economy.otherIncome = 0;
    c.politics.stability = overrides.stability ?? 50;
    c.politics.governmentSupport = overrides.governmentSupport ?? 50;
    c.politics.legitimacy = overrides.legitimacy ?? 60;
    c.politics.corruption = overrides.corruption ?? 30;
    c.politics.ideology = overrides.ideology ?? "Democracy";
    if (overrides.political !== undefined) {
        c.politics.ideologyCoordinates = { economic: 0, political: overrides.political };
    }
    if (overrides.powerStructure !== undefined) {
        c.politics.powerStructure = overrides.powerStructure;
    }
    return c;
}

describe("politicsTick — stability", () => {
    it("растёт при низкой безработице и бездефицитном бюджете", () => {
        const c = makeCountry({ unemployment: 2, budgetBalance: 100, stability: 50 });
        politicsTick(c);
        expect(c.politics.stability).toBeGreaterThan(50);
    });

    it("падает при высокой безработице и дефиците", () => {
        const c = makeCountry({ unemployment: 20, budgetBalance: -100, stability: 50 });
        politicsTick(c);
        expect(c.politics.stability).toBeLessThan(50);
    });

    it("зажата в [0, 100]", () => {
        const c = makeCountry({ unemployment: 40, budgetBalance: -10000, stability: 1 });
        for (let i = 0; i < 100; i++) politicsTick(c);
        expect(c.politics.stability).toBeGreaterThanOrEqual(0);
        expect(c.politics.stability).toBeLessThanOrEqual(100);
    });

    it("высокая коррупция (> 60) давит на stability", () => {
        const c1 = makeCountry({ unemployment: 10, budgetBalance: 0, stability: 50, corruption: 70 });
        const c2 = makeCountry({ unemployment: 10, budgetBalance: 0, stability: 50, corruption: 10 });
        politicsTick(c1);
        politicsTick(c2);
        expect(c1.politics.stability).toBeLessThan(c2.politics.stability);
    });
});

describe("politicsTick — governmentSupport", () => {
    it("дрейфует быстрее stability при одинаковом зазоре до равновесия", () => {
        const c = makeCountry({ unemployment: 40, budgetBalance: -10000, stability: 80, governmentSupport: 80 });
        const stabilityBefore = c.politics.stability;
        const supportBefore = c.politics.governmentSupport;
        politicsTick(c);
        const deltaStability = stabilityBefore - c.politics.stability;
        const deltaSupport = supportBefore - c.politics.governmentSupport;
        expect(deltaSupport).toBeGreaterThan(deltaStability);
    });
});

describe("politicsTick — legitimacy", () => {
    it("дрейфует к базису позиции на спектре", () => {
        const c = makeCountry({ political: 0.9, powerStructure: "competitive_multiparty", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeGreaterThan(50);
    });

    it("дрейфует очень медленно (< 1 пункта за тик)", () => {
        const c = makeCountry({ political: 0.9, powerStructure: "competitive_multiparty", legitimacy: 50 });
        politicsTick(c);
        expect(c.politics.legitimacy).toBeLessThan(51);
    });

    it("страна без координат и формы власти остаётся в шкале, а не уходит в NaN", () => {
        // Частичное покрытие сценарных слоёв — штатное состояние
        // (`PoliticsState.ideologyCoordinates`/`powerStructure` опциональны).
        const c = makeCountry({ ideology: "Monarchy", legitimacy: 50 });
        for (let i = 0; i < 100; i++) politicsTick(c);
        expect(Number.isFinite(c.politics.legitimacy)).toBe(true);
        expect(c.politics.legitimacy).toBeGreaterThanOrEqual(0);
        expect(c.politics.legitimacy).toBeLessThanOrEqual(100);
    });

    it("оккупационная администрация расходится со своей властью той же позиции спектра", () => {
        // Сравнение пары, а не с абсолютным числом: у одной позиции спектра
        // база оккупанта может совпасть со стартовым значением фикстуры, и
        // проверка «упал ниже 50» была бы снимком баланса, а не свойством.
        const own = makeCountry({ political: 0.9, powerStructure: "competitive_multiparty", legitimacy: 50 });
        const occupier = makeCountry({ political: 0.9, powerStructure: "occupation_administration", legitimacy: 50 });
        for (let i = 0; i < 100; i++) { politicsTick(own); politicsTick(occupier); }
        expect(own.politics.legitimacy).toBeGreaterThan(50);
        expect(occupier.politics.legitimacy).toBeLessThan(own.politics.legitimacy);
    });
});

describe("politicsTick — corruption", () => {
    it("конкурентная многопартийность сбивает коррупцию, личный режим — держит", () => {
        // Дрейф медленный (rate=0.003, полупериод ≈ 231 тик), поэтому проверяем
        // направление и расхождение форм власти, а не попадание в число.
        const competitive = makeCountry({ powerStructure: "competitive_multiparty", corruption: 60, stability: 60 });
        const personalist = makeCountry({ powerStructure: "personalist", corruption: 60, stability: 60 });
        for (let i = 0; i < 500; i++) { politicsTick(competitive); politicsTick(personalist); }
        expect(competitive.politics.corruption).toBeLessThan(60);
        expect(competitive.politics.corruption).toBeLessThan(personalist.politics.corruption);
    });

    it("личный режим не падает ниже своего структурного уровня", () => {
        const personalist = makeCountry({ powerStructure: "personalist", corruption: 0, stability: 60 });
        const competitive = makeCountry({ powerStructure: "competitive_multiparty", corruption: 0, stability: 60 });
        for (let i = 0; i < 500; i++) { politicsTick(personalist); politicsTick(competitive); }
        // Оба поднимаются от нуля к своему базису, но личный режим — заметно выше.
        expect(personalist.politics.corruption).toBeGreaterThan(competitive.politics.corruption);
    });

    it("нестабильность (stability < 40) поднимает равновесие коррупции", () => {
        const cUnstable = makeCountry({ powerStructure: "competitive_multiparty", corruption: 20, stability: 30 });
        const cStable = makeCountry({ powerStructure: "competitive_multiparty", corruption: 20, stability: 60 });
        for (let i = 0; i < 50; i++) {
            politicsTick(cUnstable);
            politicsTick(cStable);
        }
        expect(cUnstable.politics.corruption).toBeGreaterThan(cStable.politics.corruption);
    });

    it("низкие расходы на образование повышают равновесие коррупции", () => {
        // taxRevenue = 1000, educationSpending < 5% → +10 к равновесию
        const cLowEdu = makeCountry({ powerStructure: "competitive_multiparty", corruption: 20, educationSpending: 10, taxRevenue: 1000 });
        const cHighEdu = makeCountry({ powerStructure: "competitive_multiparty", corruption: 20, educationSpending: 200, taxRevenue: 1000 });
        for (let i = 0; i < 50; i++) {
            politicsTick(cLowEdu);
            politicsTick(cHighEdu);
        }
        expect(cLowEdu.politics.corruption).toBeGreaterThan(cHighEdu.politics.corruption);
    });

    it("коррупция вызывает утечку из казны пропорционально ВВП", () => {
        const c = makeCountry({ corruption: 50, gdp: 1_000_000 });
        const treasuryBefore = c.economy.treasury;
        politicsTick(c);
        expect(c.economy.treasury).toBeLessThan(treasuryBefore);
    });

    it("при нулевом ВВП утечки нет", () => {
        const c = makeCountry({ corruption: 100, gdp: 0 });
        const treasuryBefore = c.economy.treasury;
        politicsTick(c);
        expect(c.economy.treasury).toBe(treasuryBefore);
    });

    it("зажата в [0, 100]", () => {
        const c = makeCountry({ powerStructure: "competitive_multiparty", corruption: 0, stability: 80 });
        for (let i = 0; i < 100; i++) politicsTick(c);
        expect(c.politics.corruption).toBeGreaterThanOrEqual(0);
        expect(c.politics.corruption).toBeLessThanOrEqual(100);
    });
});

/**
 * Проверка на БОЕВЫХ данных, а не на фикстуре: смысл перевода баз с ярлыка на
 * координаты и форму власти в том, что мир перестаёт быть четырьмя режимами.
 * Ярлык `politics.ideology` в данных 1946 принимает пять значений на 157 стран,
 * и таблицы по нему давали ровно столько же различных базисов (а фактически
 * меньше: 78 стран падали в дефолт).
 *
 * Свойства сформулированы относительно самих данных — числа стран, ярлыков и
 * величины базисов нигде не зашиты, поэтому следующее наполнение сценария тест
 * не сломает.
 */
describe("politicsTick — базисы на сценарии 1946", () => {
    const SEED = 1;
    const TICKS = 240;

    function simulatedBases() {
        const game = createGame("1946", "USA", "ru", SEED);
        // Стартовые legitimacy/corruption одинаковы у всех стран (CreateCountry),
        // поэтому расхождение после тиков — целиком заслуга базисов.
        for (let i = 0; i < TICKS; i++) {
            for (const country of game.countries) politicsTick(country);
        }
        return game;
    }

    function modalShare(values: number[]): number {
        const counts = new Map<number, number>();
        for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
        return Math.max(...counts.values()) / values.length;
    }

    it("различает страны тоньше, чем ярлык идеологии", () => {
        const game = simulatedBases();
        const labels = new Set(game.countries.map(c => c.politics.ideology));

        const legitimacies = new Set(game.countries.map(c => c.politics.legitimacy.toFixed(4)));
        const corruptions = new Set(game.countries.map(c => c.politics.corruption.toFixed(4)));

        expect(legitimacies.size).toBeGreaterThan(labels.size);
        expect(corruptions.size).toBeGreaterThan(labels.size);
    });

    it("страны под одним ярлыком идеологии расходятся по обоим базисам", () => {
        // Прямой негативный контроль перевода: пока базис читался по ярлыку,
        // страны с одинаковым ярлыком получали тождественные значения.
        const game = simulatedBases();
        const byLabel = new Map<string, typeof game.countries>();
        for (const country of game.countries) {
            const bucket = byLabel.get(country.politics.ideology) ?? [];
            bucket.push(country);
            byLabel.set(country.politics.ideology, bucket);
        }

        const splitLegitimacy = [...byLabel.values()].filter(
            group => group.length > 1 && new Set(group.map(c => c.politics.legitimacy.toFixed(4))).size > 1
        );
        const splitCorruption = [...byLabel.values()].filter(
            group => group.length > 1 && new Set(group.map(c => c.politics.corruption.toFixed(4))).size > 1
        );

        expect(splitLegitimacy.length).toBeGreaterThan(0);
        expect(splitCorruption.length).toBeGreaterThan(0);
    });

    it("не сдвигает мир в одну точку: ни одно значение не собирает большинство стран", () => {
        const game = simulatedBases();
        expect(modalShare(game.countries.map(c => c.politics.legitimacy))).toBeLessThan(0.5);
        expect(modalShare(game.countries.map(c => c.politics.corruption))).toBeLessThan(0.5);
    });

    it("формы власти размечены у всех стран сценария — в фолбэк не падает никто", () => {
        const game = createGame("1946", "USA", "ru", SEED);
        const unmarked = game.countries.filter(c => c.politics.powerStructure === undefined);
        expect(unmarked.map(c => c.id)).toEqual([]);
    });
});
