# Экономика

Last updated: 2026-07-06

> ⚠️ Заготовка. Часть решений не принята — см. разделы "Открытые вопросы" ниже.
> Непомеченные числа — не источник истины, пока раздел не финализирован.
> Общие принципы ("лёгкая экономика", запрет на Victoria-сложность) — в
> `AGENTS.md`, не дублируются здесь.

## Назначение

Этот файл — дом для дизайна экономической петли: откуда берётся ВВП, как
считается бюджет, что такое единицы измерения в игре, и что делать с
ресурсами после добычи. Консолидирует то, что сейчас размазано по
`AGENTS.md` / `docs/AI_RULES.md` / `docs/DECISIONS.md`.

Смежные доки: [`TRADE.md`](TRADE.md) (мировой рынок, экспорт, логистика),
[`MAP_FEATURES.md`](MAP_FEATURES.md) (заводы/шахты как unit экономики),
[`POLITICS.md`](POLITICS.md) (как экономика двигает стабильность).
Масштаб мира (число регионов/стран/ресурсов) — только в `docs/WORLD.md`.

---

## Текущее состояние в коде

### Поля `EconomyState` (`shared/src/types/EconomyState.ts`)

- `gdp`, `treasury`
- Доход: `taxRevenue`, `exportIncome`, `stateEnterpriseIncome`, `otherIncome`
- Расход: `militarySpending`, `researchSpending`, `educationSpending`,
  `infrastructureSpending`, `welfareSpending`, `debtInterest`, `otherExpenses`
- `inflation`, `unemployment`, `tradeBalance`, `budgetBalance`
- `taxRate?` — рантайм-поле, выводится в `createGame` (см. ниже)
- `spendingFloor?` — снимок 50% старта по 5 дискреционным статьям, используется
  только ИИ-аустерити (`AiBehaviorTick.ts`)

### Откуда берётся ВВП

ВВП считается на уровне региона и агрегируется к стране
(`shared/src/utils/aggregateCountryData.ts`). Формула роста региона —
`EconomyTick.ts:59-77`:

```
baseGrowthRate = 0.001 + avgDevelopment×0.002 + avgInfrastructure×0.001
infrastructureBonus = infrastructureSpending / gdp × 0.5
deficitPenalty = budgetBalance < 0 ? |budgetBalance| / gdp × 0.3 : 0
growthRate = min(MAX_MONTHLY_GROWTH_RATE, max(0, baseGrowthRate + infrastructureBonus - deficitPenalty))
// MAX_MONTHLY_GROWTH_RATE = 0.05 — защитный потолок, не даёт архетипу разогнаться неограниченно
region.gdp *= (1 + growthRate + sectorBonus)   // sectorBonus от industry/services региона
```

`country.economy.gdp` перезаписывается агрегацией (Σ `region.gdp`), не
накапливается отдельно.

### Петля бюджета (`EconomyTick.ts:9-88`)

```
if (taxRate !== undefined) taxRevenue = gdp × taxRate      // см. "Решено" ниже
income   = taxRevenue + exportIncome + stateEnterpriseIncome + otherIncome
expenses = militarySpending + researchSpending + educationSpending
         + infrastructureSpending + welfareSpending + debtInterest + otherExpenses
budgetBalance = income - expenses
treasury += budgetBalance
inflation    += 0.1 × (expenses - income) / gdp
unemployment += 0.05 × (expenses - income) / gdp   // floored at 0
```

Если у страны задан `EconomyState.spendingShares?: { military, research,
education, infrastructure, welfare }` (`PUT /budget`), каждый тик до расчёта
`expenses` пересчитываются абсолютные `militarySpending/researchSpending/
educationSpending/infrastructureSpending/welfareSpending = income × доля` —
тот же паттерн, что `taxRate → taxRevenue` выше. Потолки на каждую статью
независимые (`shared/src/constants/budgetSpendingShareCaps.ts`,
`BUDGET_SPENDING_SHARE_CAPS`), сумма долей может превышать 1 — разрешено
осознанно. ИИ-страны `spendingShares` не имеют, их `*Spending` остаются
абсолютными числами, которые двигает `AiBehaviorTick`. В интерфейсе — 4
пресета (`client/src/components/budgetPresets.ts`), роут `PUT /budget`;
смена бюджета **не** продвигает игровой ход.

`RegionEconomyService.calculateRegionalProduction`/`aggregateRegionEconomy`
существуют и протестированы, но **не подключены** к общему циклу — зарезервированы
под будущую MapFeature-экономику (см. `MAP_FEATURES.md`). Не включать их в
`EconomyTick` без явного решения, кто считает что — иначе задвоение
(прецедент: удалённый `ProductionTick`, см. `DECISIONS.md` 2026-06-22).
`RegionEconomyService.initializeRegionEconomy` — отдельно от этих двух,
**подключён и используется**: строит нулевой economy-снимок региона при
`createGame` (`CreateGame.ts`) и лениво в `ResourceTick.ts` для регионов без
`economy`.

### Добыча ресурсов

Считает **только** `ResourceTick` (`server/src/simulation/resources/ResourceTick.ts`):
`actualProduction = baseAmount × infrastructureBonus × techBonus × miningBonus`,
пишет в `country.stockpile` (`Record<ResourceType, number>`), истощает
месторождение на 0.01%/мес до минимума 10%. `stockpile` только **копится** —
ничего не потребляет и не продаёт (см. "Открытые вопросы", Q-петля ресурсов).

---

## Что уже решено

- **`taxRevenue = gdp × taxRate`** (`docs/DECISIONS.md`, 2026-06-23): ставка
  выводится в `createGame` как `taxRevenue / gdp` на старте партии, далее
  пересчитывается каждый тик. `export/stateEnterprise/other` остаются
  статичными в первом проходе — оживут с торговлей (`TRADE.md`).
- **Добыча ресурсов — только `ResourceTick`** (`docs/DECISIONS.md`, 2026-06-23,
  бывш. "вопрос 4"). `RegionEconomyService.calculateRegionalProduction`
  не включается в общий цикл, чтобы не задвоить добычу.
- Снимок `spendingFloor` (50% старта) и ИИ-аустерити по дефициту — реализованы,
  детали в `docs/DECISIONS.md` (2026-06-23) и [`POLITICS.md`](POLITICS.md)
  (там же — связь с дальнейшими нудж-правилами).
- **Бюджет игрока переведён на доли income + пресеты** (`docs/decisions/2026-07.md`,
  2026-07-04): `*Spending` пересчитываются тиком из `EconomyState.spendingShares`,
  детали см. в "Петля бюджета" выше.

---

## Модель единиц (Q9 — решено и реализовано, 2026-06-26)

Раньше `gdp` (~10¹¹, из формулы региона) и budget-поля (`treasury`/`*Spending`,
~10³, согласованные между собой в данных стран) жили на разных масштабах —
все формулы вида `spending/gdp` (инфляция, безработица, military-бонус,
рождаемость, исследования — 8 мест) схлопывались в `≈0`. Найденный при этом
второй, не связанный с масштабом баг: `region.gdp` пересчитывался с нуля
**каждый ход** в `updateAllRegionsAndAggregate`, что стирало накопленный рост
из `EconomyTick` — экономический рост был мёртв независимо от масштаба
(исправлено отдельно, см. ниже).

**Принятая модель — "ВВП-якорь + доли":** `gdp` остаётся единственной
абсолютной величиной (из регионов, формула не тронута). Всё финансовое —
**масштаб-свободные доли** в новом типе `EconomyProfile`
(`shared/src/types/EconomyProfile.ts`): `taxRate`, доли бюджета по статьям
(`spending.military/research/education/infrastructure/welfare/other`),
`treasuryShare`/`exportShare`/`stateEnterpriseShare`/`otherIncomeShare`.

**Поток данных:**
- Страна авторит `economyType` (`planned`/`mixed`/`market`) + опциональные
  оверрайды профиля. `createCountry` (`server/src/data/countries/templates/CreateCountry.ts`)
  мержит их с архетип-дефолтом (`templates/economyArchetypes.ts`) и строит
  `economy` как нулевой placeholder.
- `createGame` (после агрегации регионов, когда `gdp` известен) выводит
  денежные поля: `taxRevenue = gdp×taxRate`, `*Income = gdp×доля`,
  `*Spending = income×доля`, `treasury = gdp×treasuryShare`.
- Следствие: `spending/gdp ≈ taxRate×доля` — **одинаковое отношение для
  страны любого размера**, все 8 мест оживают без правки самих формул.
  Подтверждено симуляцией: страны одного архетипа дают идентичный `mil/gdp`
  независимо от абсолютного ВВП (разница в десятки раз).

**Сопутствующий фикс (тот самый "рост мёртв"):** `aggregateCountryData.ts`
разделён на `initializeRegionGdp` (формула региона, только при `createGame`)
и `aggregateAllCountries` (просто суммирует текущий `region.gdp`, без
пересчёта — вызывается каждый ход в `SimulationEngine`). До фикса рост ВВП
не работал **независимо от Q9** — это был отдельный баг, найденный при
верификации.

**Тюнинг:** коэффициенты роста (`EconomyTick.ts`, именованные константы в
начале файла — `INFRASTRUCTURE_SPENDING_GROWTH_COEFFICIENT` и т.д.) и
архетип-доли — стартовые предложения, не финальный баланс. Прогон 12 ходов
на сценарии 1946 даёт ~11%/год роста для рыночного архетипа, ~20%/год для
планового (форсированная индустриализация) — правдоподобно, но не
откалибровано под реальную историю.

**⚠️ 128 стран (1946, датасет d/MAP, см. `docs/SCENARIOS.md`)** конвертированы
на доли механически (через архетип по `economyType`), без исторической
калибровки. На их числа не ориентироваться при оценке баланса.

### ~~Q8 — Петля ресурсов~~ — реализовано частично (2026-07-06)

`stockpile` больше не копится бесконечно без выхода: `TradeTick.ts`
(`docs/TRADE.md`) продаёт излишек сверх внутреннего резерва
(`population × DOMESTIC_RESERVE_PER_CAPITA`) по мировой цене категории,
физически списывает проданное со stockpile, доход идёт в `exportIncome`.
Что именно потребляет ресурсы **внутри страны** (производство юнитов/техники
— War Phase 2 сейчас тратит только `militarySpending`, не ресурсы напрямую;
MapFeature input/output — не спроектировано) — по-прежнему открыто, но это
уже не блокер: "внутреннее потребление" в v1 упрощено до фиксированного
резерва на душу населения, не честного расчёта того, что реально тратится
производством.

### Прочее (не блокер, просто незавершённое)

- `exportIncome` теперь пересчитывается каждый тик (`TradeTick.ts`, 2026-07-06,
  см. `docs/TRADE.md`) — больше не статичная доля ВВП из `createGame`.
  `stateEnterpriseIncome`/`otherIncome` остаются статичными (госпредприятия
  — не спроектировано вообще). `*Spending` пересчитывается тиком, если у
  страны задан `spendingShares` (см. "Петля бюджета" выше) — не смешивать
  эти категории.
